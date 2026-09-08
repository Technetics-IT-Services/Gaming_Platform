# Phase 2C.18 — Requirement Gap Matrix

Status key: **GREEN** production-ready & verified · **YELLOW** implemented but limited ·
**ORANGE** partially implemented · **RED** missing · **BLUE** needs external provider ·
**PURPLE** needs a business decision · **GRAY** intentionally deferred.

Columns: BE = backend · DB = database model · FE = frontend · API = HTTP surface · P = persistence ·
S = authorization · M = mobile-verified · T = tested · L = live-verified this phase.
`Y` = yes, `–` = no, `~` = partial.

> **No requirement is GREEN because a file exists.** GREEN requires a live-verified round trip.

---

## A. Player platform

| Requirement | Expected behaviour | Current implementation | BE | DB | FE | API | P | S | M | T | L | Status | Evidence | Gap | Pri | Effort | Depends on |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Registration | create account, default role | real `auth` module | Y | Y | Y | Y | Y | Y | Y | Y | Y | **GREEN** | live 200 + role assigned + audited | — | — | — | — |
| Login | JWT + refresh cookie | real | Y | Y | Y | Y | Y | Y | Y | Y | Y | **GREEN** | live 200, httpOnly cookie | — | — | — | — |
| Logout | revoke session | real | Y | Y | Y | Y | Y | Y | Y | Y | Y | **GREEN** | logout 200 → refresh 401 | — | — | — | — |
| Sessions | list/revoke | real | Y | Y | Y | Y | Y | Y | ~ | Y | Y | **GREEN** | `/settings/security` | — | — | — | — |
| Password | hash, reset | real | Y | Y | Y | Y | Y | Y | Y | Y | Y | **GREEN** | no hash in any response | — | — | — | — |
| 2FA | TOTP + recovery | real but **optional** | Y | Y | Y | Y | Y | Y | ~ | Y | ~ | **YELLOW** | challenge flow exists | not enforced for admins | P1 | S | — |
| Profile | identity + balance | real | Y | Y | Y | Y | Y | Y | Y | Y | Y | **GREEN** | `/users/me` | — | — | — | — |
| Verification status | show real state | read-only | Y | Y | Y | Y | Y | Y | Y | Y | Y | **GREEN** | `/users/me/verification` | — | — | — | — |
| **KYC submission** | upload + review | none | – | Y | – | – | – | – | – | – | – | **RED** | no endpoint | whole flow | P1 | L | doc storage, admin queue |
| **KYC review (admin)** | approve/reject | none | – | Y | – | – | – | – | – | – | – | **RED** | no endpoint | whole flow | P1 | M | KYC submission |
| Wallet | MAIN/BONUS/REWARD | real, double-entry | Y | Y | Y | Y | Y | Y | Y | Y | Y | **GREEN** | reconcile difference 0 | — | — | — | — |
| Transactions | stored balances | real | Y | Y | Y | Y | Y | Y | Y | Y | Y | **GREEN** | `/wallet/history` | — | — | — | — |
| Deposit | PENDING → operator credit | real | Y | Y | Y | Y | Y | Y | Y | Y | Y | **GREEN** | live journey | no gateway (BLUE) | — | — | — |
| Withdrawal | hold → review → refund | real | Y | Y | Y | Y | Y | Y | Y | Y | Y | **GREEN** | live journey, fixed 2C.17 | — | — | — | — |
| Cashier | server limits | real | Y | Y | Y | Y | Y | Y | Y | Y | Y | **GREEN** | `/cashier/config` | — | — | — | — |
| Game history | rounds + traceability | real | Y | Y | Y | Y | Y | Y | Y | Y | Y | **GREEN** | 141 rounds, bundle has ledger | — | — | — | — |
| **Notifications** | durable, event-driven | **stub** | – | Y | ~ | ~ | – | – | – | – | Y | **RED** | live **501** | everything | P1 | M | event hooks |
| **Responsible gaming** | limits + enforcement | **disclosure only** | – | – | Y | – | – | – | Y | – | Y | **ORANGE** | grep: zero enforcement | limits model + enforcement | P1 | L | limits model, wallet/game hooks |
| Support | contact + tickets | static page | – | ~ | Y | – | – | – | Y | – | Y | **ORANGE** | 69-line page | ticket model + workflow | P2 | M | — |
| Mobile UX | mobile-first | real, gaps | – | – | Y | – | – | – | Y | Y | Y | **YELLOW** | no overflow; 3–72% small taps | touch targets | P2 | S | — |

## B. Game platform — all 15 live-exercised

