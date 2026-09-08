# Production Foundation & Database Baseline (Phase 1)

Status legend: **IMPLEMENTED** (code exists & is real) · **VERIFIED** (proven live this phase) ·
**DEMO-ONLY** (frontend/in-memory reference) · **DEFERRED** (later phase) · **BLOCKER** (cannot complete
in this environment).

Phase 1 is **foundation only** — it integrates around the frozen core and establishes a reproducible,
persistent database baseline. No frozen module was modified; no deposits/withdrawals/partner/bonus/game
work was done.

## 1. Architecture discovered

- **Monorepo** (pnpm + turbo). `apps/backend` = **NestJS 10** (Prisma 6, Passport-JWT, ioredis, otplib,
  helmet, throttler, nodemailer, swagger). `apps/frontend` = **Next.js 15.5** (App Router, axios, Zustand).
- **Packages:** `database` (Prisma), `auth`, `config`, `shared`, `ui`, `types`, plus engine packages
  (`card/crash/dice/roulette/sports/lottery-engine`, `wallet-core`, `game-sdk`, `ops-core`, …).
- **Frozen core** (unchanged this phase): `apps/frontend/src/runtime/**`, game registry, session manager,
  event bus, wallet-core, ledger, treasury, payments, compliance, operations, CRM, partner, analytics,
  security, integrations, resilience, performance, existing games.
- **Two-layer reality:** the backend is the real persistent product surface; large parts of the frontend
  (the game-expansion sprint games, deposit/withdraw screens, most CRM screens, and the entire multi-tenant
  control plane in `apps/frontend/src/lib/tenancy/**`) are **DEMO-ONLY / in-memory** and not wired to the
  backend. (See Phase-0 Client Acceptance Audit.)

## 2. Database architecture

- Prisma, **PostgreSQL**, multi-file schema `packages/database/prisma/schema/*.prisma` (16 files).
- **126 models, 69 enums.** UUIDv7 PKs (`@default(uuid(7))`), `Decimal(38,18)` money, `JsonB`, `createdAt`/
  `updatedAt`, `deletedAt` soft-delete. Datasource `url = env("DATABASE_URL")`.
- Financial/auth models present: `User`, `Session`, `RefreshToken`, `TwoFactorAuth`, `Wallet`,
  `WalletBalance`, `WalletTransaction`, `Ledger`, `LedgerEntry`, `LockedFunds`, `DepositRequest`,
  `WithdrawalRequest`. **No Tenant/Partner/Commission models** (multi-tenancy is frontend-only). — VERIFIED

## 3. Migration process

- **Before Phase 1:** no `migrations/` directory — the project used `prisma db push` (no history). — DISCOVERED
- **This phase:** generated a reproducible **initial migration baseline** (Prisma **6.x**, the project's
  pinned major) into `packages/database/prisma/schema/migrations/00000000000000_init/migration.sql`
  (+ `migration_lock.toml`, provider `postgresql`). **126 CREATE TABLE, 316 CREATE INDEX, 166 FKs,
  69 CREATE TYPE.** — IMPLEMENTED
- **Proven from zero:** applied to a **clean, disposable** `postgres:16-alpine` container (empty DB) with
  `ON_ERROR_STOP=1`, exit 0, no errors. Post-apply verification: **126 tables, 442 indexes (incl.
  PK/unique), 166 FKs, 69 enums**; all key financial/auth tables materialized. — VERIFIED
- **Non-destructive:** no `migrate reset`, no `DROP DATABASE`, no reset against any shared DB. The proof ran
  on a throwaway container only.

**Reproducible commands (operator, with the pinned CLI installed):**
```bash
# from packages/database (schema = prisma/schema)
pnpm --filter @gaming-platform/database db:generate      # prisma generate
pnpm --filter @gaming-platform/database db:migrate:deploy # prisma migrate deploy (applies the baseline)
```
The baseline SQL is committable and applies identically to any empty database.

## 4. Redis architecture

- `ioredis` + `apps/backend/src/modules/redis`. `.env` provides `REDIS_URL`/`REDIS_HOST`/`REDIS_PORT`/
  `REDIS_TTL`. Used for cache/rate-limit/session infra contracts. — IMPLEMENTED
- **Live check:** disposable `redis:7-alpine` → `redis-cli ping` → **PONG**. — VERIFIED

## 5. Environment configuration

