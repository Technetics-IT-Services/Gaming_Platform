# Phase 2D.4 — Implementation (PA-01 Partner Principal, backend + frontend)

## 1. Database

New file `packages/database/prisma/schema/partner.prisma`. **Additive; no existing table altered.**

| Model | Fields |
|---|---|
| `Partner` | `id`, `code` (unique, server-generated), `name`, `status` (`PENDING/ACTIVE/SUSPENDED/TERMINATED`), `revenueSharePercent` `Decimal(7,4)`, `notes`, timestamps, soft delete |
| `PartnerUser` | `partnerId`, **`userId` UNIQUE**, `isPrimary` |

`userId` being unique is the isolation anchor: one user belongs to at most one partner, so "which
partner am I?" is unambiguous.

**No partner wallet, balance, commission or payout table exists** — verified by a test asserting the
only partner tables are `partners` and `partner_users`.

## 2. RBAC

| Permission | Holder |
|---|---|
| `partners:read_own` | new `partner` role (its **only** permission) |
| `partners:read` | `admin`, `super_admin` |
| `partners:write` | **`super_admin` only** |

The `partner` role maps to the coarse `UserRole.USER` in tokens — a partner must never appear
elevated to code still reading the legacy coarse role. `RbacBootstrapService` back-fills grants for
existing roles at boot, so no manual migration is needed.

## 3. Backend

`modules/partner/{partner.service.ts, partner.controller.ts, partner.module.ts}`

| Endpoint | Permission |
|---|---|
| `GET /partner`, `GET /partner/dashboard` | `partners:read_own` |
| `GET /admin/partners{,/:id,/:id/members}` | `partners:read` |
| `POST /admin/partners`, `/:id/share`, `/:id/status`, `/:id/members` | `partners:write` |

### 3.1 The Σ ≤ 100 invariant

Enforced **inside the write transaction**, excluding the partner's own current value, so two
concurrent updates cannot combine past 100 (proven by a concurrency test).

**It does NOT require Σ = 100.** Requiring that would assume the house retains nothing — an invented
business rule. The unallocated remainder is surfaced explicitly instead.

### 3.2 A design inconsistency found by testing

`create` originally enforced Σ ≤ 100 even though a new partner is `PENDING` and **PENDING partners do
not consume allocation** (`allocatedShare()` counts ACTIVE only). That was internally inconsistent
and blocked an operator from staging a partner before rebalancing. Creation no longer enforces an
invariant it does not participate in; activation and share-changes on ACTIVE partners still do.

## 4. Frontend

| Route / file | Purpose |
|---|---|
| `app/partner/layout.tsx` | portal shell: `AuthGuard` → `PartnerGuard` → Sidebar/Header, with the 2D.6 `min-w-0` fix |
| `app/partner/page.tsx` | partner overview — identity, status, share, members, honest gaps |
| `app/admin/partners/page.tsx` | operator console — allocation, create, status, share, members |
| `components/auth/partner-guard.tsx` | shell guard keyed on `partners:read_own` |
| `lib/partner-api.ts` | typed client for all nine endpoints |
| `lib/partner-access.ts` | `canAccessPartnerPortal` / `canReadPartnerAdmin` / `canWritePartners` |
| `components/shared/navigation.ts`, `layout/{sidebar,header}.tsx` | `NavVariant` extended with `'partner'` + `partnerNav` — **no second navigation architecture** |
| `lib/api-client.ts` | `/partner` and `/admin/partners` added to `DEMO_BLOCKED_PATHS` |

### 4.1 Routing decision

Partners get their own top-level `app/partner/` section, mirroring `app/admin/`. Putting it in the
`(dashboard)` group would give a partner the **player** navigation (wallet, games, deposits) they
have no business seeing. **Normal players are never redirected there**; the nav entry only renders
for a principal holding `partners:read_own`.

### 4.2 Financial UI safety

- `revenueSharePercent` is rendered **exactly as the server sent it** — no `parseFloat`, no
  `toFixed`, no arithmetic, no currency symbol (it is a share, not money). Asserted by test.
- Allocation totals come from the **server's** `allocation` object; the page never sums shares
  (`.reduce(` and `Number(` are asserted absent).
- Profit / balance / withdrawals render the **server's reason**, never `₹0`.

### 4.3 The orphaned library stayed orphaned

`src/lib/partners/` (10 files, 0 importers) invents CPA/RevShare/Hybrid/Tiered commission models no
requirement specifies. It was **not** wired in and **not** used for types — its shapes encode those
invented semantics. Asserted by test that no partner file imports it.

## 5. Tests

| Suite | Count |
|---|---|
| Partner integration (real Postgres + Redis) | **21** |
| Live HTTP (RBAC, isolation, escalation, mass assignment) | **47** |
| Frontend unit (client contract, access rules, structural honesty) | **25** |
| Mobile + E2E (UI ↔ API ↔ DB) | 7 per viewport |

The E2E test does not stop at "the page loads": it reads the share and name from **Postgres**,
captures the **API** response, and asserts the **UI** text equals both.
