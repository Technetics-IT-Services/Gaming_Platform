# Phase 2C.7 — P0 Game Architecture (Instant + Card, on the frozen money core)

This phase onboards **six** P0 real-money games — **Limbo, Coin Flip, Wheel** (instant single-shot) and
**Dragon Tiger, Andar Bahar, Teen Patti** (card single-shot) — on the **existing** money architecture.
Two additive bridge methods were added; **no** frozen financial semantics were modified and **no**
per-game bridge was created.

## 1. Reused, frozen core (unchanged)

`GameMoneyBridgeService` (reserve → engine → commit) → `WalletEngineService` (reservations, ledger,
treasury, settlement, invariant) → `GameRound` / `WalletTransaction` / `Ledger` →
`GameMoneyRecoveryService` (2C.1) → `ProvablyFairService` (HMAC-SHA256). History via
`GameMoneyHistoryService`. No Prisma financial model changed; no migration.

Both new methods follow the proven **single-shot** lifecycle (same as Plinko/Baccarat):
`reserve(stake)` → authoritative engine → `payout = settlement/multiplier` → `commitReservation(payout)`
once; settlement failure → `PENDING_SETTLEMENT` (centralized recovery drains it, idempotent).

## 2. Generic bridge method A — instant games

`GameMoneyBridgeService.playInstant(input)` serves **Limbo, Coin Flip, Wheel** via a single method.

- **Engine:** `engines/instant-engine.ts` — a faithful port of the frontend instant engines
  (`apps/frontend/src/games/instant/{limbo,coin-flip,wheel}-engine.ts`). Pure float→outcome functions
  (`limboOutcome`, `coinOutcome`, `wheelOutcome`) + `parseInstantSelection` (validate before reserve) +
  `playInstant(selection, seed)`.
- **Selection contract:** client sends ONLY its choice — `{ target }` (limbo) / `{ side }` (coin-flip) /
  `{ risk }` (wheel) — plus stake/currency/idempotencyKey.
- **RNG source (documented):** the frontend's runtime provably-fair provider is the **demo xmur3** mix
  (a non-crypto placeholder — "the real provider uses the backend HMAC-SHA256 engine"). The
  authoritative money path derives its float from the real `ProvablyFairService` → `SeededRng`. The
  **game math is byte-identical**; only the float **source** differs (the same, documented situation as
  Plinko 2C.6). Proven by `apps/frontend/src/games/instant/backend-parity.test.ts` (12 tests).

Routes: `GET/POST /games/{limbo,coin-flip,wheel}/{config,play}`.

## 3. Generic bridge method B — card games

`GameMoneyBridgeService.playCard(input)` serves **Dragon Tiger, Andar Bahar, Teen Patti** via a single
method over the **authoritative `@gaming-platform/card-engine`** (the same path Baccarat uses,
parametrized by variant). No card dealing or payout math is duplicated.

- **Engine:** `CardEngineService.play(variant, bets, clientSeed)` → resolves the preset ruleset →
  `ProvablyFairService` commit/seed → `CardEngine.playRound` → authoritative `settlement.totalWin`.
- **Presets (verified, not assumed)** in `games/card-engine/src/presets.ts`:
  - `dragon-tiger` (`high-card`): bets `dragon`/`tiger` (2×), `tie` (9×); tieRule `tie-bet`.
  - `andar-bahar` (`side-match`): bets `andar` (1.97×), `bahar` (2×); tieRule `push`.
  - `teen-patti` (`poker-rank`, hand size 3): bets `player`/`dealer` (2×); tieRule `push`.
- **Scope gate:** `CARD_MONEY_VARIANTS = {dragon-tiger, andar-bahar, teen-patti}` — the generic method
  refuses any other preset, so out-of-scope games (poker, texas-holdem, 32-cards, lucky-7, …) can never
  settle (verified: `lucky-7` play → 404, no route; unknown variant → 400).
- **Bets:** only the **main `bets`** of each preset are exposed (each provably settles); side bets
  (e.g. teen-patti `pair-plus`) are **not** exposed in P0 (documented limitation).

Routes: `GET/POST /games/{dragon-tiger,andar-bahar,teen-patti}/{config,play}`.

## 4. Server authority & the DTO whitelist

Identity from `@CurrentUser('id')`; the `variant`/`gameKey` comes from the route, never the body.
`class-validator` DTOs (`whitelist + forbidNonWhitelisted`) reject any of
`payout/multiplier/result/balance/walletId/userId/serverSeed/win/hands/winners` with **400** (verified
live). The server computes outcome, payout and balance; the UI always renders the authoritative
response balance (never `prev − stake + payout`).

## 5. Idempotency · concurrency · recovery

- **Idempotency:** every play carries an `idempotencyKey`; a duplicate returns the stored round
  (`replayed: true`) with no second debit/ledger entry (verified sequential + concurrent).
- **Concurrency:** 10 concurrent plays → no negative balance, no double debit, ledger balanced (reuses
  the frozen wallet/Redis locking — no new lock).
- **Recovery:** `PENDING_SETTLEMENT` rounds are drained by the shared 2C.1 recovery service (verified
  for both new paths); `commitReservation` is idempotent.

## 6. Verification summary

- Backend jest **151 passing** (+14: 7 instant + 7 card unit); frontend vitest **708 passing** (+27).
- Live integration (`RUN_DB_IT=1`, serial): **9 suites / 71 tests** including the new
  `game-money-instant.integration` (8) and `game-money-card.integration` (8).
- Parity: instant **12 tests** (game math identical, RNG-source difference documented).
- Live HTTP: both waves — auth 401, DTO whitelist, invariant every play, idempotency, insufficient,
  reconcile balanced (difference "0").
- typecheck 0 (be+fe), lint clean, `next build` PASS (6 new static routes), frozen/secret/demo-wallet
  audits clean.

See per-game docs and `PHASE_2C7_FINAL_REPORT.md`.