- Env-driven, layered `.env`, `.env.example`, `.env.{development,staging,production}`. Backend validates env
  (`apps/backend/src/config/env.validation.ts`). Keys: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET`, `BCRYPT_SALT_ROUNDS`, `CORS_ORIGINS`, `NEXT_PUBLIC_API_URL`, etc. No hardcoded
  secrets in code. — IMPLEMENTED / VERIFIED
- **Note:** `.env` `DATABASE_URL` targets `localhost:5432/gaming_platform`; in the audit sandbox that port
  is occupied by an unrelated project's Postgres — operators must point it at the platform's own DB.

## 6. Backend startup

- `apps/backend/src/main.ts`: `helmet`, `cookieParser`, env-driven `enableCors({credentials:true})`,
  global `ValidationPipe`, URI versioning, **`enableShutdownHooks()`** (graceful shutdown),
  `listen(port, host)`, no secrets logged. — IMPLEMENTED
- **Live boot BLOCKED in this sandbox** — see Known Blockers (ungenerated Prisma client).

## 7. Authentication persistence

- `apps/backend/src/modules/auth`: bcrypt password hashing (timing-safe compare), Prisma-persisted
  `RefreshToken`, `Session`, `EmailVerificationToken`, `PasswordResetToken`, `TwoFactorAuth`; JWT access +
  refresh; `roles.guard.ts` + `jwt-auth.guard.ts` RBAC. Frontend `(auth)/*` wired via `auth-api.ts`. —
  IMPLEMENTED (code verified); runtime persistence — BLOCKER (no live boot).

## 8. Wallet/Ledger verification

- **Read/verify only — not modified.** `wallet-engine/services/wallet-ledger.service.ts` implements a real
  double-entry **`reconcile()`**: `{ debit, credit, balanced: Money.eq(debit, credit), difference }` over
  `LedgerEntry` (`groupBy` by direction). Tables `wallets`, `wallet_balances`, `wallet_transactions`,
  `ledgers`, `ledger_entries`, `locked_funds` exist and materialize from the baseline. — IMPLEMENTED (code);
  live `systemSum === 0` runtime proof — BLOCKER (no live boot).

## 9. Existing game verification

- Backend game modules (crash/dice/roulette/card/sports) are Prisma-wired via the frozen runtime; the
  6 game-expansion sprint games (Plinko/Hi-Lo/Fruit-Slots/Sic-Bo/Lottery/Poker) + instant games are
  **DEMO-ONLY** (frontend `GameRuntime` + `useDemoWallet`, not backend-wired). Live authenticated
  stake→settle→ledger smoke test — BLOCKER (no live boot). Demo boundary = `apps/frontend/src/stores/
  demo-wallet.ts`.

## 10. Mobile connectivity

- Frontend API base is env-driven (`NEXT_PUBLIC_API_URL`, default `.../api/v1`, `.env` → `:4100`), axios
  `withCredentials` + bearer + refresh-cookie interceptors (`api-client.ts`). CORS env-driven with
  credentials. Root layout exports a Next `viewport`; `components/layout/bottom-nav.tsx` = mobile-first
  navigation; Tailwind responsive utilities throughout. — IMPLEMENTED (static). Live 375/390/412 device
  verification — DEFERRED (requires a live backend + browser session).

## 11. Test commands

```bash
# frontend (safe, no DB): 559 tests pass
pnpm --filter @gaming-platform/frontend test     # vitest run
pnpm --filter @gaming-platform/frontend typecheck # tsc (clean)
pnpm --filter @gaming-platform/frontend lint       # eslint (clean)
# backend (requires generated Prisma client + DB):
pnpm --filter backend typecheck  # BLOCKED until `prisma generate`
pnpm --filter backend test        # jest (unit specs mock Prisma; some need DB)
```

## 12. Known blockers

- **BLOCKER — Prisma client not generated / pinned CLI not installed (sandbox).** `.prisma/client` is
  absent; `@prisma/client` model accessors are missing → backend typecheck fails
  (`Property 'user'/'auditTrail'/'$transaction' does not exist on PrismaService`), and the backend cannot
  instantiate `PrismaClient`. **Cause:** deps/generation incomplete in this environment + no-install
  constraint. **Fix (operator):** `pnpm install` then `prisma generate`. **Not a code defect.**
- **BLOCKER — no DB reachable at the configured URL in-sandbox.** Port 5432 is held by unrelated projects;
  `DATABASE_URL` points there. Proof-of-migration ran on a disposable container instead.
- **DEFERRED — deposits, withdrawals, finance approval, partner payouts, bonuses, tenant persistence,
  SMS/push, KYC** — later phases (Phase 2+). The multi-tenant control plane is in-memory and unwired.

## 13. Production deployment prerequisites

1. `pnpm install` (full workspace) + `prisma generate` (all engines built).
2. Provision Postgres + Redis; set `DATABASE_URL`/`REDIS_URL` to platform-owned instances (not shared ports).
3. `prisma migrate deploy` (applies the committed baseline).
4. Set JWT/cookie/mail secrets via the environment (never committed).
5. Boot backend (`node dist/main.js`) — verify DB + Redis connect, graceful shutdown.
6. Point frontend `NEXT_PUBLIC_API_URL` at the backend; verify CORS + auth round-trip on mobile viewports.
7. Run the full test suite (frontend + backend) once the client is generated.
