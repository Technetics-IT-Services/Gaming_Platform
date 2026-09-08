# Phase 2C.17 — Final Report

**P0 security, money-surface & audit-hardening pass.**
Companion documents: `PHASE_2C17_AUDIT.md` (Phase A), `PHASE_2C17_IMPLEMENTATION.md`.

> **Source-document caveat (unchanged from 2C.16).** The client requirements document was not attached
> and does not exist in the repository (verified by title search across `*.md`/`*.txt` and by extension
> search for `*.pdf`/`*.doc(x)`). The requirement matrix below uses the enumeration supplied in the
> project context. **Nothing in this report is claimed satisfied beyond what the repository proves.**

---

## 1. Defects discovered

| # | Defect | Severity | Discovered |
| --- | --- | --- | --- |
| P0-1 | `/dashboard` — the post-login landing page — rendered **demo** balances, bets and transactions to REAL sessions | P0 | 2C.16 audit |
| P0-2 | `/admin/*` was wrapped in `AuthGuard` only; any authenticated player could load the admin console shell | P0 | 2C.16 audit |
| P0-3 | Cashier operator actions (deposit/withdrawal approve, reject, complete) produced **no** audit record | P0 | 2C.16 audit |
| P0-4 | No large-withdrawal escalation; any principal with `wallets:adjust` could approve any amount | P1 | 2C.16 audit |
| **P0-5** | **Every withdrawal approval returned HTTP 500** — `reviewed_by_id` was written with a `users.id` into a column FK-constrained to the empty `admin_users` table | **P0** | **This phase, Phase A — by executing the workflow, not reading it** |

## 2. Root causes

- **P0-1** — the widgets read `useDemoWallet` unconditionally; there was no real/demo branch. It
  survived because the certified money journey runs through `/lobby`, `/wallet`, `/deposit`,
  `/withdraw` — never `/dashboard`.
- **P0-2** — `AuthGuard` proves authentication only; no role check existed anywhere on the frontend.
- **P0-3** — `AuditService` was real and correct but had only 8 call sites in the whole backend, none
  in the cashier.
- **P0-4** — the concept did not exist; `CASHIER_MAX_WITHDRAWAL` is a hard limit that *rejects*, not an
  escalation.
- **P0-5** — two parallel identity tables. The platform authenticates operators as `users` with RBAC
  roles, but `withdrawal_requests.reviewed_by_id` points at `admin_users` (0 rows). **No test caught it
  because `cashier.integration.spec.ts:93` passed `approveWithdrawal(id, undefined)`** — an argument
  production never passes — inside a suite that is `describe.skip` by default.

## 3. Fixes

See `PHASE_2C17_IMPLEMENTATION.md` for code. Summary: resolve the operator through the existing
`AdminUser.userId` link (null when absent) and keep attribution in `metadata` + the audit trail; route
all dashboard money through one `useDashboardMoney()` hook gated on `useRealSession()`; add an
additive `AdminGuard` over the existing backend-resolved RBAC; call the existing `AuditService` from
the cashier; add a server-side, **disabled-by-default** escalation threshold.

## 4. Files changed — 18

Backend 5 · frontend source 9 · tests 4. Full list in `PHASE_2C17_IMPLEMENTATION.md` §"Files changed".
**No Prisma migration.** No frozen financial or game file touched (§15).

## 5. Dashboard money audit

| Property | Result |
| --- | --- |
| Real session balance source | `GET /wallet-engine/balances` → `available`, rendered as returned |
| Client-side balance arithmetic | **None** — asserted by test (`/balance\s*[+-]=/` must not match) |
| Transactions / rounds | `GET /wallet/history`, `GET /games/history` |
| Demo session | server queries **all disabled**; demo state shown only behind a visible **Demo** badge |
| Loading state | `—`, never a fabricated `0` |
| Error state | visible panel: figures withheld rather than shown unverified |
| "Today" roll-up | server rows for today via the API's `from` filter; `todayTruncated` surfaced honestly |
| Demo-wallet imports in the `/dashboard` tree | **0 of 12 components** (structural test) |
| Live proof | mobile cert asserts the rendered figure contains the server's `available` (19359) at 375/390/412 |

## 6. Admin authorization audit

| Principal | `/admin` (frontend) | Admin APIs (backend) |
| --- | --- | --- |
| Unauthenticated | → `/login` | **401** (verified) |
| Player (`user`) | **"Not authorised"** — no header, no sidebar, no `<main>` (verified live) | **403** on users, audit, wallet stats, cashier approve, operations, roles (6/6 verified) |
| Demo session | denied (no backend principal) | blocked client-side since 2C.15 |
| Partner / Finance | denied by **default-deny** — *note: these roles do not exist yet, so this is not positively testable* | n/a |
| `admin` | allowed | allowed where permitted; **403** on cashier approve (lacks `wallets:adjust`) |
| `super_admin` | allowed | allowed (verified 200 on users, audit, cashier approve) |

