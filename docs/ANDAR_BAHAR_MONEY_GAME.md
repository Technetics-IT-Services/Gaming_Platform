# Andar Bahar — Real Money (Phase 2C.7)

Single-shot real-money Andar Bahar via the generic card bridge (`playCard`) over the **authoritative
`@gaming-platform/card-engine`**. The deal, winning side, payout and balance are server-authoritative
(no demo wallet).

## Rules (from the repository preset — authoritative, not assumed)
`games/card-engine/src/presets.ts` → `andar-bahar`: `evaluationMode: 'side-match'`, sides
`andar`/`bahar`. Cards are dealt alternately to the two sides until a match to the game card appears;
the side that matches wins. Bets:
- `andar` — pays **1.97×**
- `bahar` — pays **2.0×**
- `tieRule: 'push'`.

The `side-match` strategy in `CardEngine.playSideMatch` implements the deal + winning-side logic.

## Backend engine reused
`CardEngineService.play('andar-bahar', bets, clientSeed)` → resolve preset → `ProvablyFairService`
commit/seed → `CardEngine.playRound` (`side-match`) → `ResultCalculator.settle` → authoritative
`settlement.totalWin`. No dealing or payout math duplicated.

## RTP / payout math
Defined by the preset payouts (`andar 1.97×`, `bahar 2.0×`) and the deal mechanics — the slight
asymmetry is the house edge. Live: 20 rounds — invariant held every round, wins & losses observed;
`config` reports the exact payouts.

## Provably fair
Real `ProvablyFairService` (HMAC-SHA256): commit → derive seed → deterministic shuffle/deal; server seed
revealed on settlement, reproducible from the seed. Card path uses the real primitive end-to-end.

## Money flow
`reserve(totalStake)` → `card.play('andar-bahar', bets)` → `payout = settlement.totalWin` →
`commitReservation(payout)`. Failure → `PENDING_SETTLEMENT` → recovery.

## API
- `GET /api/v1/games/andar-bahar/config` → `{ variant, name, limits, sides, tieRule, bets:[{key,label,payout}] }`.
- `POST /api/v1/games/andar-bahar/play` → body `{ bets:[{type,amount}], currency, clientSeed?, idempotencyKey }`.
  Unknown bet key (e.g. `tie`) → **400**; forbidden server-owned fields → **400**. Returns
  `{ roundId, hands, winners, winningBets, isTie, settlement, payout, balance, provablyFair, replayed }`.

## Idempotency · concurrency · recovery · history
Duplicate key → same round, single debit. Concurrency safe. `PENDING_SETTLEMENT` recovers. Traceable via
`GameRound → reservation → wallet transaction → ledger`.

## Mobile UX
`/andar-bahar-money` — shared `CardMoneyBoard`: sticky balance, dealt hands, andar/bahar bet chips with
payouts, stake chips, big Deal. 375/390/412, no demo-wallet.

## Security
`@CurrentUser('id')`; variant from the route; DTO whitelist; scope-gated; server owns
deal/winner/payout/balance.

## Tests
`game-money-card.spec.ts`, `game-money-card.integration.spec.ts` (20 rounds + concurrency + recovery),
`card-money-api.test.ts`, plus the card-engine package spec (`andar-bahar` deal).

## Known limitations
Only the two main side bets are exposed (matching the preset). The board shows dealt cards without an
animated deal sequence (deadline choice).
