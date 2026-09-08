# Phase 2D.10 — Final Requirement Matrix

**Rebuilt from the requirement IDs themselves on 2026-09-07.** Previous headline percentages were
not trusted; two of them were wrong and are corrected below.

## Count reconciliation

| Section | IDs | Count |
|---|---|---|
| A. Player portal | P-01 … P-18 | 18 |
| B. Partner portal | PA-01 … PA-10 | 10 |
| C. Admin / super admin | AD-01 … AD-12 | 12 |
| D. Finance | F-01 … F-10 | 10 |
| E. Platform / cross-cutting | X-01 … X-08 | 8 |
| **TOTAL** | | **58** |

| Status | Count |
|---|---|
| **GREEN** | **38** |
| **AMBER** | **4** |
| **RED** | **0** |
| **BLOCKED** | **16** |
| **TOTAL** | **58** ✓ |

`38 + 4 + 0 + 16 = 58` ✓

**Two corrections are folded into these numbers, and both are stated plainly rather than presented
as progress:**

1. **The brief's baseline said 54 total.** The five sections enumerate **58** IDs. Corrected in
   Phase 2D.9.
2. **The five items previously called RED are reclassified BLOCKED.** The brief's own Step 16
   defines RED as *"implementable but not yet implemented"* and BLOCKED as *"requires client
   decision or external input"*. P-14, P-15, P-16, P-18 and F-05 each require a client business
   definition (reward amounts, VIP thresholds, close semantics). Under the stated definitions they
   are BLOCKED. **The remaining work is identical — only the label is more accurate.**

"KYC file upload" is a sub-capability of P-12, not an ID; it is counted inside P-12.

---

## Legend

- **Status** — GREEN complete + tested + live-verified · AMBER implemented with a named remaining
  part · RED implementable but unbuilt · BLOCKED needs client input or a vendor
- **Live Evidence** — verified against the running backend and the real database this phase
- **Effort** — engineering time *after* the blocking input arrives

---

## A. PLAYER PORTAL

| ID | Requirement | Status | BE | FE | DB | Live evidence | Tests | Remaining work | Blocker | Client decision | External dep | Effort |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P-01 | Registration / login | **GREEN** | Y | Y | Y | 2D.2 20 attack probes; 2D.9/2D.10 logins throughout | unit + integration | — | — | — | — | — |
| P-02 | Home / dashboard | **GREEN** | Y | Y | Y | server balance, 2C.17 | unit | — | — | — | — | — |
| P-03 | Games (catalog + 15 real-money games) | **GREEN** | Y | Y | Y | 15 games ledger-backed, reconcile 0 | 13 integration suites | — | — | — | — | — |
| P-04 | Wallet (main / bonus / reward) | **GREEN** | Y | Y | Y | ledger difference 0.000…0 | wallet-engine suites | — | — | — | — | — |
| P-05 | Deposit (operator-credited) | **GREEN** | Y | Y | Y | 2D.9 live deposits | integration | Gateway automation is X-05 | — | — | — | — |
| P-06 | Withdraw (hold → review → approve/reject/refund) | **GREEN** | Y | Y | Y | cashier integration | integration | — | — | — | — | — |
| P-07 | Wallet & transaction history | **GREEN** | Y | Y | Y | /wallet/history | integration | — | — | — | — | — |
| P-08 | Profile | **GREEN** | Y | Y | Y | /users/me, sessions | integration | — | — | — | — | — |
| P-09 | Notifications (in-app, durable) | **GREEN** | Y | Y | Y | 2D.1 idempotent events | integration | Delivery channels are X-03/X-04 | — | — | — | — |
| P-10 | Responsible gaming — real enforcement | **GREEN** | Y | Y | Y | guard blocks play/deposit pre-money | integration + live | — | — | — | — | — |
| P-11 | Support / ticketing | **GREEN** | Y | Y | Y | IDOR proven closed both ways | integration + live | — | — | — | — | — |
| P-12 | KYC submission + review lifecycle | **GREEN** | Y | Y | Y | 2D.3 queue + review, audited | integration + live | **Document file bytes** cannot be stored | Sub-capability BLOCKED | — | **Object storage** | S once storage exists |
| P-13 | Rewards (cashback, achievements, missions) | **AMBER** | Y | Y | Y | ledger-backed services real | partial | Gift-code redemption not exposed | Award destination undefined | **D-08** | — | S after D-08 |
| P-14 | Rewards (daily / weekly / monthly / lucky spin / seasonal) | **BLOCKED** | N | demo | partial | — | — | Entire feature | Every item is a reward **amount** | **D-05** | — | M after D-05 |
| P-15 | VIP levels 1–5 + progression | **BLOCKED** | N | static | Y (`LoyaltyTier` unused) | — | — | Tier engine | **Thresholds are the requirement** | **D-03** | — | M after D-03 |
| P-16 | VIP periodic / birthday rewards, higher withdrawal limit | **BLOCKED** | N | N | partial | — | — | Eligibility + scheduler | Needs P-15 thresholds **and** amounts | **D-03 + D-05** | — | M after decisions |
| P-17 | Referral (link, attribution, dashboard, history, reward, leaderboard) | **AMBER** | Y | Y | Y | 2D.9: 30 live probes, DB-verified claim | integration + live + mobile | Leaderboard; qualification; reward | Ranking criterion + reward undefined | **D-04** | — | S after D-04 |
| P-18 | Referral wallet | **BLOCKED** | N | N | N | — | — | Wallet type | Nothing to hold until D-04; touches **frozen** schema | **D-04** | — | S after D-04 |