No login-flash and no admin-UI flash: the guard renders a neutral shell until `initialized`.
**Backend authority unchanged** — global `APP_GUARD`s and all 17 permission-guarded controllers intact.

## 7. Financial audit coverage

| Action | Before | After |
| --- | --- | --- |
| deposit complete / reject | none | `APPROVE` / `REJECT` |
| withdrawal approve / reject / complete | none | `APPROVE` / `REJECT` / `EXECUTE` |
| escalated approval refused | n/a | `EXECUTE` with `outcome` |
| user registration, admin user actions | present | unchanged |
| **login / logout / admin login / game config / settings change** | **none** | **still none — remaining gap** |

Captured per record: actor, actor roles, action, target, affected user, reference, amount, currency,
from/to status, request id, IP, user-agent, timestamp. Non-blocking (existing `AuditService` contract),
recorded **after** money movement, so it cannot alter a financial outcome. Idempotent transitions do
not double-log (verified: 1 row after two approvals; 1 row after two rejections).

## 8. Large withdrawal status

**IMPLEMENTED AS MECHANISM — BUSINESS-CONFIG REQUIRED.**

- Threshold: `CASHIER_LARGE_WITHDRAWAL_THRESHOLD`, **unset by default ⇒ escalation disabled ⇒ current
  behaviour byte-for-byte**. No figure was invented.
- Server-side only; derived from the **stored** amount; persisted in `metadata`; restart-safe (verified
  across a real backend restart).
- Escalated approval requires `super_admin`; ordinary operator refused with `403`, refusal audited,
  status and held funds unchanged.
- Live-verified with the threshold set to 1000: 2500 → `largeWithdrawal: true`, refused for non-super,
  approved by super-admin, audit shows `escalated: true, threshold: 1000`.
- **Operational caveat:** the `admin` role does not currently hold `wallets:adjust`, so *all* cashier
  approvals are already super-admin-only. The escalation gate is therefore presently redundant and
  becomes operative when a finance/operator role exists. `wallets:adjust` was **not** granted to
  `admin` — that is a business decision.

## 9. Demo-wallet audit

Real-money journey — `/dashboard`, `/lobby`, `/wallet`, `/wallet/history`, `/deposit`, `/withdraw`,
`/transactions`, `/game-history`, `/profile`, `/verification`, all 15 `*-money` routes: **ZERO**
demo-wallet dependency.

Remaining consumers, all classified and isolated: the hook's own demo branch; `.reset()`-on-logout in
`user-menu`/`mobile-drawer` (displays nothing); `balance-pill` (already session-gated); `bet-gate` and
the two `/promotions` reward widgets — **now carrying a visible "Demo funds" badge** so they cannot
masquerade as real wallet state; and legacy demo surfaces (`/bets`, `/vault`, `/store`, `/marketplace`,
`/mailbox`, prototypes) outside the money journey.

## 10. Security / RBAC results

Authorization matrix: **14 of 15 checks passed on the first run.** The one "failure" was my own
expectation — `GET /catalog` returns 401 unauthenticated because it carries no `@Public()` decorator;
that is correct by design (it exposes real-money limits), not a defect.

Auth lifecycle, live-verified: httpOnly refresh cookie set ✔ · refresh rotates ✔ · **replaying a
rotated token → 401 and the family is burned** ✔ · logout → 200 ✔ · **refresh after logout → 401** ✔ ·
no `password`/`passwordHash` in any response body ✔ · cross-user ownership: another user's withdrawal →
404 ✔.

**No security control was weakened.** No change to JWT, refresh rotation, reuse detection, revocation,
password hashing, rate limiting, cookie flags, RBAC or any backend guard.

## 11. Financial regression

Live, against real Postgres + Redis:

| Step | Result |
| --- | --- |
| Deposit request | PENDING, **no credit** (B1 = B0) |
| Operator complete | credited once (B2 = B0 + 500) |
| Re-complete (idempotent) | **no second credit** (B3 = B2) |
| Real-money game stake + settlement | settled; balance moved by net only |
| Idempotent replay of the same play key | `replayed: true`, **no duplicate settlement** |
| Withdrawal request | funds held (B5 = B4 − 200) |
| **Operator approve** | **200 (was 500)** |
| Approve again | idempotent, no second movement |
| Complete | no further movement (B6 = B5) |
| Reject | refunded exactly once (back to B6) |
| Double-reject | **no double refund** (B9 = B8) |

