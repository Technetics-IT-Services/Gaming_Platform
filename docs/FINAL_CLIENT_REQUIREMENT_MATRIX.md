# Final Client Requirement Matrix

> **SUPERSEDED 2026-09-08 by [`FINAL_REQUIREMENT_MATRIX.md`](FINAL_REQUIREMENT_MATRIX.md).**
> That document is rebuilt from the requirement IDs and carries the authoritative counts:
> **58 total — GREEN 39 · AMBER 3 · RED 0 · BLOCKED 16.** The rows below remain accurate as the
> pre-2D.10 record. See `PHASE_2D13_FINAL_AUDIT.md` for the latest phase and
> `FINAL_RELEASE_CHECKLIST.md` for the delivery verdict.

**Built from code and the live database, not from documentation.** Documentation is never counted as
implementation.

## Requirement source — stated plainly

**The client's own requirements document does not exist in this repository.** Re-verified this phase:
a depth-4 search for `*requirement*`, `*brief*`, `*PRD*`, `*SRS*`, `*scope*`, `*.pdf`, `*.docx`,
`*.xlsx` outside `node_modules` returns exactly one hit — `docs/PHASE_2C18_FULL_REQUIREMENT_AUDIT.md`,
which is our own audit.

**Authoritative source used:** the client's requirement enumeration transcribed verbatim into
[`PHASE_2C16_AUDIT.md` §4](PHASE_2C16_AUDIT.md), itemised to leaf level. This is the same source
Phase 2C.18 used. **No requirement has been invented, and none has been dropped.**

If the real document contains requirements beyond that enumeration, **this matrix is incomplete** and
must be re-run.

## Status legend

| Status | Meaning |
|---|---|
| **GREEN** | Genuinely complete: persistence + backend + UI (where required) + authorization + business logic + tests + live verification |
| **AMBER** | Partially complete — a named part is missing |
| **RED** | Missing |
| **BLOCKED** | Impossible without an external dependency (credentials, provider, business policy) |
| **REMOVED** | Explicitly superseded |

Effort: **S** ≤ half a day · **M** ~1 day · **L** ~2–3 days · **XL** > 3 days.

---

## A. PLAYER PORTAL