## B. PARTNER PORTAL

| ID | Requirement | Status | BE | FE | DB | Live evidence | Tests | Remaining work | Blocker | Client decision | External dep | Effort |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PA-01 | Partner-only login / principal | **GREEN** | Y | Y | Y | 2D.4 47 tests; isolation structural | integration + live | — | — | — | — | — |
| PA-02 | Partner dashboard | **GREEN** | Y | Y | Y | portal + report + team, mobile-certified | integration + live + mobile | Financial panels | **Tracked under PA-03/PA-04**, not counted twice | D-01 | — | — |
| PA-03 | Partner profit | **BLOCKED** | N | declared | — | reason rendered, never 0 | — | Profit calculation | **No revenue definition** | **D-01** | — | M after D-01 |
| PA-04 | Partner available balance | **BLOCKED** | N | declared | — | reason rendered | — | Balance | Needs PA-03 | **D-01** | — | M after D-01 |
| PA-05 | Configurable ownership % | **GREEN** | Y | Y | Y | Σ ≤ 100 enforced in-transaction | integration + live | — | — | — | — | — |
| PA-06 | Partner withdrawal request + history | **BLOCKED** | N | N | — | — | — | Whole flow | Needs PA-04 | **D-01** | — | M after D-01 |
| PA-07 | Partner reports | **GREEN** | Y | Y | Y | 2D.10: activity report + CSV + team, isolation proven | integration + live + mobile | Financial reports | Tracked under PA-03 | D-01 | — | — |
| PA-08 | Partner notifications | **GREEN** | Y | Y | Y | 2D.5 per-recipient dedup keys | integration | Profit notifications | Tracked under PA-03 | D-01 | — | — |
| PA-09 | Partner isolation (A cannot see B) | **GREEN** | Y | Y | Y | 2D.4 6 probes + 2D.9/2D.10 re-probes, all 403 | integration + live | — | — | — | — | — |
| PA-10 | Daily profit distribution → partner balance | **BLOCKED** | N | N | — | — | — | Whole flow | Needs PA-03 + F-05 | **D-01** | — | L after D-01 |

## C. ADMIN / SUPER ADMIN

