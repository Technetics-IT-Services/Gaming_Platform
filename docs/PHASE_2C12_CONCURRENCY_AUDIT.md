# Phase 2C.12 — Financial Concurrency Audit (Step 1, no code)

Evidence-based inspection of the complete settlement path. **No fix is proposed here** — this documents
the mutation graph, every transaction/lock/retry/idempotency boundary, and the candidate double-credit
mechanisms to be proven or disproven by the reproduction harness (Step 2).

## 1. Financial mutation graph

```
GameMoneyBridge.play<Game>(idempotencyKey)
  ├─ prisma.gameRound.findUnique(userId_idempotencyKey)         ── idempotency gate #1 (round)
  ├─ prisma.gameRound.create({...})   ── UNIQUE(userId, idempotencyKey) → P2002 on dup → return existing
  ├─ wallet.reserve(stake, ref=`round:{id}`, idem=`{id}:reserve`)
  │     └─ withWallet → [Redis lock] → run(Serializable + retry) →
  │           replay(idem) | Balance.reserve | writeBalance(version) | lockedFunds.create | recordTxn(RESERVE)
  ├─ engine.play(...)                  ── pure, deterministic (frozen)
  └─ wallet.commitReservation(reservationId, payout, ref=`round:{id}`, idem=`{id}:commit`)
        └─ run(Serializable + retry)  ── NOTE: NO Redis lock here
              ├─ lockedFunds.findUnique → if status != LOCKED → return existing `{ref}:bet` txn (idempotent)
              ├─ lockWalletRow (SELECT row)
              ├─ Balance.commitReserved(stake) [+ Balance.credit(win)]
              ├─ writeBalance(version)                     ── optimistic version guard
              ├─ lockedFunds.update(status=RELEASED)       ── guarded state transition
              ├─ recordTxn GAME_BET  reference=`{ref}:bet`  (UNIQUE reference)   + postJournal(DEBIT stake)
              └─ recordTxn GAME_WIN  reference=`{ref}:win`  (UNIQUE reference, NO idem) + postJournal(CREDIT win)
```

Cashier deposit/withdrawal use `credit`/`debit` → `applyAvailableDelta` → `withWallet` (Redis lock) →
`run` → `replay(idem)` | writeBalance | recordTxn | postJournal.

## 2. Boundaries

| Boundary | Mechanism | Location |
|----------|-----------|----------|
| **Round idempotency** | `GameRound` UNIQUE `(userId, idempotencyKey)`; P2002 → return existing | bridge |
| **Txn idempotency** | `WalletTransaction.idempotencyKey` **@unique**; `replay()` returns existing | engine |
| **Txn reference** | `WalletTransaction.reference` **@unique** (`{ref}:reserve/:bet/:win/:commit`) | engine |
| **Balance integrity** | optimistic `walletBalance.updateMany where version=X increment` → count 0 → ConflictException | `writeBalance` |
| **Reservation state** | `LockedFunds.status` LOCKED→RELEASED guarded; commit on non-LOCKED returns existing | `commitReservation` |
| **Isolation** | `prisma.$transaction(fn, { Serializable })` | `run` |
| **Same-wallet serialization** | Redis `SET NX PX=5000` per wallet id, 50×20ms acquire spin | `lockMany` / `acquireLock` |
| **Retry** | `run` loops `MAX_RETRIES=5`; `isRetryable` = ConflictException ∪ P2034(write-conflict) ∪ P2002(unique-race) | `run` / `isRetryable` |

## 3. Durable idempotency is strong (key observation)

Both `WalletTransaction.reference` **and** `idempotencyKey` are UNIQUE. Every settlement txn has a
deterministic reference (`round:{id}:bet`, `:win`, `:reserve`, `:commit`) and/or an idempotencyKey. A
second attempt to insert the same financial effect therefore fails with **P2002**, which `isRetryable`
treats as retryable → `run` re-executes → the `replay()`/status-guard now finds the committed effect and
returns it. So a naive retry of a committed transaction is, in principle, **self-healing** at the DB
layer. This is the primary reason the engine may already be correct.

## 4. Candidate double-credit mechanisms (to prove/disprove in Step 2)

- **H1 — Redis lock TTL expiry.** `LOCK_TTL_MS=5000`. Under heavy contention a critical section
  (Serializable tx + up to 5 retries) can exceed 5s; the NX lock auto-expires; a concurrent same-wallet
  op acquires the lock and runs in parallel. *Counter-evidence:* even then, `writeBalance`'s optimistic
  version and the UNIQUE reference/idempotencyKey should still block a duplicate effect. **Test:** force
  slow txns + short TTL, assert single effect.
- **H2 — Retry after ambiguous commit.** `run` cannot distinguish "definitely rolled back" from
  "committed, then the client saw an error". *Counter-evidence:* the retry's `replay`/status-guard finds
  the committed effect. **Test:** inject a post-commit error, assert no double.
- **H3 — `commitReservation` has no Redis lock.** Two concurrent commits of the same reservation rely on
  Serializable + LOCKED guard + UNIQUE `:bet`/`:win` reference. **Test:** N concurrent commits of one
  reservation → exactly one settlement.
- **H4 — Bridge create-race returns an unsettled round.** Both requests pass `findUnique`=null; loser
  gets P2002 and returns the round while it is still `CREATED` (not yet settled). This yields a **stale
  response**, not a double-charge, but a test asserting `after = before − stake + payout` on the loser's
  `payout` (0/undefined for a CREATED round) could read a *transiently wrong* value. **Test:** repeat the
  exact roulette scenario ×N, inspect both responses + final balance.
- **H5 — Cross-suite harness contention (NOT a product bug).** 10 money-integration suites in one jest
  process share one Postgres + Redis + connection pool. Pool exhaustion / transaction-start timeouts
  (P2028) under the combined load cause failures in whichever concurrent test hits the window — a
  *different suite each run* (roulette/blackjack/sic-bo), and **each passes in isolation on a clean DB**
  (already observed in 2C.11). **Test:** run the exact scenarios at 2/10/50/100/500 concurrency **direct
  against a clean DB in a single suite**; if the invariant never breaks, H5 is confirmed and the
  WalletEngine must **not** be modified.

## 5. Method (Step 2)

A dedicated gated stress harness (`wallet-concurrency.stress.integration.spec.ts`) using the **real**
WalletEngine + GameMoneyBridge + Postgres + Redis (no mocks on the financial path), scenarios A–L from
the brief, each asserting the invariant, `ledger debit===credit`, `reconcile difference "0"`, no negative
balance, and **exactly one financial effect per idempotency key / reference**. The harness decides which
hypothesis holds. Only if it exhibits a real double-effect will a frozen change be proposed
(`PHASE_2C12_FROZEN_CHANGE_PROPOSAL.md`); otherwise the finding is H5 (harness contention) and the engine
is left unchanged.

## 6. Preliminary read (pending Step 2 proof)

The DB-level UNIQUE(reference)+UNIQUE(idempotencyKey) + optimistic version + Serializable + LOCKED guard
form a **defense-in-depth** that should make a duplicate financial effect DB-rejected regardless of
Redis-lock timing. This biases toward **H5 (contention)** over a genuine engine defect — but this is a
hypothesis to be **proven by reproduction**, not assumed.
