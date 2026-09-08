# Phase 2C.15 — Release Audit (Step 1)

Pre-certification inventory for the **final Release Candidate go/no-go**. No code was modified in 2C.15
before or during this audit (verification, not development).

## Git state
- **Branch:** `main`
- **HEAD:** `da25d8d feat(tenancy): Production Tenant Persistence & Control Plane (v3.0, Phase 3.2)`
- **Staged:** none.
- **Working tree:** additive new modules (untracked, from 2C.6–2C.13) + a small set of tracked-modified
  files carried from earlier phases. **2C.15 added zero code.**

## Change classification (tracked-modified)
| File | Class | Verdict |
|------|-------|---------|
| `apps/backend/src/config/configuration.ts` | **Required release fix (2C.13)** | `cookieSecure: String(env.AUTH_COOKIE_SECURE) === 'true'` — fixes `Boolean('false')===true`. Retained per instruction; production `=true` behaviour identical. **Not a 2C.15 change.** |
| `apps/backend/src/modules/wallet-engine/services/wallet-transaction.service.ts` | **Read-model enhancement (pre-2C.6)** | Diff is **read-only**: adds `fee/balanceBefore/currency/metadata` to `TransactionView`, adds `currency`/`from`/`to` filters + `dateRange()` to `list()`/`findById()` (`findMany`/`findFirst` only). **Touches no write/settlement/ledger/version primitive** (verified by diff). Not a financial-core change. |
| users/wallet controller+module, frontend dashboard/auth/nav pages, api-client, wallet-api, auth-store, seed.ts, pnpm-lock, next.config, app.module | Feature (additive) / Pre-existing | 2C.8–2C.10 deliverables + RC baseline dirt. Not 2C.15. |

## New (untracked) — additive phase deliverables (2C.6–2C.13)
`modules/gaming-money/*` (bridge, engines, DTOs, controllers, specs); `modules/wallet/{cashier.service,
cashier.controller,admin-cashier.controller,*.spec}`; all 15 `app/(casino)/*-money/` routes +
`components/games/*-money/`; `app/(casino)/lobby/` + `components/games/lobby/`;
`app/(dashboard)/{verification,responsible-gaming,support}/` + `components/account/`;
`lib/{catalog,cashier-api,account-api,*-money-api}.ts`; the concurrency stress spec;
`playwright.mobile.config.ts` + `tests/mobile-cert/`. `.env.production.local` is gitignored.

## Frozen surface — verified UNCHANGED (Step 2 / Step 18)
`git diff` confirms **no tracked modification** to: `WalletEngineService`, wallet-core, ledger, treasury,
**settlement**, `GameMoneyBridgeService`, `ProvablyFairService`, all game engine packages (`games/*-engine`,
`instant-engine`, `card-engine`), engine services, runtime, game registry, and the Prisma **financial
schema**. The single dirty wallet-engine file is the read-only history projection above — it moves no money.
**No `PHASE_2C15_FROZEN_CHANGE_PROPOSAL.md` was required: no frozen change was necessary.**

## Route inventory (all present — certified in the final report)
- Auth `/login` `/register`; Lobby `/lobby`; 15 games `/{dice,crash,roulette,sic-bo,lottery,baccarat,
  blackjack,plinko,mines,limbo,coin-flip,wheel,dragon-tiger,andar-bahar,teen-patti}-money`; History
  `/wallet/history` `/game-history`; Wallet/cashier `/wallet` `/deposit` `/withdraw` `/transactions`;
  Account `/profile` `/verification` `/responsible-gaming` `/support` `/settings/security`.

## Conclusion
Repository is in a clean, additive state with a single justified config fix and **no frozen-core changes**.
Proceeding to certification. Any code change in this phase would be a defect fix only — none was found to be
required.
