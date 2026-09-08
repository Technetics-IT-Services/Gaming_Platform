# Baccarat — Real Money (Phase 2C.4)

Real-money Baccarat on the **existing** Game Money Bridge — a single-shot, multi-bet card game. No
second financial path: money moves only through the frozen `WalletEngineService` (reserve → commit),
and the cards, winning side and payout come only from the frozen `@gaming-platform/card-engine`
(`baccarat` variant, via `CardEngineService.play`). The bridge owns orchestration + the `GameRound`
record; recovery is the centralized Phase-2C.1 `GameMoneyRecoveryService`. No frozen module modified.

## Model — single-shot, multi-bet

One round = **one reservation of the total stake + one settlement**:

```
place bets → validate all → reserve TOTAL stake ONCE → deal (authoritative cards)
           → settle ALL bets ONCE (engine total payout) → persist GameRound → return balance
```

The server derives userId, total stake, the player/banker hands, the winning bets, the payout and
the wallet balance. The client submits only its bets, currency, an optional client seed and an
idempotency key.

## Supported bets (from the engine, not reinvented)

**Player** (payout 2×), **Banker** (payout 1.95×), **Tie** (payout 9×). Tie rule is the engine's
(`tie-bet`: on a tie, player/banker bets push and the tie bet wins). Payouts are the engine's — never
hardcoded in the bridge.

## API (authenticated; `JwtAuthGuard`, userId from the JWT)

| Method & path | Purpose |
|---|---|
| `GET  /api/v1/games/baccarat/config` | The bet board (player/banker/tie + payouts) + limits. |
| `POST /api/v1/games/baccarat/play` | Play one round. Body: `{ bets:[{type,amount}], currency, clientSeed?, idempotencyKey }`. |

Forbidden in the request body (server-derived): `userId`, `walletId`, `payout`, `result`, `cards`,
`winningBet`, `balance`, ledger ids.

## Money flow & settlement

1. Authenticate; validate the player (blocked accounts rejected) and currency.
2. **Validate every bet server-side before any money moves**: bet key exists in the ruleset; each
   amount is a positive decimal within the engine `betLimits`; ≤50 bets.
3. Idempotency: `@@unique([userId, idempotencyKey])` — a duplicate returns the same round.
4. `WalletEngineService.reserve(totalStake)` **once** → `RESERVED`.
5. `CardEngineService.play('baccarat', bets)` → authoritative cards + per-bet settlement.
6. `commitReservation(totalWin)` **once** → `SETTLED`. On commit failure → `PENDING_SETTLEMENT`.

Financial invariant: `balanceAfter = balanceBefore − totalStake + totalPayout`.

## Idempotency & concurrency

Idempotent on `(userId, idempotencyKey)` + idempotent `commitReservation` → no duplicate
`GameRound`/`WalletTransaction`/`Ledger`/`LedgerEntry`; sequential + concurrent duplicates settle
once; `balance ≥ 0`; reconcile stays balanced. Proven live.

## Failure recovery

Reuses the centralized Phase-2C.1 recovery — no Baccarat-specific recovery. Engine failure after
reserve → `releaseReservation`. Commit failure → `PENDING_SETTLEMENT` (payout stored) → the existing
sweep re-drives the idempotent `recover()`; bounded retries; `RECOVERY_FAILED` at the cap. Durable +
restart-safe. Proven live.

## Provably fair

Reuses the Card engine's provably-fair shoe. A settled round exposes `serverSeed`/`serverSeedHash`/
`clientSeed`/`nonce` for verification via `CardEngineService.verifyShuffle`. Secrets never logged.

## Financial invariant (every round)

`balanceAfter = balanceBefore − totalStake + totalPayout`, `balanceAfter ≥ 0`, `ledger debit ===
credit`, `reconcile().balanced === true`, `difference === "0"`, no duplicate ledger entries, no direct
SQL balance mutation. Proven live over 10+ real multi-bet rounds and an authenticated HTTP deal
(player 50 + banker 20 + tie 10 → player wins, payout 100, balance 5000−80+100 = 5020).

## Mobile UX

Mobile-first (`BaccaratMoneyBoard`): sticky authoritative balance + total stake; player/banker card
rows with a compact card renderer; large touch-friendly **PLAYER / BANKER / TIE** controls (chip-
tap to stack a bet, showing each side's payout); selected-bet summary; a big **Deal** button. Result
shows the winning side + payout. No horizontal overflow at 375/390/412; empty deals blocked, Deal
guarded while pending.

## History

Uses the existing `GameRound` + `WalletTransaction` records (bets, result, payout, timestamp,
roundId) — no duplicate history model.

## Failure cases

| Case | Behaviour |
|---|---|
| Unknown / malformed bet | Rejected before reserving → `400`. |
| Insufficient balance | `reserve(totalStake)` rejects atomically → `400`; nothing debited. |
| Duplicate / concurrent request | One round, one settlement. |
| Engine failure | `releaseReservation` — stake refunded, round `FAILED`. |
| Commit failure | `PENDING_SETTLEMENT` → centralized recovery. |
| Backend restart | State in `game_rounds`; the scheduler resumes recovery on boot. |
