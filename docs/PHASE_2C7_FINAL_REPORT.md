# Phase 2C.7 — P0 Real-Money Game Expansion — Final Report

## 1. Executive Summary
**Status: COMPLETE.** Six P0 games onboarded as production real-money games on the **existing** money
core: **Limbo, Coin Flip, Wheel** (instant single-shot) and **Dragon Tiger, Andar Bahar, Teen Patti**
(card single-shot). Delivered with **two additive bridge methods** (`playInstant`, `playCard`), engine
ports/preset-reuse, DTOs, routes, mobile-first UIs, tests, live financial verification, and docs. **No
frozen financial semantics were modified. Phase 2C.8 was NOT started.**

## 2. Initial Audit Reference
`docs/PHASE_2C7_AUDIT.md` — established the true production baseline (9 games already live, not 4) and
the two reusable patterns (instant port + card preset). This report implements exactly the approved P0
set.

## 3. Approved Scope
Limbo, Coin Flip, Wheel, Dragon Tiger, Andar Bahar, Teen Patti — and **only** these. No P1 (Keno,
Hi-Lo, Lucky-7, Casino War, Fruit Slots, Bingo, Poker) was implemented.

## 4. Architecture
`docs/PHASE_2C7_GAME_ARCHITECTURE.md`. Single-shot lifecycle reused: `reserve(stake)` → authoritative
engine → `commitReservation(payout)`; failure → `PENDING_SETTLEMENT` → centralized recovery. No per-game
bridge, no duplicated wallet/ledger/reservation/settlement/recovery logic.

## 5. Generic Instant Bridge — `GameMoneyBridgeService.playInstant`
Serves Limbo/Coin Flip/Wheel via `engines/instant-engine.ts` (faithful port). Validates the selection
before reserving; the client sends only its choice (`target`/`side`/`risk`). **PASS.**

## 6. Generic Card Bridge — `GameMoneyBridgeService.playCard`
Serves Dragon Tiger/Andar Bahar/Teen Patti via the authoritative `card-engine` presets (same path as
Baccarat, parametrized by variant). Scope-gated by `CARD_MONEY_VARIANTS`; exposes only main bets. **PASS.**

## 7–12. Game-by-Game (see per-game docs)
| Game | Engine source | Bets/payouts (verified) | Status |
|------|---------------|-------------------------|--------|
| Limbo | port of frontend limbo-engine | target≥1.01, pays target, ~99% RTP | **PASS** |
| Coin Flip | port of frontend coin-flip-engine | heads/tails, 1.98×, 99% RTP | **PASS** |
| Wheel | port of frontend wheel-engine | low/med/high segments, ~96% RTP | **PASS** |
| Dragon Tiger | card-engine preset (high-card) | dragon/tiger 2×, tie 9× | **PASS** |
| Andar Bahar | card-engine preset (side-match) | andar 1.97×, bahar 2× | **PASS** |
| Teen Patti | card-engine preset (poker-rank, 3-card) | player/dealer 2× | **PASS** |

Docs: `LIMBO_MONEY_GAME.md`, `COIN_FLIP_MONEY_GAME.md`, `WHEEL_MONEY_GAME.md`,
`DRAGON_TIGER_MONEY_GAME.md`, `ANDAR_BAHAR_MONEY_GAME.md`, `TEEN_PATTI_MONEY_GAME.md`.

## 13. RTP / Math Verification
Instant: **parity test (12)** proves the ported math is identical to the frontend across the float range;
empirical RTP within band over 40 000 rounds (Limbo/Coin ≈0.99, Wheel ≈0.96). Card: payouts read
directly from the authoritative presets; live config endpoints report them exactly. **PASS.**

## 14. Provably Fair
All six use the real backend `ProvablyFairService` (HMAC-SHA256). Instant games: **RNG-source difference
documented** — the frontend's provider is the demo xmur3 placeholder; the money path uses the real seed;
game math is identical (not claimed byte-identical RNG). Server seed withheld while relevant, revealed on
settlement. Card games use the real primitive end-to-end. **PASS.**

## 15. Money Flow
`balanceAfter = balanceBefore − stake + payout`, `balanceAfter ≥ 0`, ledger `debit === credit`. Verified
live at the service and HTTP layers. **PASS.**

## 16. Idempotency
Duplicate `idempotencyKey` → same round, single debit, no duplicate ledger (verified sequential + concurrent, both waves). **PASS.**

## 17. Concurrency
10 concurrent plays per generic path → no negative balance, no double debit, ledger balanced (reuses the
frozen wallet/Redis lock; no new lock). **PASS.**

## 18. Recovery
`PENDING_SETTLEMENT` rounds recover via the shared 2C.1 `GameMoneyRecoveryService` for both new paths
(live-tested); `commitReservation` idempotent. **PASS.**

