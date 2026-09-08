# Phase 2C.18 — Recommended Implementation Roadmap

Derived from the audit evidence and the dependency chains — **not** from a generic template, and not
by continuing the 2C.19/2C.20 numbering blindly. Each phase is named for what it delivers.

Sequencing principles applied:
1. Never build on a missing prerequisite (see `PHASE_2C18_DEPENDENCY_MAP.md`).
2. Prefer items that unblock several others.
3. Prefer items with zero external dependency, so nothing stalls waiting on a third party.
4. Never fabricate data to make a feature appear complete.
5. Never touch the frozen financial core unless a defect is proven.

---

## Step 8 — True priority classification

### P0 — security, financial correctness, authorization, money integrity

**There are no open P0 defects.** Every P0 found in 2C.16/2C.17 is closed and re-verified this phase:
ledger `difference = 0`, no negative balances, no duplicate settlement/refund/credit, mass-assignment
rejected, IDOR refused, role escalation refused, admin console guarded both layers, refresh rotation +
reuse detection + logout revocation all working, withdrawal approval fixed.

The nearest-to-P0 remaining items are **P1 security hardening**, not defects:

| Item | Why not P0 |
| --- | --- |
| Admin 2FA not enforced | 2FA exists and works; enforcement is a policy toggle |
| No automatic idle logout | sessions still expire and are revocable |
| No explicit CSRF token | mitigated by bearer auth + `SameSite` refresh cookie |
| Audit covers 4/9 action classes | the 5 missing are non-financial (login/logout/config/settings) |

> Deliberately **not** classified P0: Partner, Finance, Notifications, Analytics. They are large and
> absent, but absence of a module is not a correctness defect — per the brief's own instruction.

### P1 — required for a credible production product
Notifications (in-app + events) · Responsible-gaming enforcement · KYC submission + review ·
Audit completion · Admin 2FA enforcement · Reports + export · Admin cashier UI · `finance`/`partner`
roles · Referral attribution.

### P2 — valuable, not blocking
Derivable analytics + admin dashboard · Settings CRUD · Support tickets · Partner portal ·
Finance portal · Mobile touch-target pass · Promotions/bonus admin · VIP eligibility engine.

### P3 — later
Behavioural analytics pipeline · Unwired demo games → real money · White-label/tenancy ·
Advanced fraud/AML tooling · Landscape game layouts.

---

## Recommended phase sequence

### Phase 2D.1 — Notifications & Event Backbone  ·  P1  ·  ~1 week  ·  no external dependency
Replace the 501 stub with the real service on the existing `Notification` model; emit from the six
hook points that already exist (deposit complete/reject, withdrawal approve/reject/escalate, bonus,
reward); wire the existing `/notifications` page; honour `NotificationPreference`.

*Why first:* shortest chain in the backlog, every hook already runs, unblocks support replies, RG
alerts and partner alerts later. External email/SMS/push stays **BLUE** and explicitly out of scope.

**Done when:** a real deposit approval produces a durable, user-scoped, unread notification visible on
mobile, with an audit trail — verified live.

### Phase 2D.2 — Audit Completion & Security Hardening  ·  P1  ·  ~3 days  ·  no external dependency
Audit records for login, logout, admin login, game-configuration change, settings change (4/9 → 9/9).
Enforce 2FA for `admin`/`super_admin`. Add idle-timeout logout. Decide and document the CSRF posture.

*Why here:* small, additive, reuses `AuditService`, and closes the last security gaps before more
surface area is added.

### Phase 2D.3 — Responsible Gaming Enforcement  ·  P1  ·  ~1.5 weeks  ·  needs a design decision
Limits model (deposit/loss/wager/session/cooling-off/self-exclusion) + a **pre-check service invoked
before** the cashier and the game bridge — **never inside WalletEngine**. Player self-service UI, admin
surface, audit on every limit change.

*Why here:* it is the largest compliance gap, it is the difference between a disclosure page and a
regulated product, and it depends on 2D.1 for alerts.
**Design gate:** the frozen-surface interaction must be reviewed and approved before coding.

### Phase 2D.4 — KYC Submission & Review  ·  P1  ·  ~1 week  ·  needs a storage decision
Submission endpoint, document storage, admin review queue with approve/reject, audit, status surfacing
(the read side already works).

**Blocked on:** where documents are stored (local vs object store) — a business/infra decision.

### Phase 2D.5 — Referral Attribution  ·  P1/P2  ·  ~1 week  ·  needs reward rules
Capture the referral code at registration; persist attribution; trigger on qualifying deposit;
idempotent ledger-backed reward; dashboard, history, leaderboard.