**Invariants:** `SUM(DEBIT) − SUM(CREDIT) = 0.000000000000000000` · negative balances = **0** ·
no duplicate transactions, settlements or refunds · restart preserved every status, escalation flag,
attribution and audit row.

## 12. Mobile verification — 375×812, 390×844, 412×915

`tests/mobile-cert/p2c17.spec.ts`, production build (demo OFF) + same-origin real backend.
**4/4 passed at each of the three viewports:**

- real session renders the **server** balance on `/dashboard`; no "Demo Account" badge
- non-admin refused the admin console, with no admin chrome painted
- admin/super-admin still reach the console
- no horizontal overflow across `/dashboard`, `/lobby`, `/wallet`, `/deposit`, `/withdraw`,
  `/transactions`, `/game-history`, `/dice-money`, `/profile`, `/verification`,
  `/responsible-gaming`, `/support`

*Runs were spaced across the backend's `@Throttle({limit:10, ttl:60_000})` login window; back-to-back
runs exhaust it and fail on `waitForURL`, which is the rate limiter working, not a regression.*

## 13. Tests

| Suite | Result |
| --- | --- |
| Frontend (vitest) | **819 passed / 64 files** (was 789 / 62) |
| Backend (jest, `RUN_DB_IT=1`, `--runInBand`) | **267 passed, 41/42 suites** — 0 failed |
| Backend concurrency stress (`RUN_STRESS=1`) | **10 passed** — S1–S5, 500 mixed ops, ledger balanced |
| **Backend total with every gate enabled** | **277 passed, 0 failed, 0 skipped** |
| Cashier unit | 25 passed (13 new) |
| Cashier DB integration | 15 passed (7 new P0 regressions) |
| Mobile P0 regression | 12 passed (4 × 3 viewports) |

New tests added: **30** (13 backend unit, 7 backend integration, 21 frontend structural/decision,
4 mobile — counted by assertion group). **No test was disabled, skipped, weakened, or made to pass with
fake data.** Two of my own assertions were corrected after the product proved them wrong (the document
`<title>` matching `text=Admin Console`, and reading a mid-animation balance).

Baseline correction worth recording: the previously reported "backend: 171 passing" was
`171 passed, 85 skipped` — and the 10 skipped suites were **exactly the financial ones**. They now run
and pass.

## 14. Typecheck / lint / builds

| Gate | Result |
| --- | --- |
| Frontend typecheck | clean |
| Backend typecheck | clean |
| Frontend lint | **0 errors**, 3 pre-existing warnings (none from this phase — the one I introduced was fixed) |
| Frontend production build | success, 93/93 static pages |
| Backend production build | success |

## 15. Frozen-surface audit

Verified by file mtime across the whole repo for this phase's window:

- `apps/backend/src/modules/wallet-engine/**` — **0 non-spec files changed**
- `apps/backend/src/modules/gaming-money/**` — **0 files changed**
- `packages/database/prisma/**` — **0 files changed; no migration**
- ledger, settlement, recovery, `GameMoneyBridge`, game engines, runtime — **0 files changed**

Changes are confined to the cashier **request-lifecycle** layer (which already owned these
transitions), its controller/module wiring, two dashboard widgets, one new guard, and tests.

## 16. Secret audit

`grep -inE "password|passwordHash|refreshToken|accessToken|serverSeed|secret|api[_-]?key|private[_-]?key"`
across all changed source files: **one hit — a comment stating that secrets are never stored.**

Live audit-trail payload keys (from the database): `actorRoles, affectedUserId, amount, currencyId,
escalated, fromStatus, outcome, reason, reference, refunded, requestId, threshold, toStatus,
transactionId`. No credential material. Asserted in both unit and integration suites.

## 17. Updated client requirement matrix

Only rows whose status **changed** in this phase are listed; everything else stands as recorded in
`PHASE_2C16_AUDIT.md`.

| Requirement | 2C.16 | Now | Note |
| --- | --- | --- | --- |
| Player portal — Home | PARTIAL | **COMPLETE** | server-authoritative money, honest states |
| Admin portal — admin-only access | PARTIAL | **COMPLETE** | frontend boundary added; backend already complete |
| Audit logs — withdrawal approval/rejection | MISSING | **COMPLETE** | |
| Audit logs — deposit approval/rejection | MISSING | **COMPLETE** | |
| Audit logs — overall coverage | PARTIAL (2/9) | **PARTIAL (4/9)** | login, logout, admin login, game-config and settings changes still missing |
| Super admin — approve large withdrawals | MISSING | **BUSINESS-CONFIG REQUIRED** | mechanism shipped disabled; needs the client's threshold |
| Withdrawal workflow (operator approval) | *believed COMPLETE* | **COMPLETE — and was in fact BROKEN until this phase** | P0-5 |

