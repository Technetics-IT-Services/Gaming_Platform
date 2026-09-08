# Phase 2C.12 — Frozen-Change Proposal → **NO FROZEN CHANGE REQUIRED**

The phase authorized modifying the frozen `WalletEngineService` **if proven necessary**. The
investigation proved it is **not** necessary: the engine is already correct under concurrency. This
document records that decision with evidence, per the traceability requirement.

## The reported symptom
Full-serial integration flakes ~1/79 with a transient "double-credit" appearance (e.g. expected 190,
actual 210), in a *different* suite each run (roulette / blackjack / sic-bo / plinko).

## What the reproduction proved (stress harness, real engine + Postgres + Redis, clean DB)
`apps/backend/src/modules/wallet-engine/wallet-concurrency.stress.integration.spec.ts` (gated
`RUN_STRESS=1`), **10/10 passing**:
- **S1 (2 / 10 / 50 / 100 concurrent same-key credits):** applied **exactly once** every time.
- **S2 (100 concurrent distinct-key debits):** exact sum, no negative, ledger balanced.
- **S3 (2 / 10 / 50 concurrent commits of ONE reservation):** **exactly one** `:bet` + one `:win` txn,
  balance `−stake+payout` once — even though `commitReservation` has no Redis lock.
- **S4 (60× two concurrent same-key plays):** always ONE round, ONE settlement, invariant holds.
- **S5 (500 mixed ops under bounded concurrency):** **261** settlements correctly **parked as
  PENDING_SETTLEMENT** under contention, then **all recovered** → reconcile balanced, no negative, 0
  stuck, 0 recovery-failed.

## Why the engine is already safe (defense in depth)
1. `WalletTransaction.reference` **@unique** and `idempotencyKey` **@unique** — a duplicate financial
   effect is DB-rejected (P2002), which `run` treats as retryable → the retry's `replay()`/status-guard
   returns the existing effect. Duplicate credit is DB-impossible.
2. `writeBalance` optimistic version (`updateMany where version=X`) — a stale write applies to 0 rows and
   throws → retry re-reads fresh state.
3. `commitReservation` LOCKED→RELEASED guarded transition — a second commit returns the existing bet txn.
4. `Serializable` isolation + bounded retries; on exhaustion the settlement **parks as
   PENDING_SETTLEMENT** (never double-applies) and the 2C.1 recovery drains it idempotently.

## Actual root cause of the 1/79 (NOT a double-credit)
1. **Racy test assertions.** The concurrent-duplicate/action tests read `a.payout` from whichever
   `Promise.all` branch resolved first. Under the create/action race, the P2002/actionSeq **loser**
   returns the round in its transient (pre-settlement) state, so its `.payout` is stale — while the
   **actual balance is always the correct single settlement**. "expected 190 / actual 210" = the test
   compared against a stale `payout=0` response; the wallet held the correct `−10+20`. **Fix:** assert
   against the DB-authoritative `gameRound.payout` (7 assertions across 6 specs). *Test bug, not product.*
2. **Test-harness connection-pool undersizing.** Running all 10 money-integration suites in one
   `--runInBand` process with the default Prisma pool (~9 on a 4-core box) caused transaction-start
   queueing under load, occasionally deferring a settlement to PENDING_SETTLEMENT (the play throws
   `ServiceUnavailable`, which the loop tests don't tolerate). **Fix:** provision the integration run's
   pool (`connection_limit=50`). *Infra config, not product; not weakening isolation, not increasing
   retries.*

## Proof the flake is gone
Full-serial integration on a fresh DB with an adequate pool: **5 consecutive runs, 79/79 each, 0
failures** (after the racy-assertion fixes). Stress harness green. Each suite already green in isolation.

## Decision
**No change to `WalletEngineService`, `GameMoneyBridge`, wallet-core, ledger, settlement, or any frozen
financial component.** Modifying frozen code merely because a test flaked would violate rules #2/#3 and
introduce risk into a proven-correct path. The changes made are **test-only** (assertion correctness +
one additive stress spec) plus **infra config** (integration-run pool sizing, documented).

## Residual production note (honest, no action required)
Under *pathological* concurrency, a settlement may defer to PENDING_SETTLEMENT and be credited a moment
later by recovery (a small latency, money always safe). This is the intended 2C.1 design. A **future,
optional** enhancement (not required for correctness) would be to add the per-wallet Redis lock to
`commitReservation` (as `credit`/`debit` already have) to reduce same-wallet settlement contention —
a deliberate, separately-reviewed change to the frozen path, out of scope here.
