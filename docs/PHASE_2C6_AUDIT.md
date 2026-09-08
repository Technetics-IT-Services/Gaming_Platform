# Phase 2C.6 — Audit (Crash · Plinko · Mines real-money)

Read-first audit. Findings are honest about what already exists.

## 1. Existing game / money architecture

The proven money path (Phases 2B–2C.5): `@CurrentUser('id')` → `GameMoneyController` →
`GameMoneyBridgeService` (validate player/currency/stake, idempotency `@@unique([userId,
idempotencyKey])`, `reserve` → engine → `commitReservation`, `GameRound` record) → frozen
`WalletEngineService` + ledger → `GameMoneyRecoveryService` (durable PENDING_SETTLEMENT recovery). Two
round shapes already implemented: **single-shot** (dice/roulette/sic-bo/baccarat) and **interactive**
(crash cash-out; blackjack via a guarded `action_seq` optimistic lock + deterministic seed replay).
`ProvablyFairService` (`deriveSeed`) + `SeededRng` (`@gaming-platform/game-sdk`) are the shared
provably-fair primitives every backend game uses.

## 2. Crash audit — **ALREADY DONE (Phase 2C.2)**

Crash real-money exists: bridge `playCrash` / `cashoutCrash` (interactive live model, hidden
deterministic crash point via `ProvablyFairCrashGenerator`, server-authoritative multiplier from
elapsed time, `settleCrash`), routes `GET /games/crash/config|state`, `POST /games/crash/play|cashout`,
frontend `crash-money-api.ts` + `CrashMoneyBoard` + `/crash-money`, recovery-integrated. **Action:
reuse and re-verify live; do not rebuild.**

## 3. Plinko audit

A complete, pure, provably-fair Plinko engine exists **on the frontend** (`src/games/plinko/`):
`math.ts` (binomial probabilities + RTP-calibrated multiplier tables, ~96.5% RTP, derived not
hardcoded), `provably-fair.ts` (per-row path from a fairness proof → landing bin), `engine.ts`
(`stake × table[bin]`). Config: `PLINKO_ROWS = [8,10,12,14,16]`, `PLINKO_RISKS = ['low','medium',
'high']`. **There is NO backend Plinko engine.** For real money the outcome must be server-authoritative,
so the pure math must run server-side.

## 4. Mines audit

A `GridRevealEngine` ("Mines 5×5") exists **on the frontend** (`src/games/instant/grid-reveal-engine.ts`):
`gridMultiplier(tiles, mines, k) = Π (tiles-i)/(tiles-mines-i)` with a 1% house edge; mine board from a
fairness-seeded shuffle; interactive `reveal`/`cashout`; hit a mine → lose. **No backend Mines engine.**
Interactive → needs the reservation + `action_seq` lifecycle, server-authoritative board.

## 5. Existing frontend audit

Dice/crash/…-money boards are the UX reference: inline-styled, mobile-first (maxWidth cap,
`boxSizing:border-box`, fluid grids, sticky authoritative balance, `data-testid`s), react-query hooks,
`apiClient` + `unwrap`, no demo wallet. Auth/session hardened in 2C.5 (single-flight bootstrap). The
demo `/plinko` and instant `grid-reveal` routes exist and **must remain untouched**.

## 6. Existing money bridge audit

`GameMoneyBridgeService` exposes reusable private helpers: `loadPlayer`, `loadCurrency`, `assertStake`,
`walletView`, `betSummary`, `money`, `fail`, `safeRelease`, `currencyCode`, plus `recover()` (extended
in 2C.4 for extra reservations) and the interactive `action_seq` pattern from blackjack. `GameRound`
has `stake/payout/status/gameKey/betType/idempotencyKey/reservationId/betTransactionId/result/fairness/
actionSeq/settledAt` — sufficient for both Plinko (single-shot) and Mines (interactive, state in
`result` JSON + `action_seq`). **No schema change required.**

## 7. Reusable abstractions identified

Backend: the whole bridge/recovery/reservation/idempotency/`action_seq` machinery; `ProvablyFairService`
+ `SeededRng`. Frontend: the money-board pattern, hooks, api-client, history (`/games/history`).

## 8. What can be reused

- **Crash**: entirely (verify only).
- **Plinko**: single-shot bridge path (mirror roulette/dice); history; recovery; provably-fair primitives.
- **Mines**: interactive bridge path (mirror blackjack `start`/`action`/`cashout` + `action_seq` +
  seed replay + PENDING_SETTLEMENT recovery).

## 9. What must be added (all additive)

- `gaming-money/engines/plinko-engine.ts` — server-authoritative **faithful port** of the frontend
  Plinko math (identical tables/RTP) + path derivation via `deriveSeed`+`SeededRng`.
- `gaming-money/engines/mines-engine.ts` — server-authoritative Mines: `gridMultiplier` (ported), mine
  placement via `SeededRng.shuffle`, reveal/cashout, deterministic from seed.
- Bridge methods: `playPlinko`; `startMines` / `minesReveal` / `minesCashout`.
- DTOs: `PlayPlinkoDto`; `StartMinesDto` / `MinesRevealDto`.
- Controller routes: `GET /games/plinko/config`, `POST /games/plinko/play`; `GET /games/mines/config`,
  `POST /games/mines/start`, `GET /games/mines/:roundId`, `POST /games/mines/:roundId/reveal`,
  `POST /games/mines/:roundId/cashout`.
- Frontend: `plinko-money` + `mines-money` (api + hook + board + route + tests). A small shared
  `GameBalanceHeader`/`StakeChips` primitive if ≥2 boards use it.
- Docs + tests.

## 10. Frozen files (must NOT change)

Game engines & packages (`games/*`, the frontend `src/games/plinko` + `src/games/instant`), GameRuntime,
registry, `WalletEngineService` financial logic, wallet-core, ledger, treasury, settlement, reservation
service, payments, `GameMoneyBridgeService`/`GameMoneyRecoveryService` **financial semantics**, backend
auth, Prisma financial schemas (no change needed), existing money games (dice/crash/roulette/sic-bo/
baccarat/blackjack/lottery), RTP/payout math inside engines.

## 11. Risks

- **Plinko RTP fidelity**: the backend port must reproduce the exact multiplier tables → mitigate by
  copying `math.ts` verbatim (pure functions) and unit-testing table equality / RTP ∈ [0.96, 0.97].
- **Mines interactive concurrency**: double reveal / double cashout → mitigate with the proven
  `action_seq` guarded claim + deterministic seed replay (no in-memory state; restart-safe).
- **Server authority**: client must never send board/mult/payout → DTO whitelist + server derivation.

## 12. Implementation plan

Engines (port) → bridge methods → DTOs/controller/module → unit tests → live integration (gated
`RUN_DB_IT=1`) → frontend api/hook/board/route/tests → live HTTP verification → mobile → regression →
frozen/secret audit → docs → final report. Reuse Crash as-is.

## 13. Test plan

Backend unit (mocked wallet/prisma, real engine): Plinko validation/payout/idempotency/insufficient;
Mines start/reveal/hit/cashout/idempotency/wrong-user. Live integration (real PG/Redis): 10+ Plinko
rounds + 5+ Mines sessions, invariant `balanceAfter = balanceBefore − stake + payout`, reconcile
balanced, no dup ledger, recovery, concurrency. Frontend: api contract + no-demo-wallet regression.

## 14. Mobile validation plan

Production build + HTTP 200 for `/plinko-money`, `/mines-money`, `/crash-money`; static fluid-layout
scan; authenticated HTTP flows (build/HTTP/authenticated-API evidence; headless board-render per the
documented 2C.5 `.env.production.local` build fix).
