# Phase 2C.16 — Client Requirement Gap Audit

**Audit only. No code was written or modified in this phase.**

Date: 2026-08-27 · Repository: `d:/Projects/Hire` · Branch: `main` (uncommitted working tree)

---

## 0. Source-document caveat (read first)

The task references an **attached** document, *"Online Casino Web Application — Complete System
Requirements"*. **No attachment was received, and no such document exists in the repository** —
verified by title search across all `*.md`/`*.txt` and by extension search for `*.pdf`/`*.doc(x)`
under the repo root (excluding `node_modules`): zero matches.

This audit therefore uses **the requirement enumeration given verbatim in §2 of the task brief** as
the authoritative matrix. That list is itemised to leaf level and is treated as the client's own
words. **No generic casino assumptions have been substituted.** Where the brief names a requirement
without acceptance criteria (e.g. "retention", "bounce rate"), the requirement is graded on whether a
real, data-derived implementation exists at all — not against an invented threshold.

**If the source document contains requirements or acceptance criteria beyond the §2 list, this matrix
is incomplete and must be re-run against the document.**

---

## 1. Baseline verification

The brief lists a "current verified baseline" and instructs me to verify it. Results:

| Baseline claim | Verified? | Evidence / correction |
| --- | --- | --- |
| frontend tests: 789 passing | **CONFIRMED, with a material qualification** | `62 files, 789 tests passed`. **227 of those 789 (29%) test `apps/frontend/src/lib/*` simulation libraries that are never rendered by any route** — see §3.1. They are green, but they do not evidence product behaviour. |
| backend tests: 171 passing | **CONFIRMED, with a material qualification** | `Test Suites: 10 skipped, 32 passed, 42 total` / `Tests: 85 skipped, 171 passed, 256 total`. The **10 skipped suites are exactly the financial ones** — all 8 `gaming-money/*.integration.spec.ts`, `wallet/cashier.integration.spec.ts`, and `wallet-engine/wallet-concurrency.stress.integration.spec.ts`. They are DB-gated and do not run in the default `pnpm test`. "171 passing" therefore contains **zero** money-path integration coverage by default. |
| production build: PASS | **CONFIRMED** | `next build` succeeded this session (lint + typecheck enforced in-build). |
| typecheck: PASS | **CONFIRMED** | `tsc --noEmit` + vitest project config, clean. |
| lint: PASS | **CONFIRMED** | 0 errors, 3 pre-existing warnings. |
| frozen financial/game surfaces: NONE modified | **CONFIRMED** | Verified by `git status` + mtimes; the modified `apps/backend/**` files date from 2026-08-19→21 (earlier phases), not Phase 2C.15. |
| PostgreSQL / Redis / Prisma / boot / health | **CONFIRMED** | Ran the full stack this session: `GET :4100/api/v1/health` → `{database: up, redis: up, memory_heap: up}`. |
| JWT, refresh rotation, reuse detection, logout/revocation, session restoration | **CONFIRMED** | Real backend `auth` module; certified again in Phase 2C.15. |
| RBAC foundation, bootstrap super-admin | **CONFIRMED but narrower than the client needs** | `rbac.constants.ts` seeds 5 roles: `user, vip, moderator, admin, super_admin`. **There is no `partner` role and no `finance` role.** See §3.2. |
| wallet provisioning, double-entry ledger, reconciliation, GameMoneyBridge, 15 real-money games, settlement recovery, game history, wallet history, cashier, deposit/withdrawal workflow, mobile lobby, canonical catalog, profile, verification, RG disclosure, production frontend auth, mobile cert | **CONFIRMED** | Real backend modules with real Prisma models and controllers. |
| support information | **CONFIRMED as informational only** | `/support` is a 69-line static page; there is **no support backend module, no ticket model, no persistence**. |
| demo-wallet isolation on the real-money journey | **CONFIRMED for the certified journey only** | The certified journey (`/lobby → /deposit → game → /wallet → /withdraw`) is demo-free. **`/dashboard` — the page login lands on — is NOT.** See §3.3. |
| Phase 2C.15 demo-auth redirect loop fixed | **CONFIRMED** | 12/12 mobile demo cert green at 375/390/412; re-verified by driving the running app this session. |

