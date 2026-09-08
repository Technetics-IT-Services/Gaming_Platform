# Phase 2D.4 — Partner Frontend Audit (before code)

## 1. Verified backend contract (what the UI may consume)

Inspected in `partner.controller.ts` / `partner.service.ts`, live-verified 47/47.

| Endpoint | Permission | Response |
|---|---|---|
| `GET /partner` | `partners:read_own` | `PartnerView` |
| `GET /partner/dashboard` | `partners:read_own` | `{ partner, unavailable[] }` |
| `GET /admin/partners` | `partners:read` | `{ items, total, page, limit, allocation }` |
| `GET /admin/partners/:id` | `partners:read` | `PartnerView` |
| `GET /admin/partners/:id/members` | `partners:read` | member rows (ids/usernames, **no emails, no credentials**) |
| `POST /admin/partners` | `partners:write` | create (server generates `code`, forces `PENDING`) |
| `POST /admin/partners/:id/share` | `partners:write` | set % (Σ ≤ 100 enforced) |
| `POST /admin/partners/:id/status` | `partners:write` | lifecycle |
| `POST /admin/partners/:id/members` | `partners:write` | link an existing user |

`PartnerView` = `{ id, code, name, status, revenueSharePercent (decimal STRING), memberCount, createdAt }`.

**There is no money in this contract.** `revenueSharePercent` is a share, not an amount, and carries
no currency. `unavailable[]` names `netProfit`, `partnerProfit`, `availableBalance`, `withdrawals`
with the reason.

## 2. Capability → UI mapping

| Candidate screen (from the brief's list) | Backend support | Decision |
|---|---|---|
| Partner dashboard | `GET /partner/dashboard` | **BUILD** |
| Partner profile / account info | same payload (code, name, status, share, members, joined) | **BUILD** (part of the dashboard) |
| Partner status | `status` field | **BUILD** |
| Partner configuration (ownership %) | `POST /admin/partners/:id/share` | **BUILD — operator side only.** A partner must not set its own share |
| Partner users / members | `GET /admin/partners/:id/members` | **BUILD — operator side.** No partner-facing member route exists, so no partner-side screen |
| Partner financial information | **none** | **NOT BUILT** — rendered as explicit unavailable with the reason |
| Partner hierarchy / sub-partners | **none** — no parent/child in the model | **NOT BUILT.** No requirement, no backend |
| Partner referrals | **none** — referral is P-17, a different requirement | **NOT BUILT** |
| Partner activity feed | **none** | **NOT BUILT** |
| Partner escalation state | **none** — "escalation" exists only for large withdrawals (AD-06), unrelated to partners | **NOT BUILT** |
| Partner reports | **none** (PA-07 depends on partner financials) | **NOT BUILT** |

Every "NOT BUILT" row has no backend capability. Building a screen for any of them would require
fabricating data, which the brief forbids.

## 3. The orphaned `lib/partners/` — excluded, again

10 files, **0 importers**, self-described as *"Logical accounting ONLY — no ledger postings"*, and it
invents CPA / RevShare / Hybrid / Tiered commission models the client never specified. **Not wired
in, and not used for types either** — its type shapes encode the invented commission semantics.
Fresh, minimal types are derived from the real DTOs instead.

## 4. Existing architecture to reuse (no second shell, no second nav)

| Concern | Existing component | Reuse plan |
|---|---|---|
| Authentication gate | `AuthGuard` | reuse unchanged |
| Console gate | `AdminGuard` + `canAccessAdminConsole` (role-based) | **mirror** as `PartnerGuard` + `canAccessPartnerPortal`, but keyed on the **permission** `partners:read_own` — more precise and matches the backend's own check |
| Shell | `app/admin/layout.tsx` (Sidebar + Header + `min-w-0` fix) | mirror for `app/partner/` |
| Navigation | `NavVariant = 'dashboard' \| 'admin'`, `adminNav`/`dashboardNav` | **extend** with `'partner'` + `partnerNav`. No second navigation architecture |
| HTTP | `apiClient` + `unwrap` | reuse |
| Demo isolation | `DEMO_BLOCKED_PATHS` | add `/partner` and `/admin/partners` |

**Routing decision:** partners get their own top-level section `app/partner/`, mirroring `app/admin/`.
A partner is not a player, so putting it in the `(dashboard)` group would give them player navigation
(wallet, games, deposits) they have no business seeing. **Normal players are never redirected there** —
the partner nav entry only renders for a principal holding `partners:read_own`.

## 5. Authorization model for the UI

| Principal | `/partner` | `/admin/partners` |
|---|---|---|
| Unauthenticated | AuthGuard → login | AuthGuard → login |
| Player / VIP | **refused** (no `partners:read_own`) | **refused** |
| Partner | **allowed, own org only** | **refused** |
| Moderator | refused | refused (no `partners:read`) |
| Admin | refused (no `partners:read_own`) | **read-only** — write buttons hidden AND server-refused |
| Super-admin | refused | **full** |

The guard **never grants data access** — it declines to paint an interface. Every request is
re-authorized server-side; that was proven live (47/47, including 4 escalation probes).

## 6. Financial UI safety

- `revenueSharePercent` arrives as a **decimal string** and is rendered as received. No `parseFloat`,
  no arithmetic, no currency symbol (it is not money).
- Allocation totals come from the **server's** `allocation` object; the client never sums shares.
- Profit / balance / withdrawals render the server's `unavailable` reason. **Never ₹0.**

## 7. Risks

| Risk | Mitigation |
|---|---|
| A partner dashboard with no money data reads as broken | Show the named business-definition blocker prominently, not a blank card |
| An admin sees write buttons they cannot use | Buttons render only with `partners:write`; the server refuses regardless |
| Long partner names / codes overflow on mobile | `overflowWrap: anywhere`, `minWidth: 0`, table in its own `overflow-x` scroller |
| A player could deep-link to `/partner` | `PartnerGuard` refuses; backend returns 403 (verified live) |
