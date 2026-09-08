# Settlement Recovery (Phase 2C.1)

Production hardening for the Phase-2B real-money bridge: automatic, durable, restart-safe recovery of
rounds whose settlement failed. It **never** re-implements money — it drives the existing idempotent
`GameMoneyBridgeService.recover()`, which settles through the frozen `WalletEngineService`. Modules:
`apps/backend/src/modules/gaming-money/game-money-recovery.service.ts` (logic) +
`game-money-recovery.scheduler.ts` (poller); state on `game_rounds`.

## PENDING_SETTLEMENT lifecycle

```
play → RESERVED → RESOLVED → commitReservation()
                                   │ fails (DB/transient)
                                   ▼
                            PENDING_SETTLEMENT ──(claim)──► RECOVERING ──► RECOVERED
                                   ▲                              │
                                   └──── retry (backoff) ─────────┤ (attempt < max)
                                                                  ▼ (attempt = max)
                                                           RECOVERY_FAILED  (alert; manual)
```

Statuses added this phase: `RECOVERING` (claimed by a worker), `RECOVERY_FAILED` (terminal, needs manual
intervention). Added columns: `recovery_attempts`, `last_recovery_at`, `next_recovery_at`.

## Recovery architecture

A lightweight in-process poller (`GameMoneyRecoveryScheduler`, `setInterval` + `OnModuleInit/Destroy` —
the repo's existing worker pattern, no new dependency) calls `RecoveryService.sweep()` every
`RECOVERY_SWEEP_INTERVAL_MS` (default 15 000 ms). **Durability + restart-safety come from the database**:
the poller only discovers due rounds from `game_rounds`, so a restarted process re-finds them
automatically — no in-memory job state. The timer is `unref`-ed (never blocks shutdown) and disabled under
`NODE_ENV=test` / `RECOVERY_SWEEP_DISABLED=true`.

`sweep()` → `findDue()` (status `PENDING_SETTLEMENT`, `recovery_attempts < MAX`, `next_recovery_at` due) →
`recoverOne(id)` for each.

## Concurrency protection

**Authoritative = a database state transition.** `recoverOne` claims a round with a guarded update:
```sql
UPDATE game_rounds SET status='RECOVERING', recovery_attempts=recovery_attempts+1, last_recovery_at=now()
WHERE id=$1 AND status='PENDING_SETTLEMENT';   -- count===1 ⇒ this worker owns it; 0 ⇒ another worker did
```
Only one worker/process can transition a round out of `PENDING_SETTLEMENT`, so two workers can never both
recover it. A best-effort Redis lock (`gamemoney:recover:{id}`) reduces contention, and the bridge's
`commitReservation` is itself idempotent — **three layers**, DB-authoritative. Proven live: two concurrent
`recoverOne` on one round → exactly one settlement, exactly 4 ledger entries (bet+win), reconcile balanced.

## Idempotency

`recover()` → `commitReservation(reservationId, payout, ...)`; if the reservation is already consumed it
returns the existing bet transaction (no second credit, no duplicate ledger row). Re-running a settled/
recovered round is a no-op (`skipped`). Verified: a second `recoverOne` after success leaves the ledger
count unchanged.

## Retry policy

| | Value |
|---|---|
| Max attempts | **5** (`MAX_ATTEMPTS`) |
| Backoff | exponential, `5000 × 2^(attempt-1)` ms (`next_recovery_at`) |
| Retryable | transient DB/contention/version conflicts → back to `PENDING_SETTLEMENT` with backoff |
| Non-retryable at cap | attempt = 5 → `RECOVERY_FAILED` + `ERROR` alert log; **never silently dropped** |

Error categories are logged (`reservation-missing` / `insufficient` / `contention` / `unknown`).

## Restart behaviour

State is entirely in `game_rounds`. On restart, the scheduler re-discovers `PENDING_SETTLEMENT` rounds and
resumes. No recovery state is memory-only.

## Financial invariants (every successful recovery)

`balanceAfter = balanceBefore − stake + payout`, `balanceAfter ≥ 0`, `ledger debit === credit`,
`reconcile().balanced === true`, `reconcile().difference === "0"`. Verified live (WIN → +payout, LOSS →
stake consumed) with no duplicate ledger entries.

## Observability

Each attempt logs a structured, secret-free line via the existing Nest logger:
`recovery round=<id> user=<id> attempt=<n> <from>-><to> [category=<c>] durationMs=<ms>`. A cap-exhausted
round logs an `ERROR` **ALERT**. No passwords/JWTs/refresh-tokens/secrets/server-seeds are ever logged.

## Operator monitoring — health

`GET /api/v1/games/recovery/health` (perm `wallets:read`) →
`{ pending, recovering, recoveryFailed, oldestPendingAgeMs, lastRecoveryAt }`. Alert when `recoveryFailed >
0` or `oldestPendingAgeMs` grows unbounded.

## Manual recovery procedure

1. Inspect: `GET /api/v1/games/recovery/health`.
2. Force a sweep: `POST /api/v1/games/recovery/sweep` (perm `wallets:adjust`).
3. Recover one round: `POST /api/v1/games/recovery/:roundId` (perm `wallets:adjust`).
4. For a `RECOVERY_FAILED` round, investigate the logged error category, fix the root cause, then reset its
   status to `PENDING_SETTLEMENT` (operations tooling) and re-sweep — the settlement remains idempotent.

A `RECOVERY_FAILED` round is durable and visible in health — it is never lost.
