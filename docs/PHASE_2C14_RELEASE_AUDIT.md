# Phase 2C.14 — Release Audit (Step 1)

Pre-change inventory for the release freeze. No code was modified before this audit.

## Git state
- **Branch:** `main`
- **HEAD:** `da25d8d feat(tenancy): Production Tenant Persistence & Control Plane (v3.0, Phase 3.2)`
- **Staged:** none.
- **Working tree:** additive new modules (untracked) + a small set of tracked-modified files.

## Change classification (tracked-modified)
| File | Class | Origin |
|------|-------|--------|
| `apps/backend/src/config/configuration.ts` | **Required release fix** | 2C.13 — `cookieSecure` string-coercion bug (`Boolean('false')===true`) fixed to `String(...) === 'true'`. Production `=true` unchanged. |
| `apps/backend/src/modules/users/{users.controller,users.service}.ts` | Feature (additive read) | 2C.10 — `GET /users/me/verification` |
| `apps/backend/src/modules/wallet/{wallet.controller,wallet.module}.ts` | Feature (additive) | 2C.9 — cashier registration |
| `apps/frontend/src/app/(dashboard)/{deposit,withdraw,transactions,profile}/page.tsx` | Feature (presentation) | 2C.9/2C.10 — server-authoritative pages (demo removed) |
| `apps/frontend/src/components/layout/bottom-nav.tsx` | Feature (presentation) | 2C.8 — Play/History nav |
| app.module, next.config, login/register, layout, auth-guard, auth-initializer, mobile-drawer, user-menu, api-client, wallet-api, auth-store, database/package.json, seed.ts, pnpm-lock | **Pre-existing/unrelated** | Dirty before this session (earlier phases / RC baseline) — not modified in 2C.8–2C.14 |

## New (untracked) — additive phase deliverables
`modules/gaming-money/*` (bridge, engines, DTOs, controllers, specs), `modules/wallet/{cashier.service,
cashier.controller,admin-cashier.controller,*.spec}`, all 15 `app/(casino)/*-money/` routes +
`components/games/*-money/`, `app/(casino)/lobby/` + `components/games/lobby/`,
`app/(dashboard)/{verification,responsible-gaming,support}/` + `components/account/`,
`lib/{catalog,cashier-api,account-api,*-money-api}.ts`, `wallet-engine/wallet-concurrency.stress.integration.spec.ts`,
`playwright.mobile.config.ts` + `tests/mobile-cert/`. `.env.production.local` is gitignored.

## Frozen surface — verified UNCHANGED
`git diff --quiet` / `git status` confirm **no modifications** to: `WalletEngineService`,
`wallet-core`, ledger, treasury, settlement, `GameMoneyBridgeService`, all game engine packages
(`games/*-engine`, `instant-engine`, `card-engine`), engine services, runtime, game registry, and the
Prisma financial schema. (`wallet-transaction.service.ts` shows dirty but predates 2C.6 — an unrelated
wallet-history read enhancement.)

## Route inventory (all present — certified in §4/§5 of the final report)
- Auth: `/login`, `/register`.
- Lobby: `/lobby`.
- Games (15): `/{dice,crash,roulette,sic-bo,lottery,baccarat,blackjack,plinko,mines,limbo,coin-flip,
  wheel,dragon-tiger,andar-bahar,teen-patti}-money`.
- History: `/wallet/history`, `/game-history`.
- Wallet/cashier: `/wallet`, `/deposit`, `/withdraw`, `/transactions`.
- Account: `/profile`, `/verification`, `/responsible-gaming`, `/support`, `/settings/security`.
- Backend money/auth/cashier/recovery/history routes all present (per 2C.8–2C.12).

## Environment / production config
- Frontend: `NEXT_PUBLIC_API_URL=/api/v1`, `NEXT_PUBLIC_DEMO_MODE=false`, build with `BACKEND_ORIGIN`
  (same-origin `/api/*` rewrite baked at build).
- Backend: `AUTH_COOKIE_SECURE=true` for HTTPS production (Secure cookie); `DATABASE_URL`, `REDIS_URL`,
  `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGINS`, cashier limit envs, `BOOTSTRAP_ADMIN_*`.

## Conclusion
Repository is in a clean, additive state with a single justified config fix and no frozen-core changes.
Proceeding to certification (final report).
