# Phase 2C.17 — Phase A Defect Audit (pre-implementation)

**No code written yet.** This document traces each defect, its complete call path, the smallest safe
change, affected tests, and which existing primitives already provide what is needed.

Environment used: disposable Postgres `gp_phase1_pg` (:55432) + Redis `gp_phase1_redis` (:56379),
backend on :4100, frontend dev on :3100. All findings below are reproduced against that live stack.

---

## Summary

| # | Defect | Severity | Class | Smallest safe fix |
| --- | --- | --- | --- | --- |
| P0-1 | `/dashboard` shows demo money to real sessions | P0 | Frontend-only | Gate 2 components on `useRealSession()`, source from existing wallet/history APIs |
| P0-2 | `/admin/*` reachable by any authenticated user | P0 | Frontend-only | Additive `AdminGuard` reusing existing `hasPermission`/`hasRole` |
| P0-3 | No audit records for cashier operator actions | P0 | Backend, additive | Call the existing `AuditService.record()` from `CashierService` |
| P0-4 | No large-withdrawal escalation | P1 | Backend, additive + **BUSINESS-CONFIG REQUIRED** | Server-side env threshold, **disabled by default**; persist in existing `metadata` JSON |
| **P0-5** | **Withdrawal approval returns HTTP 500 — always** | **P0 — NEW** | Backend, 1-line class of fix | Stop writing a `users.id` into an `admin_users` FK |

**P0-5 was not in the Phase 2C.16 matrix.** It was found during this audit by executing the workflow
against the live stack rather than reading it. It is the most severe item in this phase: **operators
cannot approve any withdrawal at all**, so approved-path player funds stay held indefinitely.

---

## P0-5 — Withdrawal approval is broken in production (NEW, most severe)

### Reproduction (live, this stack)

```
POST /api/v1/cashier/withdrawals            → 200  status UNDER_REVIEW, funds held
POST /api/v1/admin/cashier/withdrawals/:id/approve
                                            → 500  Internal server error
```

Backend log:

```
PrismaClientKnownRequestError:
Invalid `prisma.withdrawalRequest.update()` invocation:
Foreign key constraint violated on the constraint: `withdrawal_requests_reviewed_by_id_fkey`
  at CashierService.approveWithdrawal (cashier.service.js:201)
```

### Root cause

Two **separate identity tables** exist:

| Table | Rows (this DB) | Purpose |
| --- | --- | --- |
| `users` | 522 | The real identity system. Operators authenticate here and carry RBAC roles. |
| `admin_users` | **0** | A parallel admin-identity table (own `email`, `username`, `password_hash`, `role_id`). Unused by the platform. |

Schema constraint (verified with `pg_get_constraintdef`):

```
withdrawal_requests_reviewed_by_id_fkey
  FOREIGN KEY (reviewed_by_id) REFERENCES admin_users(id)
```

Call path:

```
admin-cashier.controller.ts:41   approveWithdrawal(@CurrentUser('id') adminId, ...)
                                 ↑ this is a users.id (JWT subject)
cashier.service.ts:206-211       prisma.withdrawalRequest.update({ data: { reviewedById: adminId } })
                                 ↑ column FK-constrained to admin_users.id → P2003 → 500
```

`@CurrentUser('id')` yields the JWT subject, which is always a `users.id`. It can never satisfy an
`admin_users` FK. Therefore **every** approval fails, for every operator, always.

### Why no test caught it

`wallet/cashier.integration.spec.ts:93`:

```ts
await cashier.approveWithdrawal(wd.id, undefined);   // ← adminId undefined ⇒ reviewedById: null
```

The test passes `undefined`, so the FK is never exercised. The production controller **always** passes
a real id. The test asserts a code path the product does not use. Compounding it, the whole suite is
`const d = RUN ? describe : describe.skip` (line 20) and is one of the 10 suites skipped by default —
so it does not even run in `pnpm test`.

### Money safety (verified, not assumed)

The failed update is a single atomic statement. Post-failure DB state:

```
status = UNDER_REVIEW | reviewed_by_id = NULL | held = true
```

No partial write, no double refund, no lost hold, no negative balance. The defect is a **workflow
outage**, not a ledger corruption. The player's funds remain correctly held.

### Smallest safe change