---

## 2. Method

1. Enumerated all 25 backend modules, all 130 frontend routes, and all 128 Prisma models.
2. For each of the 17 domains named in §4 of the brief (`partner, finance, referral, vip, reward,
   bonus, promotion, notification, analytics, report, audit, support, settings, admin, profit,
   settlement, payout`), measured presence independently at three layers: **Prisma model**,
   **backend module/controller**, **frontend route/component**.
3. Traced each frontend feature page to its actual data source (`useQuery` → API, vs. a static
   module, vs. `useDemoWallet`).
4. Checked authorization at both layers (backend decorators; frontend route guards).
5. Ran both test suites and recorded skips.

---

## 3. Principal findings

### 3.1 FINDING A — 13 of 14 "platform" libraries are orphaned simulation code

`apps/frontend/src/lib/` contains 14 substantial subsystems. Consumption by any rendered component:

| Library | `.tsx` files consuming it | Tests |
| --- | --- | --- |
| `partners/` (1,556 LOC) | **0** | 14 |
| `treasury/` | **0** | 19 |
| `payments/` | **0** | 15 |
| `ledger/` | **0** | 18 |
| `compliance/` | **0** | 20 |
| `crm/` | **0** | 18 |
| `analytics/` | **0** | 11 |
| `tenancy/` | **0** | 23 |
| `security/` | **0** | 16 |
| `resilience/` | **0** | 17 |
| `integrations/` | **0** | 15 |
| `infra/` | **0** | 13 |
| `perf/` | **0** | 10 |
| `operations/` | 1 | 18 |

These are **pure in-memory TypeScript** with no backend, no Prisma model, and no route. `partners/`
even documents itself as reading through an in-process `OperationsService` port and computing NGR as
"a LOGICAL figure (deposits − withdrawals) … never a ledger value".

**Consequence:** a reader could mistake `lib/partners/commission-engine.ts` for a partner
implementation. It is not — it is unreachable, unpersisted, and unauthenticated. Classified
**ORPHANED** throughout the matrix below.

### 3.2 FINDING B — Partner and Finance portals do not exist at any layer

| Layer | Partner | Finance |
| --- | --- | --- |
| Prisma model | **none** (zero occurrences of "partner" in all 18 schema files) | **none** |
| RBAC role | **none** | **none** |
| Backend module / controller | **none** (zero occurrences of "partner" anywhere in `apps/backend/src`) | **none** |
| Frontend route | **none** | **none** |
| Only artefact | orphaned `src/lib/partners/` (§3.1) | orphaned `src/lib/treasury/`, `src/lib/payments/` |

This is the **largest gap in the audit**, and §7 of the brief names it the priority. Every Partner
and Finance sub-requirement is consequently **C or D**, and every partner-isolation security test
named in §7 and §15 of the brief is currently **untestable** — there is no partner principal to test
with.

**Partner profit distribution (§8 of the brief) is classified D — REQUIRES NEW ARCHITECTURE**, not C.
Rationale: it requires a new `Partner` model, a new role, an ownership-percentage store with a
`sum = 100%` invariant, a daily revenue/expense aggregation the database does not currently produce
(§3.5), an idempotent distribution job, and ledger-backed partner balances. Delivering it safely
means new money-moving accounting. Per §8 of the brief — *"If existing accounting architecture cannot
safely support this, STOP and classify it as D rather than corrupting the ledger"* — it is D.

### 3.3 FINDING C — `/dashboard` (the client's "Home") is demo-money-backed for real sessions

`app/(dashboard)/dashboard/page.tsx` renders `PlayerHero`, `QuickActions` (both from
`components/dashboard/player-sections.tsx`) and `components/wallet/wallet-summary.tsx`. All three read
`useDemoWallet` **unconditionally** — there is no `isDemoSession` / real-session branch:

```
player-sections.tsx:51   const bets = useDemoWallet((s) => s.bets);
player-sections.tsx:213  const transactions = useDemoWallet((s) => s.transactions);
wallet-summary.tsx:28-30 balance / vault / transactions ← useDemoWallet
```

A **real, ledger-funded player landing on `/dashboard` after login sees demo balances and demo
transactions.** This survived prior phases because the certified money journey runs through `/lobby`,
`/wallet`, `/deposit` and `/withdraw` — never `/dashboard`. It directly violates §19 of the brief.

Other production-journey routes with the same unconditional demo dependency: `/bets`, `/vault`,
`/store`, `/marketplace`, `/promotions`, `/mailbox`, plus `components/rewards/lucky-wheel.tsx` and
`mystery-chest.tsx` (the client's "lucky spin"), and `components/wallet/bet-gate.tsx`.

**Classification: P0 for `/dashboard` + `wallet-summary` (money display on the landing page); P1 for
the rest.** This is C — safe to fix, using the exact `useRealSession()` / `isDemoSession` mechanism
built in Phase 2C.15.

### 3.4 FINDING D — Notifications are a stub that throws

`NotificationsService.listForUser()` and `.markAsRead()` both `throw new NotImplementedException(...)`.
The `Notification`, `NotificationPreference` and `NotificationTemplate` Prisma models exist and are
**never written by anything**. **No backend code anywhere calls `NotificationsService`** — no deposit,
withdrawal, bonus, referral or promotion event emits a notification. The frontend `/notifications`
page holds a static list with `useState` read-tracking that is lost on reload.

Every one of the 12 notification types the client requires is therefore **C — MISSING**.

### 3.5 FINDING E — Analytics is a stub; no analytics data is ever produced

`AnalyticsService` throws `NotImplementedException('Analytics aggregation is pending the platform data
model')`. `/admin/analytics` is an honest 24-line placeholder ("Charts render here once the Analytics
module aggregates platform data") — **not fabricated data**, which is correct, but not delivered.

The `RevenueAnalytics`, `TrafficAnalytics`, `GeoAnalytics`, `DeviceAnalytics` and `PageView` models
are **never written to by any backend code**. So DAU/MAU/retention/LTV/session-time/bounce-rate have
**no source data at all** — they cannot be computed from what is persisted today.

However, *derivable* metrics (revenue, profit-before-partner-split, average bet, most-played games,
average deposit/withdrawal, conversion) **can** be aggregated from existing real tables
(`WalletTransaction`, `GameRound`, `DepositRequest`, `WithdrawalRequest`, `User`). Split accordingly
in the matrix: derivable → **C**; behavioural (DAU/MAU/retention/bounce/session-time/LTV) → **D**
(requires event capture that does not exist).

### 3.6 FINDING F — `/admin/*` is reachable by any authenticated user (frontend)

`app/admin/layout.tsx` wraps the admin console in `AuthGuard` only. `AuthGuard` checks
`isAuthenticated` and `initialized` — **there is no role or permission check**. Any signed-in player
(and, in a demo-mode build, any guest) can load every admin page shell, sidebar and route.

**Backend is not breached**: all 17 admin controllers are permission-guarded, and the global
`JwtAuthGuard` + `RolesGuard` + `PermissionsGuard` are registered as `APP_GUARD`. I verified guard
counts match endpoint counts on every admin controller (the single unguarded route is an intentional
`@Public()` `GET /operations/status`). So a player sees an admin shell with failing/empty panels, not
admin data.

This is **information disclosure + a missing defence-in-depth layer**, classified **P0-authorization
(UI)**, and it is **C — safe to implement now** (a `RoleGuard` wrapper reusing the existing
`hasRole`/`hasPermission` selectors already on the auth store).

### 3.7 FINDING G — Audit-log coverage is ~2 of 9 required actions

`AuditService.record()` is real and correct: it persists to `AuditTrail` with `userId`, `action`,
`entityType`, `entityId`, `changes`, `ipAddress`, `userAgent`. `AdminAuditService` + a
permission-guarded `GET admin/audit` reader exist.

But there are only **8 call sites in the entire backend**: 6 in `admin-users.service.ts` and 1 in
`auth.service.ts` (user registration). Coverage against the client's required list:

| Required audited action | Status |
| --- | --- |
| user login | **MISSING** from `AuditTrail` (partially covered by a separate `LoginHistory` write in `account-security.service.ts`) |
| user logout | **MISSING** |
| admin login | **MISSING** (no admin-specific audit) |
| partner login | **N/A — no partner role exists** |
| withdrawal approval / rejection | **MISSING** — `admin-cashier.controller.ts` has zero audit calls |
| deposit approval / rejection | **MISSING** — same |
| partner percentage change | **N/A — feature does not exist** |
| game configuration change | **MISSING** |
| settings change | **MISSING** |
| actor / role / IP / browser / device / timestamp / action captured | **SUPPORTED by the schema** wherever `record()` is called |

Classified **B — PARTIAL**; closing it is **C** (additive calls into an existing, proven service).

---

## 4. Client requirement matrix

Legend — **A** complete · **B** partial · **C** missing, safe to implement now · **D** requires new
architecture/external provider · **E** deferred. Colour: 🟢 GREEN = A · 🟡 YELLOW = B · 🔴 RED = C/D.

### 4.1 PLAYER PORTAL

| Requirement | Class | Evidence |
| --- | --- | --- |
| Registration / Login | **A** 🟢 | Real `auth` module: JWT, rotation, reuse detection, 2FA, email verification, revocation. |
| Home | **B** 🟡 | Route + full UI exist, but wallet/bets/transactions come from `useDemoWallet` for real sessions (Finding C). |
| Games | **A** 🟢 | Real catalog (`catalog.service`, `recommendation.service`), 15 ledger-backed real-money games, `GET /catalog`, `/lobby`. |
| Wallet | **A** 🟢 | `WalletEngine`, double-entry `Ledger`/`LedgerEntry`, MAIN/BONUS/REWARD wallets, `/wallet`, `/wallet/history`. |
| Deposit | **A** 🟢 | `DepositRequest`, PENDING → operator-credit, no fake gateway. (Payment-provider integration itself is **E**, see §4.9.) |
| Withdraw | **A** 🟢 | Hold-on-request via WalletEngine, review, approve/reject, refund. |
| Rewards | **B** 🟡 | Backend **real and ledger-backed** (`RewardService.claim()` → `WalletEngineService.credit()`, `Reward`/`RewardClaim` persisted). Player page wired to it. But daily-login/weekly/monthly/lucky-spin/gift-code/seasonal sub-features are not implemented — see §4.8. |
| VIP | **B** 🟡 | `/vip` renders `lib/vip.ts`, self-documented "Backend-free; presentation only". Static tiers, no eligibility, no progression, no reward issuance, no withdrawal-limit enforcement. Per the brief's own example, **NOT COMPLETE**. |
| Referral | **C** 🔴 | Only artefact: `generateReferralCode()` at user creation (`users.service.ts:114`). No attribution, no qualifying-deposit trigger, no reward issuance, no dashboard, no leaderboard, no endpoints, no route. `ReferralProgram`/`ReferralHistory`/`ReferralReward` models exist and are unused. |
| Notifications | **C** 🔴 | Backend throws `NotImplementedException`; nothing emits; frontend is a static array (Finding D). |
| Profile | **A** 🟢 | Real `/users/me`, verification, account-security, RG disclosure. |
| Support | **B** 🟡 | Static informational page only. No backend module, no ticket model, no persistence, no delivery. |

### 4.2 PARTNER PORTAL

| Requirement | Class | Evidence |
| --- | --- | --- |
| partner-only login | **D** 🔴 | No `partner` role in `ROLE_DEFINITIONS`; no partner principal exists. |
| own dashboard | **D** 🔴 | No route, no backend. |
| own profit | **D** 🔴 | No profit model, no distribution (Finding B, §8 rationale). |
| available balance | **D** 🔴 | No partner wallet/ledger account. |
| profit percentage | **D** 🔴 | No ownership-percentage store; no `sum = 100%` invariant. |
| withdrawal request | **D** 🔴 | No partner payout path. |
| withdrawal history | **D** 🔴 | — |
| reports | **D** 🔴 | — |
| notifications | **D** 🔴 | Depends on both Partner (D) and Notifications (C). |
| partner isolation (A cannot see B) | **D** 🔴 | **Untestable** — no partner principal exists to test isolation with. |

**Partner portal completion: 0%.**

### 4.3 ADMIN PORTAL

| Requirement | Class | Evidence |
| --- | --- | --- |
| admin-only access | **B** 🟡 | Backend: **A** (all 17 admin controllers permission-guarded). Frontend: **C** — `/admin/*` guarded by `AuthGuard` only, no role check (Finding F). |
| users | **A** 🟢 | `admin-users.controller.ts`, 10 guarded endpoints, audited. |
| games | **A** 🟢 | `admin-games` + `admin-catalog`, 36 guarded endpoints. |
| bonuses | **B** 🟡 | `BonusWalletService` real and ledger-backed; no admin bonus-management UI/endpoints. |
| reports | **C** 🔴 | `/admin/analytics` is a placeholder; `AnalyticsService` throws (Finding E). Wallet reports exist (`admin/wallet/reports/overview`). |
| promotions | **B** 🟡 | `Promotion`/`Campaign`/`Coupon` models exist; player `/promotions` page is static + demo-wallet; no admin promotion CRUD. |

### 4.4 SUPER ADMIN

| Requirement | Class | Evidence |
| --- | --- | --- |
| full system access | **A** 🟢 | `super_admin` holds `ALL_PERMISSIONS`; bootstrap super-admin verified. |
| create admins | **A** 🟢 | `admin-roles.controller.ts` + `admin-users` role assignment, guarded and audited. |
| manage partners | **D** 🔴 | No partner entity. |
| change partner percentages | **D** 🔴 | No percentage store. |
| approve large withdrawals | **C** 🔴 | Withdrawal approval exists, but there is **no large-withdrawal threshold, no escalation tier, and no super-admin-only approval path** — any `admin` with the permission can approve any amount. |
| reports | **C** 🔴 | As §4.3. |
| games | **A** 🟢 | — |
| finance | **D** 🔴 | No finance portal. |
| settings | **B** 🟡 | `SystemSetting`/`ApplicationSetting` models exist; `/admin/settings` is a 22-line placeholder; no settings CRUD endpoints. |

### 4.5 FINANCE

| Requirement | Class | Evidence |
| --- | --- | --- |
| deposits | **B** 🟡 | Operator deposit review exists (`admin-cashier`), but as an *admin* function — no finance role, no finance portal. |
| withdrawals | **B** 🟡 | Same. |
| partner payout requests | **D** 🔴 | — |
| daily settlement | **C** 🔴 | Game settlement is real and certified; **daily financial settlement/close is absent**. |
| cash flow | **C** 🔴 | Derivable from `WalletTransaction`; not implemented. |
| revenue | **C** 🔴 | Derivable; not implemented. |
| expenses | **D** 🔴 | **No expense model exists.** Nothing records expenses, so "Daily Revenue − Daily Expenses" has no minuend source. |
| profit | **D** 🔴 | Blocked by expenses (D). |
| failed transactions | **B** 🟡 | `TransactionStatus` + failure states persisted; no finance view/search over them. |
| transaction search | **B** 🟡 | `admin/wallet/users/:id/transactions` exists (per-user); no global search/filter surface. |
| bank settlement | **D** 🔴 | Requires an external banking provider; no credentials/config present. |
| report export | **C** 🔴 | No export endpoint anywhere. |

**Finance portal completion: 0% as a portal**; ~30% of its *functions* exist inside the admin console.

### 4.6 PARTNER PROFIT

| Requirement | Class |
| --- | --- |
| daily revenue / daily expenses / net profit / configurable ownership % / daily distribution / automatic partner balance update | **D** 🔴 — all six. See Finding B and §8 rationale. Blocked additionally by the missing expense model (§4.5). |

### 4.7 WALLET

| Requirement | Class | Evidence |
| --- | --- | --- |
| main wallet | **A** 🟢 | `WalletType.MAIN`, provisioned, ledgered. |
| bonus wallet | **A** 🟢 | `BonusWallet` + `BonusWalletService` (grant, convert, forfeit). |
| referral wallet | **C** 🔴 | No `REFERRAL` wallet type; blocked by Referral (C). Could route to BONUS. |
| VIP reward wallet | **B** 🟡 | `RewardWallet` (points + tier multiplier) exists and is real; **not connected to the static `/vip` page**. |
| wallet history | **A** 🟢 | `/wallet/history`, server-authoritative. |
| transaction history | **A** 🟢 | `/transactions`, stored `balanceBefore`/`After`. |

### 4.8 REFERRAL / VIP / REWARDS

| Requirement | Class | Note |
| --- | --- | --- |
| Referral: link, attribution, qualifying deposit, reward, dashboard, earnings, history, leaderboard | **C** 🔴 (all 8) | Models exist; wallet engine exists for ledger-backed payout; safe to implement server-authoritatively. |
| VIP: levels 1–5 | **B** 🟡 | 5 static tiers rendered; no persistence or eligibility. `LoyaltyTier`/`LoyaltyPoints` models exist and are unused. |
| VIP: daily/weekly/monthly/birthday rewards, higher withdrawal limit, special promotions | **C** 🔴 (all 5) | No eligibility engine, no scheduler, no limit enforcement. |
| Rewards: cashback, gift codes, achievements, missions | **B** 🟡 | `Achievement`/`UserAchievement`/`Coupon`/`CouponRedemption` models + `MissionService`/`AchievementService`/`RewardService` are real and ledger-backed; player page wired. Gift-code redemption flow not exposed. |
| Rewards: daily login, weekly, monthly, lucky spin, seasonal events | **C** 🔴 | `/daily`, `/missions`, `lucky-wheel.tsx`, `mystery-chest.tsx` are demo-wallet/static. `SeasonService` exists but is not surfaced. |

### 4.9 NOTIFICATIONS — all 12 types

deposit success · withdrawal status · bonus · referral reward · promotion · partner daily profit ·
withdrawal approved · monthly report · large withdrawal alert · server alert · finance alert ·
support alert

**All 12 → C 🔴** (partner daily profit and finance alert additionally blocked by D-class parents).
In-app durable delivery is safe to implement on the existing `Notification` model + existing gateway.
**Email/SMS/push delivery → E — DEFERRED**: `MailService` logs that it is "running in log-only mode
(no SMTP configured)"; no SMS/push credentials exist.

### 4.10 AUDIT LOGS

Infrastructure **A** 🟢 (real, persisted, tamper-evident schema with actor/IP/UA). Coverage **B** 🟡 —
see Finding G table: 2 of 9 required action classes covered; closing the rest is **C**.

### 4.11 ANALYTICS

| Requirement | Class |
| --- | --- |
| revenue, profit, average bet, most played games, average deposit, average withdrawal, conversion rate | **C** 🔴 — derivable from real persisted tables; aggregation not implemented. |
| DAU, MAU, retention, LTV, session time, bounce rate | **D** 🔴 — **no source data**: the analytics/pageview models are never written; no event capture exists. |

### 4.12 SECURITY

| Requirement | Class | Evidence |
| --- | --- | --- |
| JWT | **A** 🟢 | Global `JwtAuthGuard`. |
| refresh tokens (+ rotation, reuse detection) | **A** 🟢 | Certified 2C.5 / re-certified 2C.15. |
| password encryption | **A** 🟢 | Hashed; verified no plaintext. |
| admin 2FA | **B** 🟡 | `TwoFactorAuth` model + login challenge flow are real, but 2FA is **optional**, not **enforced for admins**. The client requires "admin 2FA". |
| rate limiting | **A** 🟢 | `ThrottlerGuard` global + per-route `@Throttle` (e.g. login 10/60s — observed enforcing during mobile cert). |
| CSRF | **B** 🟡 | Mitigated in practice (bearer-token auth + `SameSite` refresh cookie); **no explicit CSRF token mechanism**. |
| SQL injection protection | **A** 🟢 | Prisma parameterised throughout; no raw-SQL string interpolation found. |
| XSS protection | **A** 🟢 | React escaping; no `dangerouslySetInnerHTML` on user data. |
| secure cookies | **A** 🟢 | `Secure`/`httpOnly`/`SameSite`; the `Boolean('false')` bug was fixed in 2C.13. |
| session management | **A** 🟢 | `Session`/`RefreshToken`, revocation, `logoutAll`. |
| automatic logout | **C** 🔴 | No idle-timeout / auto-logout mechanism. |
| backups | **E** ⚪ | `docs/DISASTER_RECOVERY.md` documents procedure; no automated backup job in-repo. |
| disaster recovery | **E** ⚪ | Documented, not automated. |
| activity monitoring | **B** 🟡 | `SecurityEvent`, `LoginHistory`, `UserActivity` models + `SecurityEventService` exist; no monitoring/alerting surface. |
| **Frontend admin route authorization** | **C** 🔴 | Finding F — added to this matrix because it is a real authorization defect not listed in the brief. |

---

## 5. Domain scan results (brief §4 requirement)

| Domain | Prisma | Backend | Frontend | Verdict |
| --- | --- | --- | --- | --- |
| partner | ✗ | ✗ | orphaned lib | **ORPHANED / frontend-only simulation** |
| finance | ✗ | ✗ | orphaned libs | **ORPHANED** |
| referral | ✓ (3 models) | code-gen only | ✗ | **MODEL-ONLY / unused** |
| vip | ✗ (loyalty models unused) | role slug only | static page | **DEMO / presentation-only** |
| reward | ✓ | ✓ ledger-backed | ✓ wired | **REAL** |
| bonus | ✓ | ✓ ledger-backed | partial | **REAL (backend), no admin UI** |
| promotion | ✓ | partial | static + demo wallet | **PARTIAL / demo** |
| notification | ✓ | **stub (throws)** | static array | **STUB** |
| analytics | ✓ (never written) | **stub (throws)** | placeholder | **STUB** |
| report | partial | wallet reports only | partial | **PARTIAL** |
| audit | ✓ | ✓ real, thin coverage | admin reader | **REAL but under-wired** |
| support | ✓ (help models) | ✗ | static page | **FRONTEND-ONLY / informational** |
| settings | ✓ | ✗ CRUD | placeholder | **MODEL-ONLY** |
| admin | ✓ | ✓ fully guarded | **unguarded shell** | **REAL backend / authz gap in UI** |
| profit | ✗ | ✗ | orphaned | **MISSING** |
| settlement | ✓ | ✓ certified | ✓ | **REAL** (game settlement; *financial daily settlement* missing) |
| payout | ✓ | ✓ withdrawal path | ✓ | **REAL** (player payout; *partner payout* missing) |

---

## 6. Completion percentages (not inflated)

Counted as: A = 1.0, B = 0.5, C/D/E = 0.

| Area | Score | Completion |
| --- | --- | --- |
| **Player portal** | 5×A + 5×B + 2×C over 12 | **62.5%** |
| **Partner portal** | 0 of 10 | **0%** |
| **Finance portal** | 4×B over 12 | **16.7%** |
| **Admin portal** | 2×A + 3×B + 1×C over 6 | **58.3%** |
| **Super admin** | 3×A + 1×B + 3×C + 2×D over 9 | **38.9%** |
| **Wallet** | 4×A + 1×B + 1×C over 6 | **75%** |
| **Referral / VIP / Rewards** | 2×B over 19 leaf items | **5.3%** |
| **Notifications** | 0 of 12 | **0%** |
| **Audit logs** | infra A, coverage 2/9 | **~35%** |
| **Analytics** | 0 of 13 | **0%** |
| **Security** | 8×A + 4×B + 1×C + 2×E over 15 | **66.7%** |
| **Money safety (certified journey)** | double-entry, reconciliation, recovery, 15 games | **~95%** — high confidence, but see §1 (financial integration tests skipped by default) |
| **Mobile readiness (existing routes)** | 26 routes × 3 viewports certified | **~90%** for shipped routes; unmeasured for anything not yet built |
| **Overall client requirement coverage** | 43.5 of ~124 leaf requirements | **≈ 35%** |

---

## 7. Prioritised gap ranking (brief §5)

### P0 — security / authorization / money correctness
1. **Frontend `/admin/*` has no role guard** (Finding F) — C, small, safe.
2. **`/dashboard` shows demo money to real sessions** (Finding C) — C, small, safe.
3. **No audit record for deposit/withdrawal approval, login, logout** (Finding G) — C, additive.
4. **Large-withdrawal escalation absent** — any admin can approve any amount — C.
5. **Admin 2FA not enforced** — B→A, config + guard.

### P1 — client MVP / core portals
6. Partner portal + partner isolation — **D** (new architecture).
7. Finance portal — **D** for the portal; **C** for report/search/export functions inside admin.
8. Notifications (durable, in-app, event-emitted) — **C**.
9. Settings CRUD, admin promotion/bonus management — **C**.
10. Report export — **C**.

### P2 — referral / VIP / rewards / analytics
11. Referral end-to-end — **C**.
12. VIP eligibility + progression + ledger-backed benefits — **C** (metadata) / **D** (limit enforcement).
13. Derivable analytics aggregation — **C**; behavioural analytics — **D**.
14. Demo-wallet removal from `/bets`, `/vault`, `/store`, `/marketplace`, `/promotions`, lucky-spin — **C**.

### P3 — not to be attempted this deadline
15. Bank settlement, payment-gateway integration, SMS/push/email delivery, automated backups/DR,
    behavioural analytics event pipeline, partner white-label/tenancy.

---

## 8. Items I will NOT implement, and why (brief §3, §6, §8)

| Item | Class | Reason |
| --- | --- | --- |
| Partner profit distribution | **D** | Requires a new money-moving accounting path (partner balances, daily distribution, ownership invariants) plus a **daily-expense source that does not exist**. Brief §8 instructs STOP rather than risk the ledger. |
| Daily revenue − expenses = net profit | **D** | No expense model. Inventing one would be fabricating financial data (brief §13). |
| Bank settlement / payment gateway | **E** | No merchant credentials or configuration present (brief §3 example). |
| Email / SMS / push notification delivery | **E** | Mailer is log-only; no SMTP/SMS/push credentials. |
| DAU / MAU / retention / LTV / bounce / session time | **D** | No event-capture pipeline; the analytics tables are never written. Computing them would require fabricating source data. |
| Automated backups / DR | **E** | Infrastructure concern, documented but not automatable in-repo. |

---

## 9. Audit conclusion

The **money core is genuinely strong** — double-entry ledger, 15 ledger-backed games, cashier,
reconciliation, recovery, and a hardened auth stack. That part of the baseline holds up.

The **client's business-operations layer is largely absent**. Partner (0%), Finance (17%),
Notifications (0%) and Analytics (0%) are the four biggest holes, and two of them are D-class. A
substantial body of code that *looks* like these features (`src/lib/partners`, `treasury`, `payments`,
`ledger`, `compliance`, `crm`, `analytics`) is orphaned simulation with no route, no backend and no
persistence — it must not be counted as delivery.

**Overall client requirement coverage: ≈ 35%.**

Three P0 defects are small, safe, additive, and fixable within the existing architecture:
the unguarded admin UI, demo money on the real-session home page, and missing financial audit records.

**Audit complete. No code written. Awaiting go-ahead for the prioritised implementation pass**
(brief §5 onward), with the D/E items above declared out of scope for it.