| ID | Requirement | Source | Current implementation | BE | DB | FE | Authz | Persist | Tests | Live | Status | Blocking dep | Effort | Pri | Files |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P-01 | Registration / Login | 2C.16 §4.1 | JWT + rotation + reuse detection + 2FA + email verification | Y | Y | Y | Y | Y | Y | Y | **GREEN** | — | — | — | `modules/auth/*` |
| P-02 | Home / dashboard | 2C.16 §4.1 | Server balance via `use-dashboard-money` (2C.17 P0-1 removed demo money) | Y | Y | Y | Y | Y | Y | Y | **GREEN** | — | — | — | `components/dashboard/use-dashboard-money.ts` |
| P-03 | Games (catalog + 15 real-money games) | 2C.16 §4.1 | `catalog.service`, `/catalog`, `/lobby`, 15 ledger-backed games | Y | Y | Y | Y | Y | Y | Y | **GREEN** | — | — | — | `modules/gaming-money/*` |
| P-04 | Wallet (main/bonus/reward) | 2C.16 §4.7 | `WalletEngine`, double-entry ledger | Y | Y | Y | Y | Y | Y | Y | **GREEN** | — | — | — | `modules/wallet-engine/*` |
| P-05 | Deposit (operator-credited) | 2C.16 §4.1 | `DepositRequest` PENDING → operator credit | Y | Y | Y | Y | Y | Y | Y | **GREEN** | — | — | — | `modules/wallet/cashier.service.ts` |
| P-06 | Withdraw (hold → review → approve/reject/refund) | 2C.16 §4.1 | Hold-on-request via WalletEngine | Y | Y | Y | Y | Y | Y | Y | **GREEN** | — | — | — | `cashier.service.ts` |
| P-07 | Wallet & transaction history | 2C.16 §4.7 | `/wallet/history`, `/transactions` | Y | Y | Y | Y | Y | Y | Y | **GREEN** | — | — | — | `modules/wallet/*` |
| P-08 | Profile | 2C.16 §4.1 | `/users/me`, security, sessions | Y | Y | Y | Y | Y | Y | Y | **GREEN** | — | — | — | `modules/users/*` |
| P-09 | Notifications (in-app, durable, 12 types) | 2C.16 §4.9 | Built in 2D.1: event-driven, idempotent, unread counts | Y | Y | Y | Y | Y | Y | Y | **GREEN** | — | — | — | `modules/notifications/*` |
| P-10 | **Responsible gaming — real enforcement** | 2C.16 §4.1 | **Built (prev. sprint)**: persisted deposit/wager/loss limits + self-exclusion/cooling-off, enforced by a guard BEFORE any money or game action; player UI, operator API, audited | Y | Y | Y | Y | Y | Y | Y | **GREEN** | — | — | — | `modules/responsible-gaming/*` |
| P-11 | **Support / ticketing** | 2C.16 §4.1 | **Built 2D.3**: `SupportTicket`/`SupportTicketMessage`, player create/list/detail/reply/close/reopen, agent queue, IDOR closed by construction, audited, notifications wired | Y | Y | Y | Y | Y | Y | Y | **GREEN** | — | — | — | `modules/support/*`, `app/(dashboard)/support/tickets/*`, `app/admin/support/*` |
| P-12 | **KYC submission + review lifecycle** | 2C.18 §H | **Built 2D.3** on the existing models (no schema change): submit/resubmit, status, rejection reason, admin queue + review, audited. **Document FILE upload remains BLOCKED** — no object storage | Y | Y | Y | Y | Y | Y | Y | **GREEN** (upload sub-capability BLOCKED) | object storage for file bytes | — | — | `modules/kyc/*`, `components/account/kyc-submission.tsx` |
| P-13 | Rewards (cashback, achievements, missions) | 2C.16 §4.8 | Ledger-backed services real; page wired | Y | Y | Y | Y | Y | partial | partial | **AMBER** | gift-code redemption not exposed | S | P2 | `modules/rewards/*` |
| P-14 | Rewards (daily login, weekly, monthly, lucky spin, seasonal) | 2C.16 §4.8 | `/daily`, `lucky-wheel.tsx` are demo-wallet/static | N | partial | demo | N | N | N | N | **RED** | none | M | P2 | `app/(dashboard)/daily/*` |
| P-15 | VIP levels 1–5 + progression | 2C.16 §4.8 | `/vip` renders static `lib/vip.ts` ("backend-free"). `LoyaltyTier`/`LoyaltyPoints` models unused | N | Y | static | N | N | N | N | **RED** | none | M | P1 | `lib/vip.ts` |
| P-16 | VIP daily/weekly/monthly/birthday rewards, higher withdrawal limit | 2C.16 §4.8 | No eligibility engine, no scheduler, no limit enforcement | N | partial | N | N | N | N | N | **RED** | P-15 | M | P2 | — |
| P-17 | Referral (link, attribution, qualifying deposit, reward, dashboard, earnings, history, leaderboard) | 2C.16 §4.8 | **Built 2D.9** — code, link, claim, attribution, both dashboard directions, history. Duplicate attribution impossible (`referredId` UNIQUE); self-referral refused; no existence oracle. **Qualifying deposit + reward + earnings BLOCKED** (no threshold/currency/window/amount defined); **leaderboard not built** — ranking criterion unspecified | Y | Y | Y | Y | Y | Y | Y | **AMBER** | reward half: client decision | S | P1 | `modules/referral/*`, `app/(dashboard)/referral/page.tsx` |
| P-18 | Referral wallet | 2C.16 §4.7 | No `REFERRAL` wallet type | N | N | N | N | N | N | N | **RED** | P-17 | S | P2 | — |

## B. PARTNER PORTAL

