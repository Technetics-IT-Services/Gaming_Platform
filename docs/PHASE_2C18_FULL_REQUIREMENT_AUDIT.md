# Phase 2C.18 — Full Requirement Audit (evidence-based)

**AUDIT ONLY. No code, schema, migration, UI, RBAC or financial change was made in this phase.**

Date: 2026-08-27 · Repo: `d:/Projects/Hire` · Verified against a live stack
(Postgres `gp_phase1_pg`:55432 · Redis :56379 · backend :4100 · production frontend :3100).

---

## Step 1 — The requirements source

### The client requirements document is NOT in this repository. Stated plainly.

Searched exhaustively:

| Search | Result |
| --- | --- |
| `*.pdf`, `*.docx`, `*.doc`, `*.xlsx`, `*.csv`, `*.txt`, `*.rtf`, `*.odt` (depth 5, excl. `node_modules`) | **1 hit — `apps/frontend/public/robots.txt`.** Nothing else. |
| Filenames matching `*requirement*`, `*brief*`, `*PRD*`, `*SRS*`, `*scope*`, `*onboarding*` | only `*.spec.ts` test files |
| Content matching `client (brief\|requirement\|specification)`, `complete system requirements`, `product requirement` across all `*.md` | **only my own** `PHASE_2C16_AUDIT.md`, `PHASE_2C17_*.md` |
| Screenshots / images outside `public/` and `coverage/` | none |
| `README.md`, `CHANGELOG.md`, `RELEASE_NOTES.md`, `FINAL_CERTIFICATION.md` | technical/architectural only — **no product requirement statements** |

**Strongest available requirement source, explicitly identified:** the requirement enumeration supplied
in the Phase 2C.16 task prompt, transcribed verbatim into `docs/PHASE_2C16_AUDIT.md` §4. That list is
itemised to leaf level and is treated as the client's own words.

**Consequence for this audit:** every percentage below is computed against *that* enumeration. If the
real document contains requirements or acceptance criteria beyond it, **this matrix is incomplete** and
must be re-run. **No requirement has been inferred or invented.**

### Why the previous 35–37% figure is discarded

The 2C.16 estimate was computed partly from source-file presence. This audit re-derives every status
from **runtime evidence** — live API calls, database queries, and executed test suites — and reaches a
different, better-founded number (§Step 12).

---

## Step 3 — Real implementation vs orphaned code

### The single most important finding in this audit

`apps/frontend/src/lib/` contains 14 substantial "platform" subsystems. Measured:

| Library | LOC | Imported by any `.tsx` | Reachable from `app/` | Calls a backend |
| --- | --- | --- | --- | --- |
| tenancy | 2,439 | 0 | 0 | **0** |
| crm | 1,830 | 0 | 0 | **0** |
| analytics | 1,650 | 0 | 0 | **0** |
| compliance | 1,628 | 0 | 0 | **0** |
| integrations | 1,605 | 0 | 0 | **0** |
| operations | 1,598 | 0 | 0 | **0** |
| partners | 1,556 | 0 | 0 | **0** |
| security | 1,430 | 0 | 0 | **0** |
| resilience | 1,175 | 0 | 0 | **0** |
| treasury | 1,031 | 0 | 0 | **0** |
| ledger | 868 | 0 | 0 | **0** |
| infra | 816 | 0 | 0 | **0** |
| perf | 764 | 0 | 0 | **0** |
| payments | 741 | 0 | 0 | **0** |
| **Total** | **19,131** | **0** | **0** | **0** |

**All 14 are ORPHANED.** 19,131 lines = **24.5% of the 78,126-line frontend source tree** is
unreachable, unpersisted, in-memory simulation with no backend call anywhere.

> A note on rigour: `lib/operations` initially appeared to have one consumer. It does not — the
> `admin/operations` page imports `@/lib/operations-**api**`, a *different* file that is a real backend
> client. The prefix match was misleading. Verified individually.

These libraries carry **227 passing unit tests**. Those tests are green and well written; they simply
do not evidence product functionality. **None of this code is counted as delivery anywhere in this
audit**, and none of it should be shown in a client demo.

### Classification key used throughout

**REAL PRODUCTION** = reachable route → real API → backend persists → DB model → authorized → tested →
live-verified. **PARTIAL** = some layers only. **DEMO** = client-side fiction, isolated and labelled.
**ORPHANED** = unreachable. **DEFERRED** = intentionally not built.

---

## Step 4A — Player platform