Do **not** adopt `admin_users` — that is a second identity system, and the brief forbids duplicating
existing systems. Do **not** drop the schema FK (schema change on a financial table).

`AdminUser` already carries `userId String? @unique` — an optional link to `users`. So:

1. Resolve `reviewedById` by looking up `AdminUser` **by** `userId`; use its id when an operator has a
   linked admin record, otherwise `null` (the column is already nullable and the existing test proves
   `null` is a valid, working value).
2. Preserve operator attribution unconditionally via the **audit trail** (P0-3) plus a
   `reviewedByUserId` entry in the existing `metadata` JSON column — no schema change.

This is confined to `CashierService.approveWithdrawal`. **No WalletEngine, ledger, settlement, bridge
or game-engine code is touched, and no money-movement semantics change** — approval moves no money
(funds were held at request time); it only transitions status.

### Affected tests

- `wallet/cashier.integration.spec.ts` — must be changed to pass a **real operator `users.id`**, which
  is what production does. This is strengthening an assertion, not weakening one.
- New regression test: approval with a real operator id succeeds and remains idempotent.

---

## P0-1 — `/dashboard` shows demo money to real sessions

### Complete dependency trace

`app/(dashboard)/dashboard/page.tsx` renders 5 children. I traced every one:

| Component | Demo-wallet dependency |
| --- | --- |
| `components/dashboard/player-sections.tsx` → `PlayerHero`, `QuickActions` | **YES** |
| `components/wallet/wallet-summary.tsx` → `WalletSummary` | **YES** |
| `components/marketing/hero.tsx` | no |
| `components/dashboard/dashboard-lobby-lazy.tsx` → `dashboard-lobby.tsx` | no (but re-exports `RecentBetsCard`, `RecentTransactionsCard`, `VipProgressCard` from `player-sections`) |
| `components/casino/provider-showcase`, `games/home-sections`, `live/*`, `marketing/landing-sections`, `marketing/lobby-sections` | no |

**Exactly two files** carry the dependency. Precise usages:

```
player-sections.tsx:51   PlayerHero            bets         ← useDemoWallet
player-sections.tsx:170  RecentBetsCard        bets         ← useDemoWallet
player-sections.tsx:213  RecentTransactionsCard transactions ← useDemoWallet
wallet-summary.tsx:28-30 WalletSummary         balance, vault, transactions ← useDemoWallet
```

There is **no `isDemoSession` branch anywhere** in either file — a real, ledger-funded player sees
demo balances. `PlayerHero` additionally renders a hardcoded **"Demo Account"** badge and takes its
username from `usePlayerProfile` (a demo store) rather than the authenticated user.

### Existing primitives that already provide what is needed

No new API is required. All of these exist and are server-authoritative:

| Need | Existing API | Endpoint |
| --- | --- | --- |
| Balance | `walletApi.balances()` → `BalanceSummary.wallets[].available` | `GET /wallet-engine/balances` |
| Recent transactions | `walletApi.history({ limit })` → stored `balanceBefore/After` | `GET /wallet/history` |
| Recent bets / today's rounds | `gameHistoryApi.list({ limit })` → `stake`, `payout`, `netResult` | `GET /games/history` |
| Identity | `useAuthStore().user` (from backend `/auth/me`) | — |
| Real-vs-demo gate | `useRealSession()` (built in Phase 2C.15) | — |

### Smallest safe change

Branch both components on `useRealSession()`:

- **Real session** → the four APIs above, with honest loading/error/empty states. No client-side
  balance arithmetic: the balance is rendered from `available` as returned. "Today" aggregates are
  presentational roll-ups **of server rows**, not derived balances.
- **Demo session** → keep the existing demo store, but only behind an explicit demo label.
- `PlayerHero`'s "Demo Account" badge becomes conditional on `isDemoSession`; the username comes from
  the auth store for real sessions.

No second wallet implementation, no new endpoint, no change to `/wallet` or `/lobby`.

### Affected tests

New frontend regression tests (Phase J items 1–3, 11).

---

## P0-2 — `/admin/*` has no frontend authorization boundary

### Call path

```
app/admin/layout.tsx  →  <AuthGuard>{children}</AuthGuard>
components/auth/auth-guard.tsx:
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const initialized     = useAuthStore((s) => s.initialized);
    if (initialized && !isAuthenticated) router.replace('/login');
```

