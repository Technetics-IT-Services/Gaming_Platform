# Roulette — Real Money (Phase 2C.2)

Real-money Roulette on the **existing** Game Money Bridge. It adds NO second financial path: money
moves only through the frozen `WalletEngineService` (reserve → commit), and the winning pocket +
payout come only from the frozen `@gaming-platform/roulette-engine`. The bridge
(`GameMoneyBridgeService`) owns orchestration + the `GameRound` record; recovery is the centralized
Phase-2C.1 `GameMoneyRecoveryService`. No frozen module was modified.

## Model — single-shot, multi-bet

One spin = **one reservation + one settlement**, regardless of how many bets are placed:

```
submit bets → validate all → reserve TOTAL stake ONCE → spin (authoritative pocket)
            → settle ALL bets ONCE (engine payout) → persist GameRound → return balance
```

The server derives userId, total stake, winning pocket, per-bet outcome, payout and wallet balance.
The client submits only its bets, currency, an optional client seed and an idempotency key.

## Supported bets (from the engine ruleset — not reinvented)

Straight, split, street, corner, six-line (inside `numbers` bets with a selection), and the outside
bets red / black / odd / even / low (1–18) / high (19–36) / dozen / column. European, American,
French, single-/double-zero and En-Prison variants are all engine presets; La Partage / En Prison
half-back on even-money outside bets is applied by the engine on a green pocket.

## API (authenticated; `JwtAuthGuard`, userId from the JWT)

| Method & path | Purpose |
|---|---|
| `GET  /api/v1/games/roulette/config` | Bet board (types + payouts), limits, wheel numbers/greens/reds. |
| `POST /api/v1/games/roulette/play` | Play one spin. Body: `{ variant, bets:[{type,amount,selection?}], currency, clientSeed?, idempotencyKey }`. |

Forbidden in the request body (server-derived): `userId`, `walletId`, `payout`, `result`, `pocket`,
`balance`, ledger ids.

## Stake flow & settlement

1. Authenticate; validate the player (blocked accounts rejected) and currency.
2. **Validate every bet server-side before any money moves**: bet type exists in the ruleset; each
   amount is a positive decimal within `[limits.min, limits.max]` at valid currency precision;
   `numbers` bets carry the required selection size; the **total** stake is within `tableMax`;
   at most 50 bets. (Invalid bets are rejected before reserving — no stake churn.)
3. Idempotency: `@@unique([userId, idempotencyKey])` — a duplicate returns the same round.
4. `WalletEngineService.reserve(totalStake)` **once** → `RESERVED`.
5. `RouletteEngine.spin(...)` → authoritative pocket + per-bet settlement (frozen math).
6. `commitReservation(totalWin)` **once** → `SETTLED` (consume stake + credit winnings + double-entry
   ledger). On commit failure → `PENDING_SETTLEMENT` (recoverable).

## Financial model

For every spin: `balanceAfter = balanceBefore − totalStake + payout`. Losing bets contribute payout
0; winning bets pay exactly the engine's `def.payout × amount` (e.g. straight = 36× including stake).
The bridge never re-implements roulette payout mathematics — `totalWin` comes only from the engine.

## Idempotency

Idempotent on `(userId, idempotencyKey)` — no duplicate `GameRound`, `WalletTransaction`, `Ledger`
or `LedgerEntry`. A duplicate request (including a concurrent one) returns the same round and does not
double-charge. Proven live (duplicate + concurrent duplicate → one round, one settlement).

## Concurrency

The `@@unique([userId, idempotencyKey])` constraint plus the reserve/commit idempotency guarantee
that concurrent identical submissions create exactly one round and settle exactly once — no double
debit, no double payout, no negative balance.

## Recovery

Reuses the centralized Phase-2C.1 recovery — no `RouletteRecoveryService`. A spin whose commit failed
is `PENDING_SETTLEMENT` with its payout stored; the existing `GameMoneyRecoveryService.sweep()`
re-drives the idempotent `bridge.recover()` (commits `totalWin` through the same reservation),
bounded retries, `RECOVERY_FAILED` at the cap (never silently dropped). Durable + restart-safe: state
lives in `game_rounds`. Proven live (pending-settlement spin recovers; invariant holds; reconcile
balanced).

## Financial invariants (every spin)

`balanceAfter = balanceBefore − totalStake + payout`, `balanceAfter ≥ 0`, `ledger debit === credit`,
`reconcile().balanced === true`, `reconcile().difference === "0"`, no duplicate ledger entries, no
direct SQL balance mutation. Proven live over 20+ real spins (single + multi bets, wins + losses),
a guaranteed-win cover-all spin (payout 36 on stake 37), and an authenticated HTTP spin
(red 20 + straight 10 → pocket 1 red → payout 40 → balance 1001−30+40 = 1011).

## Provably fair

Reuses the engine's provably-fair contract. Each completed round exposes `serverSeed`,
`serverSeedHash`, `clientSeed`, `nonce`; anyone can re-derive the seed and reproduce the winning
pocket via `ProvablyFairWheel.verification(seed, layout)`. Unrevealed server secrets, private keys
and internal credentials are never exposed.

## Mobile UX

Mobile-first (`RouletteMoneyBoard`): sticky authoritative balance + total stake on top; a chip
selector; outside bets as a 3-column grid; a scrollable number grid (0–36) for straight bets so the
**full** engine bet board stays accessible on a small screen (organised sections + scroll, nothing
silently removed); a selected-bet summary with per-bet remove + clear-all; and a large one-hand Spin
button showing the total. Result shows the winning pocket, colour and payout. The pocket, payout and
balance are always the server's. No horizontal overflow at 375/390/412. Duplicate-tap protection: an
empty spin is blocked and Spin is guarded while pending.

## Failure cases

| Case | Behaviour |
|---|---|
| Unknown / malformed bet | Rejected before reserving → `400`. |
| Insufficient balance | `reserve(totalStake)` rejects atomically → `400`; nothing debited. |
| Zero / negative / over-limit stake | Rejected before reserving → `400`. |
| Duplicate / concurrent request | One round, one settlement; duplicates replay the same result. |
| Commit failure | `PENDING_SETTLEMENT` → automatic centralized recovery. |
| Backend restart | State in `game_rounds`; the scheduler resumes recovery on boot. |
