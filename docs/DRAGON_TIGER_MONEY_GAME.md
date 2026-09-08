# Dragon Tiger — Real Money (Phase 2C.7)

Single-shot real-money Dragon Tiger via the generic card bridge (`playCard`) over the **authoritative
`@gaming-platform/card-engine`**. The dealt cards, winner, winning bets, payout and balance are
server-authoritative (no demo wallet).

## Rules (from the repository preset — authoritative, not assumed)
`games/card-engine/src/presets.ts` → `dragon-tiger`: `evaluationMode: 'high-card'`, hand size 1, sides
`dragon`/`tiger`. One card is dealt to each side; the **higher card wins**. Bets:
- `dragon` — pays **2×**
- `tiger` — pays **2×**
- `tie` — pays **9×**
- `tieRule: 'tie-bet'` — on a tie the tie bet wins; dragon/tiger bets push (stake returned).

## Backend engine reused
`CardEngineService.play('dragon-tiger', bets, clientSeed)` → `VariantResolver.resolve` →
`ProvablyFairService` commit/seed → `CardEngine.playRound` (`high-card` strategy) →
`ResultCalculator.settle` → authoritative `settlement.totalWin`. No dealing or payout math duplicated.

## RTP / payout math
Defined by the preset payout table + `tie-bet` rule (dragon/tiger even-money with tie-push;
tie bet 9×). Live: 20 rounds — invariant held every round, wins & losses (and a tie) observed;
`config` reports the exact payouts (`dragon 2×, tiger 2×, tie 9×`).

## Provably fair
Real `ProvablyFairService` (HMAC-SHA256): commit → derive seed → deterministic shuffle/deal. Server seed
revealed on settlement (single-shot); the deal is reproducible from the seed. No RNG-source caveat here —
the card path uses the real primitive end-to-end.

## Money flow
`reserve(totalStake)` → `card.play('dragon-tiger', bets)` → `payout = settlement.totalWin` →
`commitReservation(payout)`. Failure → `PENDING_SETTLEMENT` → recovery. Per-bet limits from the ruleset.

## API
- `GET /api/v1/games/dragon-tiger/config` → `{ variant, name, limits, sides, tieRule, bets:[{key,label,payout}] }`.
- `POST /api/v1/games/dragon-tiger/play` → body `{ bets:[{type,amount}], currency, clientSeed?, idempotencyKey }`.
  Unknown bet key → **400**; forbidden server-owned fields → **400**. Returns `{ roundId, hands, winners, winningBets, isTie, settlement, payout, balance, provablyFair, replayed }`.

## Idempotency · concurrency · recovery · history
Duplicate key → same round, single debit. 10 concurrent rounds → no negative balance, ledger balanced.
`PENDING_SETTLEMENT` recovers via `GameMoneyRecoveryService`. Traceable via
`GameRound → reservation → wallet transaction → ledger`.

## Mobile UX
`/dragon-tiger-money` — shared `CardMoneyBoard`: sticky balance, dealt hands with a 👑 winner marker,
config-driven bet chips (dragon/tiger/tie + payouts), stake chips, big Deal. 375/390/412, no demo-wallet.

## Security
`@CurrentUser('id')`; variant from the route (not the body); DTO whitelist; scope-gated to the approved
3 card variants (`CARD_MONEY_VARIANTS`); server owns hands/winner/payout/balance.

## Tests
`game-money-card.spec.ts` (unit), `game-money-card.integration.spec.ts` (live, 20 rounds + concurrency +
recovery), `card-money-api.test.ts` (contract + no-demo-wallet), plus the card-engine package spec.

## Known limitations
Only main bets (`dragon`/`tiger`/`tie`) are exposed; no side bets. The board shows the dealt cards but
no animated reveal (deadline choice).
