# Phase 2C.11 — End-to-End Acceptance

Live, multi-actor scenario against the platform-owned disposable Postgres + Redis. **Player A** = the
seeded ACTIVE super-admin (also acts as **Operator**, has `WALLETS_ADJUST`); **Player B** = a freshly
registered player (for ownership-denial). Amounts are deltas; no DB balance was mutated directly.

## Result: **25 / 25 checks passed, 0 failed.**

| # | Check | Result |
|---|-------|--------|
| 1 | Baseline reconcile balanced (difference 0) | PASS |
| 2 | Deposit request → **PENDING, no early credit** | PASS |
| 3 | Operator complete deposit → balance **+1000** | PASS |
| 4 | Duplicate deposit complete → **no second credit** | PASS |
| 5 | Dice: `balanceAfter = before − stake + payout` (22334.1→22344.1, payout 20) | PASS |
| 6 | Plinko: invariant (22344.1→22342.8, payout 8.7) | PASS |
| 7 | Mines: **stake held on start** | PASS |
| 8 | Mines: invariant on settle (22342.8→22344.1, payout 11.3) | PASS |
| 9 | Player A game history returns own rounds (10 items) | PASS |
| 10 | Player A wallet history returns own transactions | PASS |
| 11 | Player A can inspect own round detail (traceability) | PASS |
| 12 | Duplicate play idempotencyKey → **ONE debit, same round** | PASS |
| 13 | 5 concurrent bets → exact settlement, **no negative** (22339→22349) | PASS |
| 14 | Withdrawal request → funds **held (−200)**, UNDER_REVIEW | PASS |
| 15 | Operator reject → **refunded** to before | PASS |
| 16 | Duplicate withdrawal reject → **no second refund** | PASS |
| 17 | Second withdrawal held (−150) | PASS |
| 18 | Operator approve + complete → funds stay withdrawn (**no double move**) | PASS |
| 19 | Player B blocked from A's game round (**403**) | PASS |
| 20 | Player B blocked from operator route (**403**) | PASS |
| 21 | Player B blocked from admin reconcile (**403**) | PASS |
| 22 | Player B history JWT-scoped (**sees none of A**) | PASS |
| 23 | Insufficient withdrawal rejected | PASS |
| 24 | Invalid bet key rejected (**400**) | PASS |
| 25 | Final reconcile balanced (debit=credit=2319048, **difference "0"**) | PASS |

## Financial invariant (verified live)
- Games: `balanceAfter = balanceBefore − stake + payout`, `balanceAfter ≥ 0`.
- Deposit complete: `+creditedAmount`. Withdrawal request: `−heldAmount`. Refund: `+refundedAmount`.
- Double-entry ledger balanced; reconcile `difference:"0"` at baseline, mid-run, and final.

## Idempotency & concurrency (verified live)
Duplicate play key → one round/one debit; duplicate deposit-complete → one credit; duplicate
withdrawal-reject → one refund; 5 concurrent bets → exact aggregate settlement, no negative balance.
(Product behavior is correct; a shared-DB **test-harness** contention flake in the full serial
integration run is documented separately in the release audit — it does not reproduce in isolation.)

## Restart persistence (verified live)
Recorded pre-restart: balance `22199`, reconcile `debit=2319048, balanced:true, difference:"0"`.
**Killed and rebooted the backend process.** Post-restart: balance `22199` (unchanged), reconcile
`2319048, balanced:true, difference:"0"` (unchanged); `recovery/health` → 200. **All persisted state
correct across restart.**

## Operator actions (verified live)
Complete deposit (credit), approve + complete withdrawal, reject withdrawal (refund), reconcile — all via
`WALLETS_ADJUST` RBAC; a non-admin player is denied (403).

## Honesty notes
- Player A = admin doubling as operator (ACTIVE + `WALLETS_ADJUST`) — the deposit/withdrawal
  operator transitions are genuine RBAC-gated calls; a non-privileged player (B) is denied.
- Fresh registrations are `PENDING` (email-unverified) — Player B is used only for ownership-denial
  reads, which are status-independent.