| Requirement | Evidence | Class |
| --- | --- | --- |
| Registration | live `POST /auth/register` → 200, user + default role assigned, audited | **REAL** |
| Login | live 200, JWT + httpOnly refresh cookie | **REAL** |
| Logout | live 200; refresh afterwards → **401** (verified) | **REAL** |
| Sessions | `Session`/`RefreshToken` models, `logoutAll`, revocation | **REAL** |
| Password | hashed; no `password`/`passwordHash` in any response body (verified) | **REAL** |
| 2FA | `TwoFactorAuth` model + challenge flow real, but **optional — not enforced for admins** | **PARTIAL** |
| Profile | `/users/me`, real | **REAL** |
| Verification | `GET /users/me/verification` returns real email/phone/KYC state | **REAL (read-only)** |
| **KYC** | `kycVerification.findFirst` — **read only. No submission, no review, no admin approval endpoint** | **PARTIAL — display only** |
| Wallet | MAIN/BONUS/REWARD, double-entry ledger | **REAL** |
| Transactions | `/wallet/history`, stored `balanceBefore/After` | **REAL** |
| Deposit | `DepositRequest` PENDING → operator credit | **REAL (no gateway)** |
| Withdrawal | hold-on-request → approve/reject → refund | **REAL** |
| Cashier | config + limits server-enforced | **REAL** |
| Game history | `/games/history` (141 rounds for the test account) + full traceability bundle | **REAL** |
| **Notifications** | live `GET /notifications` → **501 Not Implemented** | **RED** |
| **Responsible gaming** | page reads *cashier limits*; **grep across the whole backend finds no self-exclusion, cooling-off, deposit/loss/wager/session limit — zero enforcement** | **PARTIAL — disclosure only** |
| Support | 69-line static page, no backend, no ticket model | **PARTIAL — informational** |
| Mobile UX | see Step 7 | **REAL, with gaps** |

## Step 4B — Game platform (live-exercised, all 15)

Every game was played for real money against the live backend, then replayed with the same
idempotency key.

| Game | Route | Config | Play | Settled | Idempotent replay |
| --- | --- | --- | --- | --- | --- |
| dice | `/dice-money` | 200 | 200 | SETTLED | `replayed: true` |
| crash | `/crash-money` | 200 | 200 | RESERVED → cashout endpoint | `replayed: true` |
| roulette | `/roulette-money` | 200 | 200 | SETTLED | `replayed: true` |
| sic-bo | `/sic-bo-money` | 200 | 200 | SETTLED | `replayed: true` |
| plinko | `/plinko-money` | 200 | 200 | SETTLED | `replayed: true` |
| limbo | `/limbo-money` | 200 | 200 | SETTLED | `replayed: true` |
| coin-flip | `/coin-flip-money` | 200 | 200 | SETTLED | `replayed: true` |
| wheel | `/wheel-money` | 200 | 200 | SETTLED | `replayed: true` |
| baccarat | `/baccarat-money` | 200 | 200 | SETTLED | `replayed: true` |
| dragon-tiger | `/dragon-tiger-money` | 200 | 200 | SETTLED | `replayed: true` |
| andar-bahar | `/andar-bahar-money` | 200 | 200 | SETTLED | `replayed: true` |
| teen-patti | `/teen-patti-money` | 200 | 200 | SETTLED | `replayed: true` |
| mines | `/mines-money` | 200 | start 200 → reveal 200 → cashout 200 | SETTLED | multi-step |
| blackjack | `/blackjack-money` | 200 | start 200 → action 200 | SETTLED | multi-step |
| lottery | `/lottery-money` | 200 | buy 200 → ticket in OPEN draw #364 with `serverSeedHash` | scheduled | idempotent buy |

**15 / 15 playable for real money. 15 / 15 idempotent. Zero duplicate movement on replay.**

> **Correction to my own first pass.** An initial sweep reported 6/15 playable. That was **wrong** —
> my request payloads were guesses. After reading the actual DTOs
> (`apps/backend/src/modules/gaming-money/dto/*`) and each game's `/config`, all 15 pass. The failures
> were mine, not the product's. Recorded here because an audit that hides its own errors is worthless.

Also verified: `GET /catalog` returns all 15 with server-authoritative `enabled`, `maintenance` and
per-game limits; the traceability bundle exposes `round`, `reservation`, `settlement`,
`walletTransactions`, `ledger`; lottery publishes a `serverSeedHash` before the draw (provably fair);
`GET /games/recovery/health` → `pending: 0, recovering: 0, recoveryFailed: 9` (the 9 are residue from
deliberate fault-injection tests, not live incidents).

**Unwired games present in the frontend but NOT real-money:** fruit-slots, hilo, poker, casino-war,
lucky-7, bingo, keno, grid-reveal, tower, lucky-pick, and the demo `/dice`, `/crash`, `/roulette`
tables. These are demo/prototype only. **Not implemented in this phase, as instructed.**

## Step 4C — Admin (live probe as `super_admin`)