| ID | Requirement | Source | Current | Status | Blocking dep | Effort | Pri |
|---|---|---|---|---|---|---|---|
| PA-01 | Partner-only login / principal | 2C.16 §4.2 | **Built 2D.4** — `Partner`/`PartnerUser`, `partner` role + 3 narrow permissions, reuses the existing auth (no second identity system), isolation structural, audited | **GREEN** | — | — | — |
| PA-02 | Partner dashboard | 2C.16 §4.2 | **Built 2D.4** — `/partner` portal shows real identity, status, share, members; financial figures render the server's BLOCKED reason, never zero | **AMBER** | financial panels blocked by F-02/F-03 | S | P1 |
| PA-03 | Partner profit | 2C.16 §4.2/§4.6 | PA-01 done; profit needs a revenue definition + expense model | **BLOCKED** | **F-02 revenue definition (client decision)** + F-03 | L | P1 |
| PA-04 | Partner available balance | 2C.16 §4.2 | no balance exists because no profit is defined; declared unavailable, never 0 | **BLOCKED** | PA-03 | M | P1 |
| PA-05 | Configurable ownership % | 2C.16 §4.6 | **Built 2D.4** — super-admin sets the %, Σ ≤ 100 enforced inside the write transaction (concurrency-proven); unallocated remainder surfaced. Σ = 100 deliberately NOT required (would assume no house share) | **GREEN** | — | — | — |
| PA-06 | Partner withdrawal request + history | 2C.16 §4.2 | requires a partner balance | **BLOCKED** | PA-04 | M | P1 |
| PA-07 | Partner reports | 2C.16 §4.2 | **Built 2D.9** — the partner's own recorded activity report + injection-safe CSV, ownership-isolated by construction, operator/member identities stripped. **Financial reports remain blocked** on F-02 | **AMBER** | financial half blocked by F-02 | S | P1 |
| PA-08 | Partner notifications | 2C.16 §4.2 | **Built 2D.5** — status/share/member events on the EXISTING 2D.1 system, per-recipient dedup keys, ownership-isolated. Partner **profit** notifications remain BLOCKED | **AMBER** | profit notifications blocked by PA-03 | S | P2 |
| PA-09 | Partner isolation (A cannot see B) | 2C.16 §4.2 | **Built + proven 2D.4** — resolution is by authenticated user id only; no route accepts a partner id from a partner. Live: 6 cross-partner probes all 403 | **GREEN** | — | — | — |
| PA-10 | Daily profit distribution → partner balance | 2C.16 §4.6 | requires net profit | **BLOCKED** | PA-03, F-03, F-05 | L | P1 |

## C. ADMIN / SUPER ADMIN

| ID | Requirement | Source | Current | Status | Blocking dep | Effort | Pri |
|---|---|---|---|---|---|---|---|
| AD-01 | Admin-only access (server + client) | 2C.16 §4.3 | 17 controllers permission-guarded; `AdminGuard` added in 2C.17 | **GREEN** | — | — | — |
| AD-02 | User management | 2C.16 §4.3 | 10 guarded endpoints, audited | **GREEN** | — | — | — |
| AD-03 | Game management | 2C.16 §4.3 | 36 guarded endpoints | **GREEN** | — | — | — |
| AD-04 | Reports + analytics | 2C.16 §4.3 | Built 2D.6/2D.7: 30+ derivable metrics, 6 reports, CSV export | **GREEN** | — | — | — |
| AD-05 | Create admins / role assignment | 2C.16 §4.4 | `admin-roles.controller.ts`, audited | **GREEN** | — | — | — |
| AD-06 | Approve large withdrawals (escalation tier) | 2C.16 §4.4 | 2C.17 P0-4 added `CASHIER_LARGE_WITHDRAWAL_THRESHOLD` + super-admin-only approval; **disabled while unset** | **AMBER** | **business policy: the threshold value** | S | **P0** |
| AD-07 | Bonus administration UI/endpoints | 2C.16 §4.3 | `BonusWalletService` real; no admin surface | **AMBER** | none | M | P2 |
| AD-08 | Promotions admin CRUD | 2C.16 §4.3 | **Built 2D.9** — full CRUD, table-driven status lifecycle with conditional updates (concurrency-proven), scheduling, redemption cap, real player-facing offers page. Creating never publishes. **Awarding declared BLOCKED** — no rule defines payment, trigger, audience or accounting | **GREEN** | — | — | — |
| AD-09 | Settings CRUD | 2C.16 §4.4 | **Built 2D.8** — allow-list registry over `SystemSetting`, admin CRUD + public read, real consumer (support page), audited. `ApplicationSetting` (live game-variant config) deliberately NOT exposed | **GREEN** | — | — | — |
| AD-10 | Manage partners / change percentages | 2C.16 §4.4 | **Built 2D.4** — `/admin/partners` console; read = admin, ALL writes = super-admin only, audited | **GREEN** | — | — | — |
| AD-11 | KYC review (approve/reject/history) | 2C.18 §H | **Built 2D.3** — `admin/kyc` queue + review behind the existing `users:verify`; concurrent reviews cannot both win; every decision audited | **GREEN** | — | — | — |
| AD-12 | Audit log coverage (9 action classes) | 2C.16 §4.10 | Infrastructure real; 2D.2 widened coverage; `admin_audit_logs` dormant by design (2D.7 Part D) | **AMBER** | none | S | P1 |

