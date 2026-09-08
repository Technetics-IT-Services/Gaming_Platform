# Phase 2D.4 — Audit (before code)

Evidence gathered from the repository and the live database, not from prior reports.

## 1. Current state — partner

| Probe | Result |
|---|---|
| `partner` in any of the 19 Prisma schema files | **ZERO occurrences** |
| `partner` in `apps/backend/src` | only my own analytics strings declaring `partnerProfit` **unavailable** — no entity, no module, no route |
| `partner` role in `ROLE_DEFINITIONS` | **absent** (`user, vip, moderator, admin, super_admin`) |
| `apps/frontend/src/lib/partners/` (10 files) | **fully orphaned — 0 importers outside itself** |
| Live DB partner tables | none |

### 1.1 The orphaned `lib/partners/` must NOT be wired in

It is a client-side **simulation** whose own header says *"Logical accounting ONLY — no ledger
postings, no money movement"*, and it invents commission models the client never specified
(CPA / Revenue-Share / Hybrid / Fixed / Percentage / Tiered). Connecting it would make fabricated
commission semantics the source of truth. **Excluded deliberately** (brief §22: never wire simulated
business logic into production screens).

## 2. Requirement interpretation

The client enumeration ([`PHASE_2C16_AUDIT.md`](PHASE_2C16_AUDIT.md) §4.2, §4.6) describes a partner
as a **revenue-share stakeholder**, not an affiliate:

§4.2 partner-only login · own dashboard · **own profit** · **available balance** · **profit
percentage** · withdrawal request · withdrawal history · reports · notifications · **isolation
(A cannot see B)**

§4.6 daily revenue · daily expenses · net profit · **configurable ownership %** · daily distribution ·
automatic partner balance update

A partner is therefore **user-linked** (they log in), holds a **configurable ownership percentage**,
and receives a share of platform net profit.

**A partner is NOT the referral entity.** `ReferralProgram` / `ReferralHistory` / `ReferralReward`
exist and model referrer→referee rewards — a different requirement (P-17). Reusing them for partners
would misrepresent both.

## 3. Dependency analysis — what is genuinely implementable now

| Sub-requirement | Implementable? | Why |
|---|---|---|
| Partner entity + status | **YES** | pure domain state |
| Partner-only login | **YES** | reuse the EXISTING auth + a new `partner` role. No second auth system |
| Configurable ownership % | **YES** | the requirement asks for the *mechanism*; the value is operator-set, not invented |
| Partner isolation (A ≠ B) | **YES** | ownership filter in the query, as proven for support in 2D.3 |
| Partner dashboard (identity, %, status) | **YES** | from real stored state |
| Partner notifications | **YES** | reuse the 2D.1 system |
| **Own profit** | **BLOCKED** | needs a revenue definition (**F-02, a business decision**) and an expense model (F-03) |
| **Available balance** | **BLOCKED** | derived from profit distribution |
| **Withdrawal request / history** | **BLOCKED** | requires a partner balance to withdraw from |
| **Daily distribution / auto balance update** | **BLOCKED** | requires net profit |

**Conclusion: PA-01 (the partner principal) is implementable; every partner MONEY requirement is
blocked on a business definition and must not be fabricated.**

## 4. Reusable infrastructure (nothing new to build)

| Need | Existing component |
|---|---|
| Identity / login / sessions / 2FA | `modules/auth/*` — reused, unmodified |
| Role→permission catalog, boot sync | `RbacBootstrapService` (upserts permissions and back-fills grants for existing roles) |
| Permission enforcement | `@RequirePermissions` + global guard chain |
| Audit | `AuditService` (single store; `admin_audit_logs` stays dormant) |
| Notifications | `NotificationEventsService.safeEmit` with deterministic dedup |
| Ownership-isolation pattern | proven in 2D.3 support: owner filter **inside** the WHERE clause |

## 5. Schema analysis

Two new tables are genuinely required; nothing existing can represent a partner without
misrepresenting it.

| Model | Rationale |
|---|---|
| `Partner` | the principal: code, name, status, `revenueSharePercent` (Decimal), audit timestamps |
| `PartnerUser` | join to the EXISTING `User`, so partners authenticate through the existing system |

**No partner wallet, no partner balance column, no commission table** — those would be fabricated
money. Partner balance stays BLOCKED until the profit definition exists.

### 5.1 The ownership-percentage invariant

The requirement says "configurable ownership %". Enforcing **Σ = exactly 100 %** would assume the
house retains nothing — an invented business rule. Enforcing **Σ ≤ 100 %** is provable from any
reading (over-allocation is invalid under all of them).

**Decision: enforce Σ ≤ 100 across ACTIVE partners, and surface the unallocated remainder** rather
than silently implying it is zero.

## 6. RBAC analysis

New, narrow, and deliberately NOT admin:

| Permission | Holder | Purpose |
|---|---|---|
| `partners:read_own` | new `partner` role | a partner reads **their own** record only |
| `partners:read` | `admin`, `super_admin` | operator can list/read partners |
| `partners:write` | **`super_admin` only** | create partners and set ownership % — §4.4 lists "manage partners" and "change partner percentages" under SUPER ADMIN |

A partner receives **no** admin, wallet, analytics, user or game permission.

## 7. Financial boundary analysis

PA-01 stores **no money**: no wallet, no balance, no ledger entry, no transaction. The percentage is
configuration, not currency. Therefore **no frozen file needs to change** — WalletEngine,
wallet-core, ledger, settlement, GameMoneyBridge, game engines, provably-fair and the runtime are
untouched, and no `FROZEN_CHANGE_PROPOSAL` is required.

## 8. Scope

**IN:** Partner + PartnerUser models · `partner` role and 3 permissions · super-admin partner CRUD +
percentage configuration with the Σ ≤ 100 invariant · partner self-service read · partner isolation ·
partner dashboard UI with honest unavailable state · audit on every mutation · tests (unit,
integration, live HTTP, RBAC/IDOR/mass-assignment) · mobile certification.

**EXPLICITLY OUT (and why):** partner profit / balance / withdrawals / daily distribution
(**BLOCKED — business definition**) · commission models (never specified) · wiring
`lib/partners/` (simulation) · a second auth system · any frozen-file change.

## 9. Risks

| Risk | Mitigation |
|---|---|
| A partner dashboard with no money data looks "empty" | Show explicit **BLOCKED** reasons naming the missing definition, rather than zeros |
| Adding a `partner` role could leak admin surfaces | Partner holds only `partners:read_own`; verified live that a partner gets 403 on every admin route |
| Ownership % is financial-adjacent | Stored as `Decimal`, mutation is super-admin-only and audited, Σ ≤ 100 enforced in a transaction |
| Percentages could be raced above 100 % | Invariant re-checked inside the write transaction |