## 19. History / Traceability
Every round traces `GameRound → reservation → wallet transaction → ledger`; reused
`GameMoneyHistoryService`. No second history system. **PASS.**

## 20. Security / Server Authority
`@CurrentUser('id')`; variant/gameKey from the route, never the body; DTO `whitelist +
forbidNonWhitelisted` (verified 400 on `payout`, unknown bet, invalid selection). Server owns
outcome/payout/balance. Out-of-scope card variant → 404/400. **PASS.**

## 21. Mobile UX
Six new mobile-first routes (375/390/412, sticky authoritative balance, large touch controls, no
horizontal overflow, loading/result/error states, duplicate-tap protection). Production build compiled
all six as static routes. Verified via build + responsive layout + `data-testid` hooks. **PARTIAL** —
no headless device-emulation E2E was run in this environment (reported honestly; see §28).

## 22. Live Financial Verification (real Postgres + Redis, authenticated HTTP)
- **Wave 1 (instant):** auth 401; DTO rejects `payout`/`target<1.01`/invalid `risk` → 400; 30 plays
  (10 each) invariant every play; idempotency single debit; insufficient rejected; reconcile
  `{debit:39218.5, credit:39218.5, balanced:true, difference:"0"}`. **PASS.**
- **Wave 2 (card):** config payouts correct; DTO rejects `payout`/unknown bet → 400; out-of-scope
  `lucky-7` → 404; 60 rounds (20 each) invariant every round (wins/losses/ties seen); idempotency single
  debit; insufficient rejected; reconcile `{debit:66806.3, credit:66806.3, balanced:true, difference:"0"}`. **PASS.**

## 23. Test Results
| Suite | Before | After | Status |
|-------|--------|-------|--------|
| Backend jest (unit) | 137 | **151** (+14: 7 instant, 7 card) | PASS |
| Backend integration (`RUN_DB_IT=1`, serial) | — | **9 suites / 71 tests** (incl. instant 8, card 8) | PASS |
| Frontend vitest | 681 | **708** (+27: parity 12, instant contract 8, card contract 7) | PASS |
| Instant parity | — | **12** | PASS |

Note: DB integration suites must run **serially** (`--runInBand`) — they share one database and assert
global ledger reconciles; running them in parallel workers causes harness contention (not a code defect).

## 24. Build / Typecheck / Lint
Backend `tsc` **0**; frontend `tsc` **0**; ESLint (new files, be+fe) **clean**; backend `nest build`
**PASS**; frontend `next build` **PASS** (89 static pages, 6 new money routes). **PASS.**

## 25. Frozen Modification Report
**NONE.** All 2C.7 changes live in the untracked `apps/backend/src/modules/gaming-money/` module (new
engine/DTOs/specs + additive `playInstant`/`playCard`/response builders in the bridge & controller) and
new frontend files. Verified via git: the frontend instant/card engines, the `card-engine` package, the
`card` module, and `wallet-engine.service.ts` are **unmodified**. The pre-existing dirty tracked files
(app.module, wallet-transaction.service, auth/frontend files, seed) predate this session (an unrelated
wallet-history feature) and are **not** part of 2C.7.

## 26. Secret Audit
**CLEAN.** No credentials/keys in new source (runtime creds passed via env/CLI only).

## 27. Demo-Wallet Audit
**CLEAN.** Zero `demo-wallet`/`useDemoWallet` references in any new money file; regression tests assert
this (`instant-money-api.test.ts`, `card-money-api.test.ts`).

## 28. Known Limitations
- Mobile verification is build + responsive-layout + `data-testid` (no headless browser E2E in this
  environment) — **honest PARTIAL**.
- Teen Patti `pair-plus` side bet is **not exposed** (only provably-settling main bets); no side bets for
  any card game in P0.
- Instant provably-fair uses a documented **RNG-source difference** vs the frontend demo provider (game
  math identical, not byte-identical RNG).
- Card/Wheel UIs show results without animated deal/spin (deadline choice); results are server-authoritative.
- Live verification used the disposable `gp_phase1` DB with a rotated local admin password (no prod creds).

## 29. Completion Score
**Financial correctness, server authority, idempotency, concurrency, recovery, history, tests,
typecheck, lint, builds, frozen/secret/demo-wallet audits: PASS.** Mobile: **PARTIAL** (no browser E2E).
Overall: **6/6 games production-complete on the financial axis; mobile verified structurally.** No gate
was faked; no critical STOP condition was hit.

## 30. Readiness for Phase 2C.8
The generic `playInstant` and `playCard` methods make the remaining P1 catalog cheap: Keno (instant
port), Hi-Lo/Tower (interactive, Mines pattern), and Lucky-7/Casino War (already-supported card presets,
near-free once exposed). **Phase 2C.8 was not started, per instruction.**