`AuthGuard` checks **authentication only**. There is no role or permission test, so any authenticated
player — and, in a demo-mode build, any guest — loads every admin page shell, sidebar and route.

### What is NOT broken (verified)

- Global guards are registered as `APP_GUARD`: `ThrottlerGuard`, `JwtAuthGuard`, `RolesGuard`,
  `PermissionsGuard` (`app.module.ts:101-104`).
- All 17 admin controllers are permission-guarded; I compared guard-count to endpoint-count on each.
  The only unguarded route is an intentional `@Public() GET /operations/status`.

So this is **information disclosure and a missing defence-in-depth layer**, not a data breach. A
player sees an admin shell with empty/failing panels.

### Existing primitives

`useAuthStore` already exposes `hasPermission(slug)` and `hasRole(slug)`, both reading `user.roles` /
`user.permissions`. Those arrays are **backend-resolved**, not client-asserted: `rbac.service.ts`
flattens them from `UserRole → Role → RolePermission → Permission` in the database and
`session.service.ts:266` puts them in the session payload.

Canonical role slugs (`rbac.constants.ts`): `user`, `vip`, `moderator`, `admin`, `super_admin`.
**There is no `partner` and no `finance` role** — so the brief's PARTNER→forbidden and FINANCE→finance-
routes-only cases cannot be *positively* tested; they are covered by default-deny (anything that is
not admin/super_admin is denied) and must be re-tested when those roles exist.

### Smallest safe change

An additive `AdminGuard` component wrapping `AuthGuard` in `app/admin/layout.tsx`:

- not initialized → render the existing neutral loading shell (**no admin content, no login flash**)
- not authenticated → `/login` (unchanged `AuthGuard` behaviour)
- authenticated without admin authority → render "forbidden", do **not** render children
- demo session → forbidden (a demo session carries `permissions: []`)

Authority test: `hasRole('admin') || hasRole('super_admin')`, since `ADMIN_PERMS` is what the backend
grants those roles. This is **defence in depth only** — the backend guards remain the authority, and
nothing about them changes.

### Affected tests

New frontend tests (Phase J items 4–6) + mobile check that no admin UI flashes before authorization.

---

## P0-3 — Cashier operator actions produce no audit record

### Existing architecture (reuse, do not duplicate)

`security/audit.service.ts` is real and already correct:

```ts
async record(input: RecordAuditInput): Promise<void> {
  try   { await this.prisma.auditTrail.create({ data: { userId, action, entityType, entityId,
                                                        changes, ipAddress, userAgent } }); }
  catch (error) { this.logger.warn('Failed to persist audit trail', ...); }   // ← non-blocking
}
```

`RecordAuditInput` = `{ userId?, action: AuditAction, entityType, entityId?, changes?, meta? }`.
`AuditAction` already includes `APPROVE`, `REJECT`, `EXECUTE`, `LOGIN`, `LOGOUT`.
`RequestMeta` (via the `@ReqMeta()` decorator) already supplies `ipAddress`, `userAgent`,
`fingerprint`, `countryCode`, `city`. `req.id` (request-id middleware) supplies a request id.

**Phase D's question — should audit failure block the transaction?** The existing architecture has
already answered: `record()` catches and warns. It is deliberately non-blocking, and the brief warns
against arbitrarily failing financial transactions for audit reasons. **Decision: reuse as-is,
non-blocking**, and document it. Audit writes also happen *after* the money movement completes, so a
failed audit can never alter a financial outcome.

### Current coverage

8 call sites in the whole backend: 6 in `admin-users.service.ts`, 1 in `auth.service.ts`
(registration). `admin-cashier.controller.ts` / `CashierService`: **zero**.

### Smallest safe change

Inject `AuditService` into `CashierService` (or record at the controller edge where `@ReqMeta()` and
`@CurrentUser()` are available) and record after each successful operator transition:

| Action | `AuditAction` | entityType |
| --- | --- | --- |
| deposit complete | `APPROVE` | `deposit_request` |
| deposit reject | `REJECT` | `deposit_request` |
| withdrawal approve | `APPROVE` | `withdrawal_request` |
| withdrawal reject | `REJECT` | `withdrawal_request` |
| withdrawal complete | `EXECUTE` | `withdrawal_request` |
| large-withdrawal escalation | `EXECUTE` | `withdrawal_request` |