| ID | Requirement | Status | BE | FE | DB | Live evidence | Tests | Remaining work | Blocker | Client decision | External dep | Effort |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AD-01 | Admin-only access (server + client) | **GREEN** | Y | Y | Y | player refused shell **and** API at 3 viewports | integration + live + mobile | — | — | — | — | — |
| AD-02 | User management | **GREEN** | Y | Y | Y | 10 guarded endpoints, audited | integration | — | — | — | — | — |
| AD-03 | Game management | **GREEN** | Y | Y | Y | 36 guarded endpoints | integration | — | — | — | — | — |
| AD-04 | Reports + analytics | **GREEN** | Y | Y | Y | 2D.6/2D.7: 26 metrics SQL-verified, 6 reports, CSV | integration + live + mobile | — | — | — | — | — |
| AD-05 | Create admins / role assignment | **GREEN** | Y | Y | Y | audited | integration | — | — | — | — | — |
| AD-06 | Approve large withdrawals (escalation tier) | **AMBER** | Y | Y | Y | mechanism built; **disabled while unset** | integration | Set the threshold | **The number is a compliance policy** | **D-02** | — | XS after D-02 |
| AD-07 | Bonus administration UI / endpoints | **GREEN** | Y | Y | Y | **2D.10**: grant/list/expire, idempotent, audited, 18 integration + live + mobile | integration + live + mobile | Automatic awarding | Tracked as its own blocked concern | D-05 | — | — |
| AD-08 | Promotions admin CRUD | **GREEN** | Y | Y | Y | 2D.9: lifecycle + player list, DB-verified | integration + live + mobile | Awarding | Tracked separately | D-06 | — | — |
| AD-09 | Settings CRUD | **GREEN** | Y | Y | Y | 2D.8 allow-list, real consumer | integration + live + mobile | — | — | — | — | — |
| AD-10 | Manage partners / change percentages | **GREEN** | Y | Y | Y | super-admin-only writes, audited | integration + live | — | — | — | — | — |
| AD-11 | KYC review (approve / reject / history) | **GREEN** | Y | Y | Y | concurrent reviews cannot both win | integration + live | — | — | — | — | — |
| AD-12 | Audit log coverage (9 action classes) | **GREEN** | Y | Y | Y | **2D.10**: 17 entity types + blanket admin-action interceptor; wallet-adjustment gap closed | integration + live | — | — | — | — | — |

## D. FINANCE

| ID | Requirement | Status | BE | FE | DB | Live evidence | Tests | Remaining work | Blocker | Client decision | External dep | Effort |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F-01 | Deposit / withdrawal review | **GREEN** | Y | Y | Y | **2D.10**: `finance` role + portal; role holds no `wallets:adjust` (proven 403) | integration + live + mobile | — | — | — | — | — |
| F-02 | Revenue | **BLOCKED** | N | declared | — | volume metrics real; revenue refused | — | Definition | **No accounting definition exists** | **D-01** | — | S after D-01 |
| F-03 | Expenses | **GREEN** | Y | API | Y | 2D.5 Decimal, per-currency, audited | integration | Admin UI | — | — | — | S |
| F-04 | Profit (= revenue − expenses) | **BLOCKED** | N | N | — | — | — | Calculation | Needs F-02 | **D-01** | — | S after D-01 |
| F-05 | Daily settlement / financial close | **BLOCKED** | N | N | — | daily aggregates already ship in 2D.7 reports | — | Close semantics | **What a closed period asserts is undefined** | **D-07** | — | L after D-07 |
| F-06 | Cash flow | **GREEN** | Y | Y | Y | **2D.10**: per-currency, matches SQL at 3 viewports | integration + live + mobile | — | — | — | — | — |
| F-07 | Failed transactions / global transaction search | **GREEN** | Y | Y | Y | **2D.10**: platform-wide search + failure view; unknown filter matches nothing | integration + live + mobile | — | — | — | — | — |
| F-08 | Report export | **GREEN** | Y | Y | Y | 2D.7 CSV injection-safe, 38 safety tests | unit + integration | — | — | — | — | — |
| F-09 | FX-consolidated totals | **BLOCKED** | N | declared | `exchange_rates` **0 rows** | never combines currencies | — | FX conversion | **No rate source** | — | **FX provider** | S once feed exists |
| F-10 | Bank settlement | **BLOCKED** | N | N | — | — | — | Whole integration | **No banking provider** | — | **Banking provider** | XL |