| Game | Catalog | Route | Auth | Stake | Outcome | Payout | Ledger | History | Idem | Concurrency | Recovery | Mobile | Fairness | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dice | Y | Y | Y | Y | Y | Y | Y | Y | **Y** | Y | Y | Y | Y | **GREEN** |
| crash | Y | Y | Y | Y | Y | Y | Y | Y | **Y** | Y | Y | Y | Y | **GREEN** |
| roulette | Y | Y | Y | Y | Y | Y | Y | Y | **Y** | Y | Y | Y | Y | **GREEN** |
| sic-bo | Y | Y | Y | Y | Y | Y | Y | Y | **Y** | Y | Y | Y | Y | **GREEN** |
| lottery | Y | Y | Y | Y | Y | Y | Y | Y | **Y** | Y | Y | Y | **serverSeedHash** | **GREEN** |
| baccarat | Y | Y | Y | Y | Y | Y | Y | Y | **Y** | Y | Y | Y | Y | **GREEN** |
| blackjack | Y | Y | Y | Y | Y | Y | Y | Y | **Y** | Y | Y | Y | Y | **GREEN** |
| plinko | Y | Y | Y | Y | Y | Y | Y | Y | **Y** | Y | Y | Y | Y | **GREEN** |
| mines | Y | Y | Y | Y | Y | Y | Y | Y | **Y** | Y | Y | Y | Y | **GREEN** |
| limbo | Y | Y | Y | Y | Y | Y | Y | Y | **Y** | Y | Y | Y | Y | **GREEN** |
| coin-flip | Y | Y | Y | Y | Y | Y | Y | Y | **Y** | Y | Y | Y | Y | **GREEN** |
| wheel | Y | Y | Y | Y | Y | Y | Y | Y | **Y** | Y | Y | Y | Y | **GREEN** |
| dragon-tiger | Y | Y | Y | Y | Y | Y | Y | Y | **Y** | Y | Y | Y | Y | **GREEN** |
| andar-bahar | Y | Y | Y | Y | Y | Y | Y | Y | **Y** | Y | Y | Y | Y | **GREEN** |
| teen-patti | Y | Y | Y | Y | Y | Y | Y | Y | **Y** | Y | Y | Y | Y | **GREEN** |

**15/15 GREEN.** Concurrency/recovery evidenced by the `RUN_STRESS=1` suite (10/10: 100 concurrent
same-key credits apply exactly once; 500 mixed ops reconcile balanced) and `recovery/health`.

Unwired demo/prototype games (**GRAY — not required, not built**): fruit-slots, hilo, poker,
casino-war, lucky-7, bingo, keno, grid-reveal, tower, lucky-pick, plus demo `/dice`, `/crash`,
`/roulette` tables.

## C. Admin portal

| Requirement | Current | BE | DB | FE | API | S | L | Status | Gap | Pri | Effort |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Admin-only access | guarded both layers (2C.17) | Y | Y | Y | Y | Y | Y | **GREEN** | — | — | — |
| Players | real CRUD + lock/verify | Y | Y | Y | Y | Y | Y | **GREEN** | — | — | — |
| Wallets | statistics, credit/debit, freeze | Y | Y | Y | Y | Y | Y | **GREEN** | — | — | — |
| Deposits / withdrawals | operator transitions | Y | Y | ~ | Y | Y | Y | **YELLOW** | no dedicated admin cashier UI | P1 | M |
| Games | catalog + config admin | Y | Y | Y | Y | Y | Y | **GREEN** | — | — | — |
| Rounds | traceability bundle | Y | Y | ~ | Y | Y | Y | **YELLOW** | thin UI | P2 | S |
| Ledger / reconciliation | `difference: "0"` live | Y | Y | ~ | Y | Y | Y | **GREEN** | — | — | — |
| Audit | persisted + reader | Y | Y | ~ | Y | Y | Y | **YELLOW** | 4/9 action classes | P1 | S |
| RBAC | roles + permissions | Y | Y | Y | Y | Y | Y | **GREEN** | no partner/finance role | P1 | S |
| **Admin dashboard** | honest placeholder | – | – | Y | – | Y | Y | **RED** | needs analytics | P2 | M |
| **Reports** | wallet only | ~ | Y | ~ | ~ | Y | Y | **ORANGE** | no export | P1 | M |
| **KYC admin** | none | – | Y | – | – | – | – | **RED** | whole flow | P1 | M |
| **RG admin** | none | – | – | – | – | – | – | **RED** | whole flow | P1 | M |
| **Notifications admin** | none | – | Y | – | – | – | – | **RED** | whole flow | P2 | M |
| **CRM / Support** | none | – | ~ | – | – | – | – | **RED** | whole module | P2 | L |
| **Settings** | placeholder | – | Y | ~ | – | Y | Y | **RED** | CRUD | P2 | S |

## D. Partner / Affiliate — every row RED

