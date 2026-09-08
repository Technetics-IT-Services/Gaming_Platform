# Teen Patti — Real Money (Phase 2C.7)

Single-shot real-money Teen Patti (player-vs-dealer) via the generic card bridge (`playCard`) over the
**authoritative `@gaming-platform/card-engine`**. The dealt hands, winner, payout and balance are
server-authoritative (no demo wallet).

## Rules (from the repository preset — authoritative, not assumed)
`games/card-engine/src/presets.ts` → `teen-patti`: `evaluationMode: 'poker-rank'`, **hand size 3**,
sides `player`/`dealer`. Each side is dealt a 3-card hand; the **higher poker-rank hand wins**. Bets:
- `player` — pays **2×**
- `dealer` — pays **2×**
- `tieRule: 'push'` (equal ranks → stake returned).
- The preset also defines a `pair-plus` side bet — **not exposed in P0** (see limitations).

## Backend engine reused
`CardEngineService.play('teen-patti', bets, clientSeed)` → resolve preset → `ProvablyFairService`
commit/seed → `CardEngine.playRound` (`poker-rank` standard strategy, hand-rank evaluator) →
`ResultCalculator.settle` → authoritative `settlement.totalWin`. No hand evaluation or payout math
duplicated (the engine's poker-rank evaluator is authoritative).

## RTP / payout math
Defined by the preset (player/dealer even-money, push on tie). Live: 20 rounds — invariant held every
round, wins & losses observed; `config` reports the exact payouts (`player 2×, dealer 2×`).

## Provably fair
Real `ProvablyFairService` (HMAC-SHA256): commit → derive seed → deterministic shuffle/deal; server seed
revealed on settlement, reproducible from the seed. Card path uses the real primitive end-to-end.

## Money flow
`reserve(totalStake)` → `card.play('teen-patti', bets)` → `payout = settlement.totalWin` →
`commitReservation(payout)`. Failure → `PENDING_SETTLEMENT` → recovery.

## API
- `GET /api/v1/games/teen-patti/config` → `{ variant, name, limits, sides, tieRule, bets:[{key,label,payout}] }`.
- `POST /api/v1/games/teen-patti/play` → body `{ bets:[{type,amount}], currency, clientSeed?, idempotencyKey }`.
  Unknown bet key (incl. the unexposed `pair-plus`) → **400**; forbidden server-owned fields → **400**.
  Returns `{ roundId, hands:{player,dealer}, winners, winningBets, isTie, settlement, payout, balance, provablyFair, replayed }`.

## Idempotency · concurrency · recovery · history
Duplicate key → same round, single debit. Concurrency safe. `PENDING_SETTLEMENT` recovers. Traceable via
`GameRound → reservation → wallet transaction → ledger`.

## Mobile UX
`/teen-patti-money` — shared `CardMoneyBoard`: sticky balance, both 3-card hands with a 👑 winner marker,
player/dealer bet chips, stake chips, big Deal. 375/390/412, no demo-wallet.

## Security
`@CurrentUser('id')`; variant from the route; DTO whitelist; scope-gated to the approved 3 variants;
server owns hands/winner/payout/balance.

## Tests
`game-money-card.spec.ts`, `game-money-card.integration.spec.ts` (20 rounds + concurrency + recovery),
`card-money-api.test.ts`, plus the card-engine package spec (`teen-patti` poker-rank).

## Known limitations
The `pair-plus` side bet defined in the preset is **not exposed** in P0 — only the main `player`/`dealer`
bets (each provably settles through the standard path) are enabled. Exposing side bets would require
verifying the engine settles them; deferred. No animated deal (deadline choice).