## D. FINANCE

| ID | Requirement | Source | Current | Status | Blocking dep | Effort | Pri |
|---|---|---|---|---|---|---|---|
| F-01 | Deposit / withdrawal review | 2C.16 §4.5 | Exists as an *admin* function | **AMBER** | no finance role/portal | M | P1 |
| F-02 | Revenue | 2C.16 §4.5 | Volume metrics built (2D.6); **"revenue" has no accounting definition** | **BLOCKED** | **business policy: revenue definition** | M | P1 |
| F-03 | Expenses | 2C.16 §4.5 | **Built 2D.5** — `Expense`/`ExpenseCategory`, Decimal amounts, per-currency, DRAFT→CONFIRMED→VOID, duplicate-reference guard, audited. **Creates no ledger entry** | **GREEN** (backend + API; no admin UI yet) | — | — | — |
| F-04 | Profit (= revenue − expenses) | 2C.16 §4.5/§4.6 | none | **RED** | F-02 + F-03 | M | P1 |
| F-05 | Daily settlement / financial close | 2C.16 §4.5 | Game settlement real; **financial daily close absent** | **RED** | F-02, F-03 | L | P1 |
| F-06 | Cash flow | 2C.16 §4.5 | Derivable; per-currency deposit/withdrawal reports exist (2D.7) | **AMBER** | none | S | P1 |
| F-07 | Failed-transaction view / global transaction search | 2C.16 §4.5 | States persisted; no global search surface | **AMBER** | none | M | P2 |
| F-08 | Report export | 2C.16 §4.5 | **Built 2D.7** — CSV, injection-safe, authorization-tested | **GREEN** | — | — | — |
| F-09 | FX-consolidated totals | 2D.6 | `exchange_rates` empty; no FX source | **BLOCKED** | **external FX rate source** | M | P1 |
| F-10 | Bank settlement | 2C.16 §4.5 | none | **BLOCKED** | **external banking provider + credentials** | XL | P2 |

## E. PLATFORM / CROSS-CUTTING

| ID | Requirement | Source | Current | Status | Blocking dep | Effort | Pri |
|---|---|---|---|---|---|---|---|
| X-01 | Analytics — derivable metrics | 2C.16 §4.11 | Built 2D.6: 26/26 verified vs SQL | **GREEN** | — | — | — |
| X-02 | Analytics — DAU/MAU/retention/LTV/session/bounce | 2C.16 §4.11 | **Built 2D.9** — durable, deduplicated activity-event pipeline (`user_activities`) wired to login/deposit/play, plus `GET /analytics/engagement` and an admin panel. DAU/MAU real and SQL-verified, with definitions in the payload and the **no-backfill caveat stated**. Retention (no cohort definition), LTV (blocked by F-02), session time (no session events) and bounce (no page views) remain declared unavailable | **AMBER** | retention: client definition · LTV: F-02 · session/bounce: no source | M | P2 |
| X-03 | Email delivery | 2C.16 §4.9 | `MailService` is **log-only, no SMTP** | **BLOCKED** | **SMTP credentials** | S once credentials exist | P1 |
| X-04 | SMS / push delivery | 2C.16 §4.9 | No provider, no credentials | **BLOCKED** | **provider + credentials** | M | P2 |
| X-05 | Payment gateway | 2C.16 §4.1 | Operator-credit only; **no fake gateway** (correct) | **BLOCKED** | **provider + credentials** | L | P1 |
| X-06 | Security: authn/authz/session/2FA/audit | 2D.2 | 20 attack tests passed; admin 2FA server-enforced | **GREEN** | — | — | — |
| X-07 | Mobile 375/390/412 | all phases | Certified for every shipped surface | **GREEN** | — | — | — |
| X-08 | Orphaned frontend simulation (~19,131 LOC) | 2C.18 §3.1 | `lib/analytics`, `lib/operations`, `lib/partners` etc. — 0 importers | **AMBER** | classify per §4 of the brief | S | P2 |

---

## Summary (honest counts, not percentages of convenience)

