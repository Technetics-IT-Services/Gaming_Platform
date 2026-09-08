# Sic Bo — Real Money (Phase 2C.3)

Real-money Sic Bo on the **existing** Game Money Bridge. Sic Bo is the frozen **Dice engine's
`sic-bo` variant** (three dice) — this phase adds a full **multi-bet** money path over it. No second
financial path: money moves only through the frozen `WalletEngineService` (reserve → commit), and
the dice + winning bets + total payout come only from the frozen `@gaming-platform/dice-engine`. The
bridge (`GameMoneyBridgeService`) owns orchestration + the `GameRound` record; recovery is the
centralized Phase-2C.1 `GameMoneyRecoveryService`. No frozen module was modified.

## Model — single-shot, multi-bet

One board = one roll = **one reservation of the total stake + one settlement**:

```
place bets → validate all → reserve TOTAL stake ONCE → roll (authoritative dice)
           → settle ALL bets ONCE (engine total payout) → persist GameRound → return balance
```

The server derives userId, total stake, the three dice, the winning bets, the payout and the wallet
balance. The client submits only its bets, currency, an optional client seed and an idempotency key.

## Supported bets (the complete engine board — not a subset)

Every `sic-bo` bet the engine defines is exposed: **Big / Small**, **Odd / Even**, **Any Triple**,
**Specific Triple** (triple-1…6, 180:1), **Specific Double** (double-1…6), **Singles** (single-1…6,
paying per matching die), and **Totals** (total-4…17 with the standard total payouts). House rules
(`triplesBeatBigSmall`, `triplesBeatOddEven`) are the engine's. The mobile UI groups these into
collapsible sections so the full board is reachable without a desktop table.

## API (authenticated; `JwtAuthGuard`, userId from the JWT)

| Method & path | Purpose |
|---|---|
| `GET  /api/v1/games/sic-bo/config` | The full bet board (key/label/category/payout) + limits. |
| `POST /api/v1/games/sic-bo/play` | Play one board. Body: `{ variant, bets:[{type,amount}], currency, clientSeed?, idempotencyKey }`. |

Forbidden in the request body (server-derived): `userId`, `walletId`, `payout`, `result`, `dice`,
`balance`, ledger ids.

## Money flow & settlement

1. Authenticate; validate the player (blocked accounts rejected) and currency.
2. **Validate every bet server-side before any money moves**: bet type exists in the ruleset; each
   amount is a positive decimal within `[limits.min, limits.max]` at valid currency precision; the
   **total** stake is within `tableMax`; at most 50 bets.
3. Idempotency: `@@unique([userId, idempotencyKey])` — a duplicate returns the same round.
4. `WalletEngineService.reserve(totalStake)` **once** → `RESERVED`.
5. `DiceEngineService.play('sic-bo', bets, clientSeed)` → authoritative dice + per-bet settlement.
6. `commitReservation(totalWin)` **once** → `SETTLED` (consume stake + credit winnings + double-entry
   ledger). On commit failure → `PENDING_SETTLEMENT` (recoverable).

Financial invariant: `balanceAfter = balanceBefore − totalStake + totalPayout`.

## Idempotency

Idempotent on `(userId, idempotencyKey)` — no duplicate `GameRound`, `WalletTransaction`, `Ledger`
or `LedgerEntry`. Proven live (sequential + concurrent duplicate → one round, charged once).

## Concurrency

The unique constraint + reserve/commit idempotency guarantee concurrent identical submissions create
exactly one round and settle exactly once — no double debit/payout, `balance ≥ 0` always, reconcile
stays `balanced: true` / `difference: "0"`. Proven live.

## Failure recovery

Reuses the centralized Phase-2C.1 recovery — no `SicBoMoneyBridgeService`, no separate recovery.
Engine failure after reserve → `releaseReservation` (stake refunded). Commit failure →
`PENDING_SETTLEMENT` with the payout stored → the existing `GameMoneyRecoveryService.sweep()`
re-drives the idempotent `bridge.recover()`, bounded retries, `RECOVERY_FAILED` at the cap. Durable +
restart-safe (state in `game_rounds`). Proven live (pending-settlement round recovers; invariant
holds; reconcile balanced).

## Provably fair

Reuses the Dice engine's provably-fair contract. A settled round exposes `serverSeed`,
`serverSeedHash`, `clientSeed`, `nonce` and the dice for replay via
`ProvablyFairDiceRoller.verification`. Secrets are never exposed prematurely.

## Financial invariant (every roll)

`balanceAfter = balanceBefore − totalStake + totalPayout`, `balanceAfter ≥ 0`, `ledger debit ===
credit`, `reconcile().balanced === true`, `reconcile().difference === "0"`, no duplicate ledger
entries, no direct SQL balance mutation. Proven live over 10+ real multi-bet rounds and an
authenticated HTTP roll (big 50 + small 50 + total-10 20 → dice [2,1,2], small won, payout 100,
balance 100000−120+100 = 99980).

## Mobile UX

Mobile-first (`SicBoMoneyBoard`): sticky authoritative balance + total stake/max-win; a chip
selector; the **complete** bet board organised into collapsible sections (Even Money, Singles,
Doubles, Triples, Totals) so nothing is crammed; a compact selected-bet summary with per-type remove
+ clear-all; a large one-hand Roll button. Dice result + winning bets shown clearly. No horizontal
overflow at 375/390/412. Duplicate-tap protection: empty rolls blocked, Roll guarded while pending.

## Failure cases

| Case | Behaviour |
|---|---|
| Unknown / malformed bet | Rejected before reserving → `400`. |
| Insufficient balance | `reserve(totalStake)` rejects atomically → `400`; nothing debited. |
| Zero / negative / over-limit stake | Rejected before reserving → `400`. |
| Engine execution failure | `releaseReservation` — stake refunded, round `FAILED`. |
| Commit failure | `PENDING_SETTLEMENT` → automatic centralized recovery. |
| Duplicate / concurrent request | One round, one settlement. |
| Backend restart | State in `game_rounds`; the scheduler resumes recovery on boot. |
