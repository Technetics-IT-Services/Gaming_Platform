# Phase 2C.6 — Real-Money Game Expansion (Crash · Plinko · Mines) — Final Report

**Status: COMPLETE.** Three games onboarded as production real-money games on the **existing** money
architecture, verified live against Postgres + Redis at both the service and HTTP layers. No frozen
financial surface was modified. Phase 2C.7 was **not** started.

## 1. What was delivered

| Game | Reality at audit | Delivered |
|------|------------------|-----------|
| **Crash** | Already production (Phase 2C.2) | **Reused unchanged**, re-verified live |
| **Plinko** | Frontend demo-only (no backend engine) | Server-authoritative engine port + single-shot money endpoint + mobile UI |
| **Mines** | Frontend grid-reveal only | Server-authoritative engine port + interactive money lifecycle + mobile UI |

Audit-first: `docs/PHASE_2C6_AUDIT.md` was produced before any code.

## 2. Reuse (not rebuild)

- **`GameMoneyBridgeService`** is the single money path for all three games — **no**
  `CrashMoneyBridgeService` / `PlinkoMoneyBridgeService` / `MinesMoneyBridgeService` was created. Game
  code is limited to DTO mapping, validation, engine invocation, and result transformation.
- Reservations, ledger, treasury, settlement, and recovery (2C.1) are the frozen
  `WalletEngineService` / `GameMoneyRecoveryService`, called — never re-implemented.
- Provably-fair reuses `ProvablyFairService`; `GameRound.actionSeq` (2C.4) is reused for the Mines
  lock. **No Prisma financial model changed; no migration required.**

## 3. Frozen-core audit — PASS

- Game engines, `GameRuntime`, engine registry, `WalletEngineService` financial logic, wallet-core,
  Ledger, Treasury, Settlement, reservations, GameMoneyBridge/Recovery **financial semantics**, auth,
  Prisma financial models, RTP/payout math, and provably-fair-inside-engines: **untouched**.
- The **original frontend Plinko engine** (`apps/frontend/src/games/plinko/math.ts`,
  `provably-fair.ts`) is **byte-identical** (empty git diff); only a parity **test file** was added to
  its directory.
- Additive-only changes: new `engines/plinko-engine.ts`, `engines/mines-engine.ts`, DTOs, bridge
  methods, controller routes, and new frontend money files/routes.
- The one frozen-looking `M` file in the tree — `wallet-engine/services/wallet-transaction.service.ts`
  — is a **pre-existing, unrelated** transaction-history read enhancement (currency/date filters, no
  wallet/ledger/balance math) that was already dirty before this phase and is **not** part of 2C.6.
- Secret scan: no credentials in source (the only match is a redaction **allowlist** of fields to
  strip from history responses). Runtime credentials were passed via env/CLI, never written to source.

## 4. Parity — proven (Plinko)

Per the mid-phase requirement, the Plinko port was **mechanically** verified against the frontend for
**all 15 boards** (rows∈{8,10,12,14,16} × risk∈{low,medium,high}) via
`apps/frontend/src/games/plinko/backend-parity.test.ts` — 23 tests: identical multiplier table,
expected RTP, binomial probabilities, landing-bin, and payout multiplier; empirical RTP over 40 000
rounds within 0.02 of theoretical. The single difference is the **RNG source** (frontend per-row
`nextFloat` vs server single `SeededRng` stream) — a documented RNG-primitive difference, **not** a
game-math discrepancy. The original engine was not altered.

## 5. Financial invariants — verified live

`balanceAfter = balanceBefore − stake + payout`, `balanceAfter ≥ 0`, ledger `debit === credit`,
`reconcile.balanced === true / difference === "0"`. Full detail in
`PHASE_2C6_FINANCIAL_VERIFICATION.md`. Highlights:

- **Service integration (`RUN_DB_IT=1`): 8/8** — Plinko 10 drops, Mines 5 sessions (safe reveal /
  cashout / mine-hit), concurrency (actionSeq advances once), restart reconstruction, recovery,
  reconcile balanced.
- **HTTP smoke (authenticated):** auth guard `401`; DTO whitelist rejects `payout` and `rows=7` with
  `400`; Plinko 10 drops invariant every drop; duplicate `idempotencyKey` → single debit; Mines 5
  sessions with board hidden-while-active / revealed-on-settle; insufficient balance rejected;
  `reconcile → {"debit":"16581.1","credit":"16581.1","balanced":true,"difference":"0"}`.

## 6. Security & server authority

- Clients send only their choices; `payout/bin/multiplier/board/result/serverSeed/walletId/userId`
  are rejected by `whitelist + forbidNonWhitelisted` (verified `400` live).
- `@CurrentUser('id')` supplies identity; suspended/banned users are refused.
- Server-authoritative balance everywhere — the UI syncs from the response, never
  `prev − stake + payout`. No demo-wallet dependency on any money path (regression-tested).
- Provably-fair server seed withheld while a round is live; revealed on settlement.

## 7. Regression — all green

| Gate | Result |
|------|--------|
| Backend `tsc` | 0 errors |
| Backend jest (unit) | 137 passing / 27 suites |
| Backend jest (integration, plinko/mines) | 8 passing |
| Frontend `tsc` | 0 errors |
| Frontend vitest | 681 passing / 55 files |
| Plinko parity | 23 passing |
| ESLint (new files) | clean |
| Frontend `next build` | exit 0 (`/plinko-money`, `/mines-money`, `/crash-money` compiled) |

## 8. Mobile UX

Mobile-first at 375/390/412; no horizontal overflow; sticky authoritative balance; large touch
targets; safe-area & bottom-nav compatible; actionable errors. Detail in `PHASE_2C6_MOBILE_UX.md`.

## 9. Files

**Backend (additive):** `engines/plinko-engine.ts`, `engines/mines-engine.ts`,
`dto/play-plinko.dto.ts`, `dto/mines.dto.ts`; `game-money-bridge.service.ts` (+playPlinko/startMines/
minesState/minesReveal/minesCashout/settleMines), `game-money.controller.ts` (+7 routes);
`game-money-plinko-mines.spec.ts`, `game-money-plinko-mines.integration.spec.ts`.

**Frontend (additive):** `lib/plinko-money-api.ts`(+test), `lib/mines-money-api.ts`(+test);
`components/games/plinko-money/*`, `components/games/mines-money/*`;
`app/(casino)/plinko-money/page.tsx`, `app/(casino)/mines-money/page.tsx`;
`games/plinko/backend-parity.test.ts`.

**Docs:** `PHASE_2C6_AUDIT.md`, `PHASE_2C6_GAME_MONEY_ARCHITECTURE.md`, `CRASH_MONEY_GAME.md`,
`PLINKO_MONEY_GAME.md`, `MINES_MONEY_GAME.md`, `PHASE_2C6_MOBILE_UX.md`,
`PHASE_2C6_FINANCIAL_VERIFICATION.md`, `PHASE_2C6_FINAL_REPORT.md`.

## 10. Honest limitations

- Live verification used the disposable `gp_phase1` Postgres/Redis; the seeded super-admin password
  was rotated to a local throwaway value for the HTTP smoke (idempotent re-seed) — no production
  credentials involved.
- Mobile verification covered the production **build** + `data-testid` hooks + responsive layout
  review; no headless device-emulation E2E was run in this environment.

**Phase 2C.7 was not started, per instruction.**
