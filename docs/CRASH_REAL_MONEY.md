# Crash — Real Money (Phase 2C.2)

Real-money Crash on the **existing** Game Money Bridge. It adds NO second financial path: every
money move goes through the frozen `WalletEngineService` (reserve → commit), and the authoritative
crash point + payout come only from the frozen `@gaming-platform/crash-engine`. The bridge
(`GameMoneyBridgeService`) owns orchestration + the `GameRound` record; recovery is the centralized
Phase-2C.1 `GameMoneyRecoveryService`. No frozen module was modified.

## Model — a two-phase live game

Crash is not single-shot. The financial lifecycle is:

```
PLACE STAKE → RESERVE STAKE → START ROUND (hidden crash point) → multiplier rises
   ├─ player CASHES OUT before the bust → WIN at the server multiplier → settle
   └─ curve BUSTS with no cash-out         → LOSS (payout 0) → settle
```

- **Crash point is deterministic and hidden.** At `play` the server derives a provably-fair seed
  (`ProvablyFairService`, the same seeding every engine uses) and computes the crash point via the
  engine's `ProvablyFairCrashGenerator.fromRuleset(seed, ruleset)`. It is stored **server-side only**
  (`GameRound.result`) and is **never** returned while the round is running.
- **The multiplier is server-authoritative.** At `cashout` the server computes the elapsed time and
  the multiplier via the engine's `MultiplierManager.valueAt(elapsedMs)` — the client cannot set it.
  Settlement runs the frozen `CrashEngine.playRound(...)` with the server multiplier as the manual
  cash-out, so the payout is the engine's, not the bridge's.

The client never determines crash point, multiplier, payout, wallet balance or userId.

## API (authenticated; `JwtAuthGuard`, userId from the JWT)

| Method & path | Purpose |
|---|---|
| `GET  /api/v1/games/crash/config` | Limits + curve params (min/max multiplier, growth rate). |
| `GET  /api/v1/games/crash/state` | The caller's active (running) round; never reveals the crash point. |
| `POST /api/v1/games/crash/play` | Reserve stake and start a round. Body: `{ variant, stake, currency, autoCashout?, clientSeed?, idempotencyKey }`. |
| `POST /api/v1/games/crash/cashout` | Cash out the active round. Body: `{ roundId?, idempotencyKey? }`. |

Forbidden in the request body (server-derived): `userId`, `walletId`, `payout`, `result`,
`crashPoint`, `balance`, ledger ids.

## Stake flow & settlement

1. Authenticate; validate the player (blocked accounts rejected) and currency.
2. Validate stake: positive, within `[limits.min, limits.max]` and `tableMax`, currency decimal
   precision; validate `autoCashout` (must exceed `minMultiplier`, not exceed `maxMultiplier`).
3. Idempotency: `@@unique([userId, idempotencyKey])` — a duplicate returns the same round.
4. `WalletEngineService.reserve(stake)` → `RESERVED` (available → locked).
5. Derive seed + crash point (hidden); store round meta; return the **running** round
   (`crashPoint: null`, `serverSeedHash` committed).
6. **Cashout**: claim `RESERVED → RESOLVED` (guarded `updateMany`, authoritative), compute the
   server multiplier, settle via the frozen `CrashEngine`, then `commitReservation(payout)` →
   `SETTLED`. On commit failure → `PENDING_SETTLEMENT` (recoverable).

## Idempotency

- **Play** is idempotent on `(userId, idempotencyKey)` — no duplicate `GameRound`,
  `WalletTransaction`, `Ledger` or `LedgerEntry`.
- **Cashout / settlement** is idempotent two ways: the guarded `RESERVED → RESOLVED` state claim
  (only one transition wins) and the frozen `commitReservation` (a consumed reservation returns the
  existing bet transaction, never a second credit). Double cash-out returns the same settled result.

## Concurrency

Two concurrent cash-outs, or a cash-out racing the recovery finalizer, both attempt
`updateMany({ where: { id, status: RESERVED }, data: { status: RESOLVED } })`. Exactly one gets
`count === 1` and settles; the other reads the settled state. Result: **exactly one settlement**, no
double payout, no double debit, no negative balance. Proven live (concurrent cash-out settles once;
no duplicate ledger).

## Recovery

Reuses the centralized Phase-2C.1 recovery — no `CrashRecoveryService`:

- **Commit failure** (`PENDING_SETTLEMENT`): the existing `GameMoneyRecoveryService.sweep()`
  re-drives `bridge.recover()` (idempotent), bounded retries, `RECOVERY_FAILED` at the cap.
- **Abandoned (busted) running rounds**: `finalizeExpiredCrash()` finds `RESERVED` crash rounds whose
  curve has already busted (`now > startedAt + crashTimeMs + grace`) and settles them as a loss via
  the bridge's `settleCrash(id, null)` — the same guarded claim makes this safe against a concurrent
  cash-out. Both run on the durable, restart-safe scheduler; state lives in `game_rounds`, so a
  restarted process re-discovers work automatically. **The stake is never lost; a round never
  double-pays.**

## Financial invariants (every settled round)

`balanceAfter = balanceBefore − stake + payout`, `balanceAfter ≥ 0`, `ledger debit === credit`,
`reconcile().balanced === true`, `reconcile().difference === "0"`, no duplicate ledger entries, no
direct SQL balance mutation. Proven live over 10+ real rounds (wins + losses) and via an
authenticated HTTP cash-out (stake 50 → won @1.02× → payout 51 → balance 1000−50+51 = 1001).

## Provably fair

Reuses the engine's provably-fair contract. While running, only the `serverSeedHash` commitment is
exposed. After settlement the round reveals `serverSeed`, `clientSeed`, `nonce` and `crashPoint`, so
anyone can re-derive the seed and reproduce the crash point via
`ProvablyFairCrashGenerator.verification(seed, ruleset)`. Unrevealed server secrets and internal
credentials are never exposed.

## Mobile UX

Mobile-first (`CrashMoneyBoard`): sticky authoritative balance on top, a large readable multiplier
stage, stake chips + optional auto cash-out, and a prominent one-hand **Cash Out** button that
replaces Play while a round is live. The rising multiplier is a client-side animation for display
only (mirrors the server curve); the crash point, payout and balance are always the server's. No
horizontal overflow at 375/390/412. Duplicate-tap protection: play/cashout are guarded while pending.

## Failure cases

| Case | Behaviour |
|---|---|
| Insufficient balance | `reserve` rejects atomically → `400`; nothing debited. |
| Invalid stake / auto cash-out | Rejected before reserving → `400`. |
| Cash out after the bust | Engine returns a loss (payout 0); round settles once. |
| Double / concurrent cash-out | Exactly one settlement; duplicates replay the same result. |
| Commit failure | `PENDING_SETTLEMENT` → automatic centralized recovery. |
| Abandoned running round | Finalized as a loss by the recovery sweep. |
| Backend restart | State in `game_rounds`; the scheduler resumes recovery/finalize on boot. |