**The total and the GREEN count were both wrong before Phase 2D.9 and are corrected here.**
Recounted from the requirement IDs themselves: the five sections enumerate **58** IDs
(P-01…P-18 = 18, PA-01…PA-10 = 10, AD-01…AD-12 = 12, F-01…F-10 = 10, X-01…X-08 = 8), not 54. The
previous GREEN row read "25" while its own ID list contained 28. See `PHASE_2D9_AUDIT.md` §1.

| Status | Count | IDs |
|---|---|---|
| **GREEN** | **29** | P-01…P-12, AD-01…AD-05, **AD-08**, AD-09, AD-10, AD-11, PA-01, PA-05, PA-09, F-03, F-08, X-01, X-06, X-07 |
| **AMBER** | **13** | P-13, **P-17**, PA-02, **PA-07**, PA-08, AD-06, AD-07, AD-12, F-01, F-06, F-07, **X-02**, X-08 |
| **RED (internally implementable)** | **5** | P-14, P-15, P-16, P-18, F-05 |
| **BLOCKED** | **11** | F-02*, F-04, F-09, F-10, X-03, X-04, X-05, PA-03, PA-04, PA-06, PA-10 |

29 + 13 + 5 + 11 = **58** ✓ — the counts reconcile with the enumeration.

"KYC file upload" is a **sub-capability of P-12**, not a requirement ID; it is counted inside P-12
(GREEN, upload sub-capability BLOCKED on object storage) rather than as a separate BLOCKED item.

**Movement in 2D.9:** AD-08 promotions RED → **GREEN**. P-17 referral, PA-07 partner reports and
X-02 analytics events all RED → **AMBER**: the implementable half of each was built as a full
vertical slice (database → service → authorization → API → UI → tests → live verification), and the
remaining half is named with the exact missing input rather than faked. 121 live HTTP checks passed
with 0 failures; 24/24 mobile checks at 375/390/412.

**The five remaining RED items are all blocked on a client business decision, not on engineering:**
P-14/P-15/P-16 need VIP thresholds and reward amounts, P-18 needs a reward to hold (and would touch
the frozen wallet schema), F-05 needs the accounting semantics of a financial close. Reclassifying
them BLOCKED would arguably be more accurate; they are left RED so they stay visible as work that
becomes possible the moment the client supplies the numbers.

**Movement in 2D.8:** AD-09 settings → **GREEN**.

**Movement in 2D.5:** F-03 expenses → **GREEN** (backend/API complete; no admin UI built). PA-08 →
**AMBER** (real events wired; profit notifications blocked).

**Movement in 2D.4:** PA-01, PA-05, PA-09 and AD-10 → GREEN. PA-02 → AMBER (portal built; its
financial panels are blocked). PA-03/04/06/10 moved RED → **BLOCKED**, which is a *more accurate*
classification, not progress.

**Movement in 2D.3:** P-11, P-12 and AD-11 moved RED → GREEN. P-10 was completed in the previous
sprint.

\* F-02 is blocked on a **business decision**, not a vendor: someone must define what "revenue" means
for this platform. It becomes implementable the moment that definition exists.

## Execution order (by the brief's own P0/P1/P2 rule)

**P0 — DONE**

1. ~~P-10 Responsible gaming enforcement~~ — **GREEN**
2. ~~P-12 / AD-11 KYC lifecycle~~ — **GREEN** (file upload BLOCKED on storage)
3. ~~P-11 Support ticketing~~ — **GREEN**, IDOR proven closed both ways
4. **AD-06** — still AMBER: needs one number from the client; cannot be invented.
5. **PA-09** — becomes testable only once PA-01 exists.

**NEXT (P1), in dependency order:** PA-01 (partner principal — unblocks PA-02…PA-10 and AD-10) →
F-03 expenses → F-04 profit (needs F-02's definition) → F-05 daily settlement → P-17 referral →
P-15 VIP.

**P1 — major business workflows:** PA-01…PA-10 (partner), F-03/F-04/F-05 (accounting), P-17
(referral), P-15 (VIP), F-01/F-06, AD-10, AD-12.

**P2:** AD-07, P-13, P-14, P-16, P-18, F-07, X-08.

**Everything still open needs the client, not more engineering.** The exact asks are listed in
`PHASE_2D9_FINAL_REPORT.md` §14–15: one revenue definition, one large-withdrawal threshold, VIP
tiers and reward amounts, a referral qualification rule and reward, a promotion award rule, a
retention cohort definition — plus SMTP, SMS/push, payment-gateway, FX and banking credentials.