*Why here:* the models already exist, and it is the **prerequisite for any partner work** — building
partner first without it would be building on sand.
**Blocked on:** reward amount + qualification rules (business).

### Phase 2D.6 — Derivable Analytics & Admin Dashboard  ·  P2  ·  ~1 week  ·  no external dependency
Aggregation over existing real tables: revenue, average bet, most-played games, average
deposit/withdrawal, conversion. Replace the 501 and the placeholder dashboard. **Explicitly exclude**
DAU/MAU/retention/LTV — mark them blocked in the UI rather than faking them.

### Phase 2D.7 — Finance Role & Portal  ·  P2  ·  ~1.5 weeks  ·  partially blocked
Add the `finance` role and a scoped portal reusing the **existing** cashier and reconcile endpoints:
deposit/withdrawal review, transaction search, failed transactions, ledger view, revenue, report
export.

**Ships without profit.** Profit stays **BLOCKED** until an expense source exists.

### Phase 2D.8 — Expense & Accounting Model  ·  P2  ·  ~1 week  ·  needs a chart of accounts
The single highest-leverage missing data model. Unblocks finance profit **and** partner profit
distribution simultaneously.
**Blocked on:** what counts as an expense, and the chart of accounts (business).

### Phase 2D.9 — Partner Platform  ·  P2  ·  ~3 weeks  ·  heavily blocked
Partner model, `partner` role, partner auth + isolation, dashboard, commission rules, partner ledger
accounts, payout workflow, reports, isolation tests.

**Requires 2D.5 (attribution) and 2D.8 (expenses) first.** Profit distribution remains **PURPLE** until
ownership percentages and the `sum = 100%` policy are supplied.

### Phase 2D.10 — Mobile Touch-Target & UX Pass  ·  P2  ·  ~3 days  ·  no external dependency
Fix the three shared chrome elements (hamburger 39×39, logo link 160×32, back-link 81×18) — which
improves every route at once — then the account/history pages (64–72% below 44px).

*Can be run in parallel with any backend phase; it touches no financial code.*

### Phase 2D.11 — Payment Gateway  ·  **BLUE — do not start without credentials**
Provider integration, webhook + signature verification, idempotent credit (the internal half is
already safe), reconciliation, chargeback handling.

### Phase 2D.12 — Behavioural Analytics Pipeline  ·  P3
Event schema, emission, ingestion, cohorting. Only after the derivable half proves useful.

---

## Step 11 — What NOT to build yet, and why

| Do not build | Reason |
| --- | --- |
| **Partner profit distribution** | No expense data source. Would require inventing financial figures. Ownership percentages are unset business policy. |
| **Revenue − Expenses = Profit anywhere** | Same missing minuend. Do not ship a profit number until 2D.8. |
| **DAU / MAU / retention / LTV / bounce / session time** | No event pipeline. Any number shown today would be fabricated. |
| **Email / SMS / push delivery** | Mailer is log-only; no SMTP, SMS or push credentials exist. |
| **Payment gateway** | No merchant credentials. |
| **Bank settlement** | External banking provider + credentials. |
| **Automated backups / DR** | Infrastructure concern; documented, not automatable in-repo. |
| **Wiring the 10+ demo games to real money** | Not a client requirement; adds risk surface for no requirement coverage. |
| **Anything built on `src/lib/*` orphaned libraries** | 19,131 LOC of unreachable simulation. Do not resurrect it — rebuild against the real backend when the feature is actually scoped. |
| **A second wallet, ledger, audit or cashier system** | One of each already exists and is certified. |

---

## Shortest path to maximum client-requirement coverage

Ranked by requirement-coverage gained per unit of effort, with **zero external dependency**:

| Order | Phase | Leaf requirements moved toward GREEN | External blocker? |
| --- | --- | --- | --- |
| 1 | **2D.1 Notifications** | **12** | none |
| 2 | **2D.6 Derivable analytics** | **7** | none |
| 3 | **2D.2 Audit + security** | **7** | none |
| 4 | **2D.3 Responsible gaming** | **6** | design gate only |
| 5 | **2D.5 Referral** | **8** | reward rules (business) |
| 6 | **2D.10 Mobile UX** | improves all 16 routes | none |

**Doing 2D.1 + 2D.6 + 2D.2 alone — roughly 2–3 weeks with no third-party dependency — converts ~26
leaf requirements and lifts overall coverage from ≈40% to roughly ≈57%.** That is the fastest credible
route to a materially more complete product, and none of it touches the frozen financial core.