`changes` will carry only **non-sensitive** financial metadata: reference, amount, currency code,
previous/next status, affected user id, actor role, request id.

**Never stored** (explicitly checked): passwords, JWTs, refresh tokens, secrets, server seeds, payment
credentials. `AuditTrail` has no column for them and none will be placed in `changes`.

### Affected tests

New backend tests (Phase J items 7–8).

---

## P0-4 — Large-withdrawal escalation: does it already exist?

### Inspection result: **it does not exist.**

Searched the withdrawal path end-to-end:

- `WithdrawalStatus` enum: `PENDING, UNDER_REVIEW, APPROVED, PROCESSING, COMPLETED, REJECTED,
  CANCELLED, FAILED` — **no escalation state**.
- `CashierService.limits` (env-driven): `CASHIER_MIN_DEPOSIT`, `CASHIER_MAX_DEPOSIT`,
  `CASHIER_MIN_WITHDRAWAL`, `CASHIER_MAX_WITHDRAWAL` — these are **transaction limits, not an
  escalation threshold**. `CASHIER_MAX_WITHDRAWAL` (default 50000) *rejects* larger withdrawals
  outright; it does not escalate them.
- No threshold in `SystemSetting`/`ApplicationSetting` usage, no super-admin approval path.
- `approveWithdrawal` requires only `WALLETS_ADJUST` — **any admin can approve any amount**.

### Existing primitive the architecture does provide

`limitEnv(name, default)` — a server-side, env-driven, client-untrusted config helper already used for
all four cashier limits. And `WithdrawalRequest.metadata Json?` already exists, so escalation state can
be persisted **with no schema change and no migration**.

### Decision, per the brief's explicit instruction

The brief says: *"DO NOT invent a threshold such as ₹50,000 or ₹100,000"* and *"If business policy is
required and cannot be safely determined: mark threshold configuration as BUSINESS-CONFIG REQUIRED and
do not fabricate it."*

There is no business-supplied number anywhere in the repository, and the client requirements document
was not available. Therefore:

- Implement the **mechanism** server-side: threshold read from `CASHIER_LARGE_WITHDRAWAL_THRESHOLD`.
- **Default: unset ⇒ escalation disabled.** No number is invented. With the variable unset, behaviour
  is byte-for-byte today's behaviour.
- Escalation is computed **server-side from the stored amount**; the client never supplies it.
- Escalation is stamped into `metadata` at request creation ⇒ **persistent and restart-safe**.
- When escalated, approval requires a **super-admin authority** check in addition to
  `WALLETS_ADJUST`; ordinary admins are refused.
- Hold semantics are **unchanged** — escalation moves no money and changes no status transition; it
  only constrains *who* may approve.
- Status: **BUSINESS-CONFIG REQUIRED** until the client supplies the threshold.

### Affected tests

New backend tests (Phase J items 9–10), including: disabled-by-default produces today's behaviour;
enabled threshold escalates from the server-side amount; escalation survives a restart; no double
approval or double refund.

---

## Frozen-surface impact assessment

| Surface | Touched by this plan? |
| --- | --- |
| `WalletEngineService` / wallet-core | **No** |
| Ledger / `LedgerEntry` | **No** |
| Settlement / recovery | **No** |
| `GameMoneyBridge` | **No** |
| Game engines / runtime | **No** |
| Prisma schema / migrations | **No** — P0-4 uses the existing `metadata` JSON column; P0-5 uses the existing nullable FK and existing `AdminUser.userId` link |

Changes are confined to: `CashierService` (request lifecycle only — the layer that already owns it),
`AdminCashierController` (audit + authority wiring), two frontend dashboard components, one new
frontend guard, and tests.

---

## Phase A conclusion

Five defects traced. Four were known; **P0-5 is new and is the most severe** — withdrawal approval has
never worked through the real controller path, and the one test covering it passes an argument the
product never passes, in a suite that is skipped by default.

Every fix is additive, uses primitives that already exist, requires **no schema migration**, and leaves
all frozen financial surfaces untouched. P0-4 ships as a disabled mechanism pending a business number.

Proceeding to Phase B.