**Unchanged and still RED:** Partner portal (0%), Finance portal, Referral, VIP eligibility/rewards,
Notifications (all 12 types), Analytics (all 13 metrics), Reports/export, Settings CRUD.
None of these was in scope for this pass, and **no frontend artifact for them should be read as
delivery** — `src/lib/partners`, `treasury`, `payments`, `ledger`, `compliance`, `crm`, `analytics`
remain orphaned simulations with no route, backend or persistence.

Estimated overall client requirement coverage: **≈ 37%** (was ≈ 35%). The increase is small by design —
this pass bought **safety and correctness**, not surface area.

## 18. Remaining gaps

**P0/P1 — none open in the areas this phase covered.**

Carried forward, in priority order:

1. Audit coverage for login, logout, admin login, game-configuration and settings changes (**C**, small).
2. A finance/operator role holding `wallets:adjust` — without it the escalation control is inert and
   all approvals are super-admin-only (**C**, but a business/security decision).
3. Admin 2FA enforcement (**B → A**).
4. Automatic idle logout (**C**).
5. Explicit CSRF token mechanism (**B**; currently mitigated by bearer auth + `SameSite`).
6. Notifications, Referral, VIP eligibility, derivable Analytics, Reports/export, Settings CRUD (**C**).
7. Partner portal, partner profit distribution, Finance portal (**D** — new architecture).

## 19. Deferred requirements

| Item | Class | Reason |
| --- | --- | --- |
| Large-withdrawal threshold value | **BUSINESS-CONFIG REQUIRED** | no client figure; inventing one is inventing policy |
| Partner profit distribution | **D** | needs a Partner model, ownership store, and a **daily-expense source that does not exist** |
| Bank settlement / payment gateway | **E** | no merchant credentials or configuration |
| Email / SMS / push delivery | **E** | mailer is log-only; no credentials |
| DAU / MAU / retention / LTV / bounce / session time | **D** | no event-capture pipeline; the analytics tables are never written |
| Automated backups / DR | **E** | documented, not automatable in-repo |
| Physical-device mobile testing | **E** | emulation only in this environment |
| HTTPS / `Secure` cookie path | **E** | local HTTP only |

## 20. Final readiness

| Area | Readiness | Basis |
| --- | --- | --- |
| Money safety (certified journey) | **~97%** | debit = credit exactly, no negatives, no duplicates, restart-safe, **all financial integration + stress suites now run and pass** |
| Security / RBAC | **~72%** | frontend boundary closed; 2FA enforcement, idle logout, explicit CSRF outstanding |
| Audit coverage | **~45%** | 4 of 9 required action classes |
| Player portal | **~67%** | Home now genuine |
| Admin portal | **~67%** | access control complete; reports/settings/promotions still placeholders |
| Partner portal | **0%** | nothing exists at any layer |
| Finance portal | **~17%** | functions exist inside admin; no portal, no role |
| Mobile readiness (shipped routes) | **~92%** | 3 viewports × 12 routes, plus the P0 checks |
| **Overall client requirement coverage** | **≈ 37%** | not inflated |

## 21. Verdict

# GO WITH BLOCKERS

**Why GO:** every P0 defect this pass targeted is closed and independently verified against a real
database — including **P0-5, a total outage of withdrawal approval that no prior phase had detected**.
The financial invariants hold exactly (`difference = 0`), the previously-skipped financial integration
and concurrency suites now run and pass in full, no security control was weakened, no frozen surface
was touched, and no business policy or financial figure was invented.

**The blockers are scope, not safety:**

1. **BUSINESS-CONFIG REQUIRED** — the large-withdrawal threshold must be supplied by the client before
   escalation does anything, and a role holding `wallets:adjust` below super-admin must be defined for
   it to be meaningful.
2. **Partner portal (0%) and Finance portal (~17%)** — the client's two most substantial requirements
   remain unbuilt, and partner profit distribution is **D** because no expense data source exists.
3. **Notifications (0%) and Analytics (0%)** — stubs that throw; behavioural analytics has no source
   data at all.
4. **Audit coverage is 4 of 9** required action classes.
5. **The client requirements document was never available** — this matrix is built from the context
   enumeration and must be re-validated against the real specification.

Not GO outright, because the client's own requirement list is well under half delivered.
Not NO-GO, because nothing unsafe, fabricated, or financially incorrect remains in what *has* shipped.

**Nothing was committed.**
