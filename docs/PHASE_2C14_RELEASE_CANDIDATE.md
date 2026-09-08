# Release Candidate — Real-Money Mobile Gaming Platform (RC, Phase 2C.14)

## Platform scope
A mobile-first, server-authoritative real-money casino platform: authenticated lobby → 15 real-money
games → authoritative balance → game & wallet history → cashier (deposit/withdrawal) → account center
(security / verification / responsible gaming / support). Backed by PostgreSQL + Prisma + Redis + NestJS,
with a double-entry ledger, reservation-based settlement, idempotency, and automatic recovery.

## 15-game catalog (all real-money, server-authoritative)
Dice, Crash, Roulette, Sic Bo, Number Lottery, Baccarat, Blackjack, Plinko, Mines, Limbo, Coin Flip,
Wheel, Dragon Tiger, Andar Bahar, Teen Patti. Each: `GET /games/<g>/config` + `POST …/play`, a `-money`
route, and a canonical catalog entry (`GET /catalog`, server-controlled `enabled`/limits).

## Real-money architecture
`GameMoneyBridgeService` → `WalletEngineService.reserve` → engine → `commitReservation` (bet debit + win
credit) → `WalletTransaction` + double-entry `Ledger` → `GameRound`. Idempotency by unique
`WalletTransaction.reference` + `idempotencyKey` + `GameRound(userId, idempotencyKey)`. Serializable
transactions + optimistic version + Redis per-wallet lock. Contention-deferred settlements park as
`PENDING_SETTLEMENT` and are drained by the recovery scheduler. **Proven: no double-credit at 100
concurrency; 500 mixed ops → all recovered; reconcile "0".**

## Authentication
JWT access token in memory; httpOnly refresh cookie (Secure in production HTTPS via
`AUTH_COOKIE_SECURE=true`); single-flight refresh + rotation with **reuse detection** (old token → 401);
logout revokes the session (refresh rejected after logout). RBAC (`WALLETS_ADJUST`) gates operator/admin.

## Wallet / ledger
Server-authoritative balances; double-entry ledger; `reconcile()` `balanced:true, difference:"0"`;
non-negative algebra. Reads: `/wallet`, `/wallet/summary`, `/wallet/history` (stored balanceBefore/After).

## Cashier
Deposit: `POST /cashier/deposits` → PENDING (no credit) → operator `complete` credits (`DEPOSIT`).
Withdrawal: `POST /cashier/withdrawals` → **funds held immediately** (debit `WITHDRAWAL`) → operator
`approve`+`complete`, or `reject`/player `cancel` → **refund** (`REFUND`). Idempotent; ownership-scoped.
**No external payment gateway — deposits complete via operator (disclosed in-app).**

## Recovery
`PENDING_SETTLEMENT → RECOVERING → RECOVERED/SETTLED`; retry + backoff; terminal `RECOVERY_FAILED` after
max attempts. `GET /games/recovery/health`. Durable in `game_rounds` — restart-safe.

## History / traceability
`GET /games/history(+/:id)`, `/wallet/history`, admin round investigation. JWT-scoped (no cross-user
access). One history system.

## Mobile architecture
Next.js App Router; mobile-first (`max-width` shells, fluid grids, `viewportFit: cover` safe-area);
bottom nav `Home · Play · History · Wallet · Profile` (`md:hidden`, ≥60px, safe-area). Session restored
via the httpOnly refresh cookie. Demo-free core journey.

## Security
Server-derived identity (`@CurrentUser('id')`); DTO whitelist rejects client payout/balance/result/
walletId/ledgerId/status; ownership isolation (403); RBAC on admin; refresh token httpOnly; access token
memory-only; no secrets/server-seeds exposed.

## Test matrix (this RC)
Backend Jest **171**; Frontend Vitest **733**; DB **3** + 4 DB-gated; Integration **79/79**; Stress
**10/10**; Financial E2E **25/25**; Auth-flow **verified**; Recovery **verified** (incl. RECOVERY_FAILED);
Restart persistence **verified**; Mobile 375 & 412 sweeps **PASS** (26 authenticated routes, no overflow).

## Known limitations
- **Physical-device testing pending** (browser device-emulation only in this environment).
- Automated 390×844 mobile sweep flakes on an **HTTP-localhost** refresh-token-rotation artifact under
  rapid full-reloads (not overflow/financial; production HTTPS + SPA nav unaffected).
- DB-integration suites need `connection_limit≥25` (50 used) when run all-in-one-process.

## Deferred features (must remain honestly disclosed — NOT implemented)
External payment gateway · responsible-gaming enforcement · KYC submission · support ticketing. The app
provides informational surfaces only and states these are unavailable — verified: no false claims.

## Deployment requirements
- **HTTPS** (single origin / reverse proxy). Set `AUTH_COOKIE_SECURE=true` (Secure cookie);
  `BACKEND_ORIGIN` at frontend build for the same-origin `/api/*` rewrite; `NEXT_PUBLIC_API_URL=/api/v1`,
  `NEXT_PUBLIC_DEMO_MODE=false`.
- Postgres + Redis provisioned; `prisma db push` (or migrate) applied; seed currencies + RBAC +
  bootstrap admin (`BOOTSTRAP_ADMIN_EMAIL/PASSWORD`).
- Secrets via env: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`.
- Recovery scheduler enabled (default; `NODE_ENV=production`).
- Adequate DB connection pool for expected concurrency.

## Rollback considerations
Additive release: new modules + one config fix; no schema change → **rollback = redeploy the previous
build**. No data migration to reverse. The `configuration.ts` fix is backward-compatible (production
`AUTH_COOKIE_SECURE=true` behaves identically before/after).

## Operational checklist
- [ ] HTTPS + `AUTH_COOKIE_SECURE=true`; verify Secure refresh cookie in prod.
- [ ] Physical-device pass (375/390/412) on real hardware.
- [ ] Provision Postgres/Redis; run schema push + seed; verify `reconcile difference "0"`.
- [ ] Confirm recovery scheduler running; `GET /games/recovery/health` reachable to operators.
- [ ] Confirm deferred features are represented as unavailable (no gateway/KYC/RG-enforcement/tickets).
- [ ] Backups + monitoring on wallet/ledger; alert on `RECOVERY_FAILED`.