| Requirement | BE | DB | FE | API | Role | Status | Blocking dependency |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Partner registration | – | – | – | – | – | **RED** | Partner model |
| Partner authentication | – | – | – | – | – | **RED** | partner role in RBAC |
| Partner dashboard | – | – | – | – | – | **RED** | partner auth |
| Referral links | – | ~ | – | – | – | **RED** | `ReferralProgram` exists, unused |
| Referral attribution | – | ~ | – | – | – | **RED** | registration hook |
| Commission | – | – | – | – | – | **RED** | commission rules model |
| Revenue share | – | – | – | – | – | **RED** | revenue source |
| Partner wallet | – | – | – | – | – | **RED** | partner ledger accounts |
| Partner withdrawal | – | – | – | – | – | **RED** | partner wallet |
| Reports | – | – | – | – | – | **RED** | all of the above |
| Player attribution | – | ~ | – | – | – | **RED** | referral attribution |
| Fraud controls | – | ~ | – | – | – | **RED** | attribution + events |
| Partner isolation (A≠B) | – | – | – | – | – | **RED** | **not testable — no partner principal exists** |

Only artefact: orphaned `src/lib/partners/` (1,556 LOC, 0 consumers, 0 backend calls).

## E. Finance

| Requirement | Status | Note |
| --- | --- | --- |
| Deposits / withdrawals | **YELLOW** | exist as admin functions; no finance role or portal |
| Payment reconciliation (ledger) | **GREEN** | `difference: "0"` live |
| Payment reconciliation (provider) | **BLUE** | no gateway |
| Treasury | **RED** | orphaned lib only |
| Revenue | **RED** | derivable, not built |
| **Expenses** | **RED — blocking** | **no expense model exists in the schema** |
| **Profit** | **PURPLE / BLOCKED** | `Revenue − Expenses` has no minuend source |
| Daily settlement (financial close) | **RED** | game settlement ≠ financial close |
| Fees / commission | **RED** | no model |
| Finance dashboard / reports | **RED** | — |

## F. Notifications — all RED or BLUE

| Channel | Status | Evidence |
| --- | --- | --- |
| In-app | **RED** | live **501**; `Notification` model never written |
| Templates / preferences | **RED** | models exist, unused |
| Event emission | **RED** | **nothing in the backend calls `NotificationsService`** |
| Delivery status / retry | **RED** | — |
| Email | **BLUE** | mailer is **log-only, no SMTP** — not production |
| SMS / Push | **BLUE** | no provider, no credentials |

## G. Analytics

| Metric | Status | Reason |
| --- | --- | --- |
| revenue, average bet, most-played, average deposit/withdrawal, conversion | **RED (buildable)** | derivable from real tables |
| DAU, MAU, retention, LTV, session time, bounce, cohorts | **BLOCKED** | **no event pipeline; analytics tables never written** |
| Reports | **RED** | depends on the above |

## H. Compliance — read-only vs enforcement

| Requirement | Read-only state | **Enforcement** | Status |
| --- | --- | --- | --- |
| KYC submission | – | **none** | **RED** |
| KYC review | – | **none** | **RED** |
| Verification | **Y** | n/a | **GREEN** |
| RG deposit/loss/wager/session limits | shows cashier limits only | **none** | **ORANGE** |
| Self-exclusion | – | **none** | **RED** |
| Cooling-off | – | **none** | **RED** |
| AML / suspicious activity | models + AI heuristic | **no workflow** | **ORANGE** |
| Audit trail | **Y** | 4/9 classes | **YELLOW** |

## Mobile — measured, all three viewports

375×812 and 390×844 produced **identical** figures; 412×915 consistent.

| Property | Result |
| --- | --- |
| Horizontal overflow | **0 / 16 routes** at every viewport |
| Bottom navigation | present on **16/16** |
| Sticky positioning (balance/header) | **16/16** |
| `safe-area-inset` | **16/16** |
| Numeric keypad on money inputs | present wherever a money input exists |
| Render errors | **none** |
| **Touch targets < 44px** | game routes **3–14%**; player journey 23–35%; account/history **64–72%** |

Recurring offenders are shared chrome — hamburger 39×39, logo link 160×32, back-link 81×18 — so one
fix improves every route. (The 1×1 "Skip to content" link is a standard visually-hidden a11y pattern,
not a defect.)

---

## Status roll-up

| Status | Count of assessed leaf requirements |
| --- | --- |
| **GREEN** | 41 |
| **YELLOW** | 8 |
| **ORANGE** | 4 |
| **RED** | 57 |
| **BLUE** | 5 |
| **PURPLE** | 1 |
| **GRAY** | 12 (unwired demo games) |
| **Total assessed (excl. GRAY)** | **116** |