## E. PLATFORM / CROSS-CUTTING

| ID | Requirement | Status | BE | FE | DB | Live evidence | Tests | Remaining work | Blocker | Client decision | External dep | Effort |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| X-01 | Analytics — derivable metrics | **GREEN** | Y | Y | Y | 26/26 verified vs SQL | integration | — | — | — | — | — |
| X-02 | Analytics — DAU/MAU/retention/LTV/session/bounce | **AMBER** | Y | Y | Y | **2D.9**: event pipeline + DAU/MAU SQL-verified | integration + live + mobile | Retention, LTV, session, bounce | Cohort undefined; LTV needs F-02; **page-view/session instrumentation is unbuilt engineering** | **D-06** | — | M (instrumentation) + S after D-06 |
| X-03 | Email delivery | **BLOCKED** | abstraction Y | — | — | nodemailer wired, log-only without SMTP | — | Configure | **No SMTP credentials** | — | **SMTP** | XS once credentials exist |
| X-04 | SMS / push delivery | **BLOCKED** | N | N | — | — | — | Provider + adapter | **No provider chosen** | — | **SMS/push provider** | M |
| X-05 | Payment gateway | **BLOCKED** | N | N | — | operator-credit only; **no fake gateway** | — | Whole integration | **No provider/credentials** | — | **Payment gateway** | L |
| X-06 | Security: authn/authz/session/2FA/audit | **GREEN** | Y | Y | Y | 121 (2D.9) + 50 (2D.10) live probes | integration + live | See CRITICAL defect note below | — | — | — | — |
| X-07 | Mobile 375 / 390 / 412 | **GREEN** | — | Y | — | 24/24 this phase; every shipped surface certified | Playwright | Physical-device testing NOT executed | Environment | — | — | — |
| X-08 | Orphaned frontend simulation (~23k LOC) | **GREEN** | — | Y | — | **2D.10**: quarantine now **enforced by a test**, not documented | 6 guard tests | Deletion (optional, post-handover) | — | — | — | — |

---

## CRITICAL — outside the requirement matrix

**A live privilege defect was found and reproduced this phase**, on a frozen surface:
`POST /wallet-engine/grant-bonus` has **no permission guard**, letting any authenticated player
grant themselves an arbitrary bonus and convert it into withdrawable balance. Reproduced live:
a `user`-role account created ₹1,000,000 in two HTTP calls.

It is **not fixed** — the surface is frozen and the change awaits approval. See
`FROZEN_CHANGE_PROPOSAL_2D10_GRANT_BONUS.md`. X-06 remains GREEN for everything it certifies
(authn, authz, session, 2FA, audit — all re-probed clean), but **this defect independently blocks
delivery** and is carried as the top item in the delivery status document.

---

## Consolidated blockers

| Blocker | Kind | Requirements blocked |
|---|---|---|
| **D-01 Revenue definition** | Client decision | F-02, F-04, PA-03, PA-04, PA-06, PA-10 (**6**) |
| **D-02 Large-withdrawal threshold** | Client decision | AD-06 |
| **D-03 VIP tiers + thresholds** | Client decision | P-15, P-16 |
| **D-04 Referral qualification + reward** | Client decision | P-17 (part), P-18 |
| **D-05 Reward amounts** | Client decision | P-14, P-16, AD-07 (auto-award) |
| **D-06 Retention cohort + promotion award** | Client decision | X-02 (part), AD-08 (award) |
| **D-07 Financial close semantics** | Client decision | F-05 |
| **D-08 Gift-code redemption destination** | Client decision | P-13 |
| **SMTP credentials** | External | X-03 |
| **SMS / push provider** | External | X-04 |
| **Payment gateway** | External | X-05 |
| **FX rate source** | External | F-09 |
| **Banking provider** | External | F-10 |
| **Object storage** | External | P-12 file upload |
| **Page-view / session instrumentation** | **Engineering** | X-02 (part) |