| Surface | Live | Class |
| --- | --- | --- |
| Users list | 200 | **REAL** |
| Roles / RBAC | 200 | **REAL** |
| Audit trail | 200 | **REAL** |
| Wallet statistics | 200 | **REAL** |
| **Wallet reconcile** | 200 — `{debit: 4339467.4999…, credit: 4339467.4999…, balanced: true, difference: "0"}` | **REAL** |
| Wallet report overview | 200 | **REAL** |
| Operations overview / metrics / logs / queue / alerts | 200 | **REAL** |
| Cashier deposit/withdrawal transitions | 200 (fixed in 2C.17) | **REAL** |
| Game rounds traceability | 200 with a valid round id | **REAL** |
| Tournament / missions / achievements / rewards admin | 200 | **REAL** |
| **Analytics** | live `GET /analytics/summary` → **501 Not Implemented** | **RED** |
| **Admin dashboard / settings pages** | 22–24-line honest placeholders ("Charts render here once…") | **RED (not fabricated)** |
| **KYC review** | no endpoint | **RED** |
| **Responsible-gaming admin** | no endpoint | **RED** |
| **Notifications admin** | no endpoint | **RED** |
| **CRM / Support** | no backend module | **RED** |
| Reports / export | only wallet reports; **no export endpoint anywhere** | **PARTIAL** |

## Step 4D — Partner / Affiliate

| Layer | Evidence |
| --- | --- |
| Prisma model | **zero occurrences of "partner"** across all 18 schema files |
| RBAC role | **no `partner` role** in `ROLE_DEFINITIONS` (`user, vip, moderator, admin, super_admin`) |
| Backend module | **zero occurrences of "partner"** anywhere in `apps/backend/src` |
| Frontend route | none |
| Only artefact | orphaned `src/lib/partners/` (1,556 LOC, unreachable, no backend) |

**Every sub-requirement — registration, authentication, dashboard, referral links, attribution,
commission, revenue share, partner wallet, partner withdrawal, reports, fraud controls, RBAC — is RED.
Partner isolation is not even testable: there is no partner principal to test with.**

Missing dependencies enumerated in `PHASE_2C18_DEPENDENCY_MAP.md`.

## Step 4E — Finance

| Requirement | Evidence | Class |
| --- | --- | --- |
| Deposits / withdrawals review | exists, but as an *admin* function; no finance role, no finance portal | **PARTIAL** |
| Treasury | orphaned `lib/treasury` only | **RED** |
| Revenue | derivable from `WalletTransaction`; not implemented | **RED** |
| **Expenses** | **no expense model exists anywhere in the schema** | **RED — blocking** |
| **Profit** | `Revenue − Expenses` has **no minuend source** | **BLOCKED by missing accounting data** |
| Payment reconciliation | ledger reconcile is real; *payment-provider* reconciliation absent | **PARTIAL** |
| Daily settlement | game settlement real; **daily financial close absent** | **RED** |
| Fees / commission | no model | **RED** |
| Finance dashboard / reports | none | **RED** |

**Profit calculation is explicitly marked BLOCKED by missing accounting data. No revenue, expense or
profit figure has been fabricated anywhere in this audit.**

## Step 4F — Notifications

| Channel | Evidence | Class |
| --- | --- | --- |
| In-app | `GET /notifications` → **501**; `Notification` model exists and is **never written by any code** | **RED** |
| Email | `MailService` logs *"Mailer running in log-only mode (no SMTP configured)"* — **must not be counted as production** | **BLUE** |
| SMS | no provider, no code | **BLUE** |
| Push | no provider, no code | **BLUE** |
| Templates | `NotificationTemplate` model exists, unused | **RED** |
| Preferences | `NotificationPreference` model exists, unused | **RED** |
| Delivery status / retry | none | **RED** |
| **Event emission** | **no backend code anywhere calls `NotificationsService`** — no deposit, withdrawal, bonus, referral or promotion event emits anything | **RED** |

All 12 client-required notification types are RED.

## Step 4G — Analytics

**There is no event pipeline.** `RevenueAnalytics`, `TrafficAnalytics`, `GeoAnalytics`,
`DeviceAnalytics` and `PageView` models exist and are **never written to by any backend code**.
`AnalyticsService` throws `NotImplementedException` (live-confirmed 501).

| Metric | Source available? | Class |
| --- | --- | --- |
| revenue, profit-before-split, average bet, most-played games, average deposit/withdrawal, conversion | **yes** — derivable from `WalletTransaction`, `GameRound`, `DepositRequest`, `WithdrawalRequest`, `User` | **RED (buildable)** |
| DAU, MAU, retention, LTV, session time, bounce rate, cohorts | **no** — requires event capture that does not exist | **BLOCKED** |

**Marked blocked rather than fabricated**, as instructed.

## Step 4H — Compliance

The distinction the brief asks for, stated precisely:

| Requirement | READ-ONLY STATE | ACTUAL ENFORCEMENT |
| --- | --- | --- |
| KYC submission | — | **none** — no endpoint |
| KYC review | — | **none** — no admin endpoint |
| Verification status | **yes** — real email/phone/KYC read | n/a |
| RG deposit limits | shows *cashier* min/max (transaction limits, not RG) | **none** |
| RG loss / wager / session limits | — | **none** |
| Self-exclusion | — | **none** |
| Cooling-off | — | **none** |
| AML / suspicious activity | `SecurityEvent` model + an AI `risk.service` exist | **no AML workflow** |
| Audit trail | **yes — real and persisted** | 4 of 9 required action classes |

Backend-wide grep for `selfExclusion|coolingOff|depositLimit|wagerLimit|lossLimit|sessionLimit`
returns **one** hit — a hardcoded `depositLimitUtilisation: 0` inside an AI risk heuristic.
**There is no responsible-gaming enforcement anywhere in this product.**

---

## Step 5 — Security audit (live probes)

| Probe | Result |
| --- | --- |
| Mass assignment: `payout` + `userId` + `balance` injected into a game play | **400 — "property payout should not exist"** |
| Mass assignment: `status` + `userId` injected into a withdrawal | **400** |
| IDOR: player reads another user's withdrawal | **404** |
| IDOR: player reads another user's game round | **403** |
| IDOR: player reads another user's profile | **403** |
| Role escalation: player self-assigns `admin` | **403** |
| Role escalation: player calls `POST /admin/wallet/credit` on self | **403** |
| Player → 6 admin endpoints (users, audit, wallet stats, cashier approve, operations, roles) | **403 on all 6** |
| Unauthenticated → admin / wallet | **401** |
| Refresh rotation | rotates; **replay of a rotated token → 401 and the family is burned** |
| Logout revocation | logout 200 → refresh afterwards **401** |
| Rate limiting | login throttle engages within 14 attempts |
| CORS | arbitrary origin **not reflected** |
| Secrets in responses | no `password` / `passwordHash` in any body |
| Admin frontend guard | player at `/admin` sees only "Not authorised" — no header, sidebar or `<main>` |

**No security regression. All controls from 2C.17 intact.**

Remaining security gaps (unchanged): admin 2FA not *enforced*; no automatic idle logout; no explicit
CSRF token mechanism (mitigated by bearer auth + `SameSite` cookie); activity monitoring has models but
no surface.

## Step 6 — Financial safety audit

After ~25 live real-money rounds plus deposit/withdrawal/refund cycles this session:

| Invariant | Result |
| --- | --- |
| `SUM(DEBIT) − SUM(CREDIT)` | **0.000000000000000000** |
| Admin reconcile endpoint | `balanced: true, difference: "0"` |
| Negative balances | **0** |
| Duplicate settlement | none — every replay returned `replayed: true` with zero balance movement |
| Duplicate refund | none — double-reject left the balance unchanged |
| Duplicate withdrawal completion | none — idempotent |
| Duplicate deposit credit | none — re-complete credited once |
| Restart persistence | statuses, escalation flags, attribution and audit rows survived a real backend restart |
| Recovery | `pending: 0, recovering: 0` |

**Financial core untouched and healthy.**

## Step 7 — Mobile product audit

Measured on the production build at all three viewports. Full data in
`PHASE_2C18_GAP_MATRIX.md` §Mobile.

**Strengths (verified, all 16 routes, all viewports):** zero horizontal overflow · bottom navigation
present on every route · sticky positioning present · `safe-area-inset` used · numeric `inputMode` on
every money form (so phones raise a numeric keypad) · no render errors.

**The one systematic gap — touch-target size.** Share of visible interactive elements below the 44px
comfortable minimum, at 390×844:

| Route band | Below 44px |
| --- | --- |
| Real-money game routes (`/dice-money`, `/crash-money`, `/blackjack-money`, `/lottery-money`) | **3–14%** — best in the product |
| Player journey (`/dashboard`, `/lobby`, `/deposit`, `/game-history`, `/profile`, `/responsible-gaming`) | 23–35% |
| Account/history pages (`/wallet`, `/wallet/history`, `/transactions`, `/support`) | **64–72%** — worst |

Recurring offenders are **shared chrome, not page content**: the hamburger button (39×39), the logo
link (160×32), and the "Dashboard" back-link (81×18). The 1×1 "Skip to content" link is a standard
visually-hidden a11y pattern and is **not** a defect — excluding it removes one from every count.

This is a **P2 UX gap**, not a P0: nothing is unusable, and the money-critical game surfaces are
already the best in the product. Fixing the three shared chrome elements would improve every route at
once.

---

*Prioritisation, dependency chains, roadmap and completion scoring are in the companion documents.*
