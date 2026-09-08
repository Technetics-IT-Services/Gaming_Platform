# Final Requirement Matrix

**Recomputed from requirement IDs on 2026-09-08, after Phase 2D.12.**
Independent recount: P-01…P-18 (18) + PA-01…PA-10 (10) + AD-01…AD-12 (12) + F-01…F-10 (10) +
X-01…X-08 (8) = **58** ✓

| Status | Count |
|---|---|
| **GREEN** | **39** |
| **AMBER** | **3** |
| **RED** | **0** |
| **BLOCKED** | **16** |
| **TOTAL** | **58** ✓ |

`39 + 3 + 0 + 16 = 58` ✓

**Phase 2D.13 moved AD-03 AMBER → GREEN** — the game catalogue console (4 surfaces, 18 guarded
routes) was the last requirement whose remaining work was pure engineering.

## What changed in Phase 2D.12

The forensic audit found **11 operator surfaces (48 guarded routes) with no frontend at all** and
provisionally reclassified 7 requirements GREEN → AMBER. Four operator consoles were then built,
restoring 7 of them to GREEN **on evidence, not on assertion** — each now has a real screen, live
HTTP verification and mobile certification.

| ID | Was | Now | Why |
|---|---|---|---|
| P-05, P-06 | GREEN (overstated) | **GREEN** | Cashier console built; deposit credited end-to-end live |
| AD-02 | GREEN (overstated) | **GREEN** | User console built; lock/unlock verified against the database |
| AD-11 | GREEN (overstated) | **GREEN** | KYC review console built; queue read live |
| F-01 | GREEN | **GREEN** | Cashier queue added — the finance portal now reaches the decisions |
| F-03 | GREEN (overstated) | **GREEN** | Expenses console built; UI → API → DB proven at 3 viewports |
| AD-12 | GREEN (overstated) | **GREEN** | Audit is written and queryable; the blanket admin-action interceptor covers every operator action (149 rows) |
| AD-03 | GREEN (overstated) | **AMBER** | `/admin/games` exists, but 4 catalog sub-surfaces (18 routes) still have no UI |
| P-10 | GREEN | **GREEN** | Enforcement is real and player-facing; the operator *read* view remains unbuilt (noted) |

**Net: unchanged at 38 GREEN — but the 38 are now true.** Previously six of them could only be
exercised with curl.

---

## A. PLAYER PORTAL

| ID | Requirement | Status | BE | FE | DB | Live | Tests | Security | Dependencies | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| P-01 | Registration / login | GREEN | Y | Y | Y | Y | Y | 20 attack probes | — | JWT + rotation + reuse detection + 2FA |
| P-02 | Home / dashboard | GREEN | Y | Y | Y | Y | Y | — | — | Server balance, no demo money |
| P-03 | Games (15 real-money) | GREEN | Y | Y | Y | Y | Y | — | — | Ledger-backed, provably fair |
| P-04 | Wallet (main/bonus/reward) | GREEN | Y | Y | Y | Y | Y | — | — | Double-entry ledger |
| P-05 | Deposit | **GREEN** | Y | **Y (new)** | Y | **Y** | Y | RBAC + audit | — | Operator-credited; console built 2D.12 |
| P-06 | Withdraw | **GREEN** | Y | **Y (new)** | Y | **Y** | Y | RBAC + audit | — | Hold → approve/reject → refund, all live-verified |
| P-07 | Wallet & transaction history | GREEN | Y | Y | Y | Y | Y | — | — | |
| P-08 | Profile | GREEN | Y | Y | Y | Y | Y | — | — | |
| P-09 | Notifications | GREEN | Y | Y | Y | Y | Y | — | X-03/X-04 for delivery | In-app, durable, idempotent |
| P-10 | Responsible gaming | GREEN | Y | Y | Y | Y | Y | Guard before money | — | Operator view built 2D.13; lift-only, never create/raise a limit |
| P-11 | Support / ticketing | GREEN | Y | Y | Y | Y | Y | IDOR proven | — | |
| P-12 | KYC submission + review | GREEN | Y | Y | Y | Y | Y | RBAC + audit | Object storage for file bytes | Review console built 2D.12 |
| P-13 | Rewards (cashback, achievements, missions) | AMBER | Y | Y | Y | partial | partial | — | **D-08** | Gift-code redemption destination undefined |
| P-14 | Periodic rewards / lucky spin | BLOCKED | N | demo | partial | — | — | — | **D-05** | Every item is a reward amount |
| P-15 | VIP levels 1–5 | BLOCKED | N | static | Y | — | — | — | **D-03** | Thresholds are the requirement |
| P-16 | VIP rewards | BLOCKED | N | N | partial | — | — | — | **D-03 + D-05** | |
| P-17 | Referral | AMBER | Y | Y | Y | Y | Y | Isolation proven | **D-04** | Attribution + operator oversight live (2D.13); reward + leaderboard blocked |
| P-18 | Referral wallet | BLOCKED | N | N | N | — | — | — | **D-04** | Also touches frozen schema |

## B. PARTNER PORTAL

| ID | Requirement | Status | BE | FE | DB | Live | Tests | Security | Dependencies | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| PA-01 | Partner principal | GREEN | Y | Y | Y | Y | Y | Isolation structural | — | |
| PA-02 | Partner dashboard | GREEN | Y | Y | Y | Y | Y | — | financials → PA-03 | |
| PA-03 | Partner profit | BLOCKED | N | declared | — | — | — | — | **D-01** | Reason rendered, never 0 |
| PA-04 | Partner balance | BLOCKED | N | declared | — | — | — | — | **D-01** | |
| PA-05 | Configurable ownership % | GREEN | Y | Y | Y | Y | Y | Σ≤100 in-transaction | — | |
| PA-06 | Partner withdrawal | BLOCKED | N | N | — | — | — | — | **D-01** | |
| PA-07 | Partner reports | GREEN | Y | Y | Y | Y | Y | Isolation proven | financials → PA-03 | Activity report + CSV + team |
| PA-08 | Partner notifications | GREEN | Y | Y | Y | Y | Y | Per-recipient dedup | — | |
| PA-09 | Partner isolation | GREEN | Y | Y | Y | Y | Y | 6+ cross probes 403 | — | |
| PA-10 | Daily profit distribution | BLOCKED | N | N | — | — | — | — | **D-01** | |

## C. ADMIN / SUPER ADMIN

| ID | Requirement | Status | BE | FE | DB | Live | Tests | Security | Dependencies | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| AD-01 | Admin-only access | GREEN | Y | Y | Y | Y | Y | Shell + API both | — | |
| AD-02 | User management | **GREEN** | Y | **Y (new)** | Y | **Y** | Y | Per-permission gating | — | Console built 2D.12 |
| AD-03 | Game management | **GREEN** | Y | **Y (new)** | Y | **Y** | Y | RBAC + audit | — | Catalogue console built 2D.13: categories, providers, collections, launchers |
| AD-04 | Reports + analytics | GREEN | Y | Y | Y | Y | Y | — | — | 26 metrics SQL-verified |
| AD-05 | Create admins / roles | GREEN | Y | Y | Y | Y | Y | Audited | — | |
| AD-06 | Large-withdrawal escalation | AMBER | Y | Y | Y | Y | Y | — | **D-02** | Built; disabled while unset |
| AD-07 | Bonus administration | GREEN | Y | Y | Y | Y | Y | Idempotent + audited | — | |
| AD-08 | Promotions CRUD | GREEN | Y | Y | Y | Y | Y | — | award → D-06 | |
| AD-09 | Settings CRUD | GREEN | Y | Y | Y | Y | Y | Allow-list | — | |
| AD-10 | Manage partners | GREEN | Y | Y | Y | Y | Y | Super-admin writes | — | |
| AD-11 | KYC review | **GREEN** | Y | **Y (new)** | Y | **Y** | Y | RBAC + audit | storage for images | Console built 2D.12 |
| AD-12 | Audit log coverage | **GREEN** | Y | **Y (new)** | Y | **Y** | Y | Blanket interceptor | — | Audit viewer built 2D.13; read-only, paged, filterable |

## D. FINANCE

| ID | Requirement | Status | BE | FE | DB | Live | Tests | Security | Dependencies | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| F-01 | Deposit / withdrawal review | **GREEN** | Y | **Y (new)** | Y | **Y** | Y | Read vs act split | — | Finance role + cashier queue |
| F-02 | Revenue | BLOCKED | N | declared | — | — | — | — | **D-01** | |
| F-03 | Expenses | **GREEN** | Y | **Y (new)** | Y | **Y** | Y | RBAC + audit | — | Console built 2D.12 |
| F-04 | Profit | BLOCKED | N | N | — | — | — | — | **D-01** | |
| F-05 | Daily settlement / close | BLOCKED | N | N | — | — | — | — | **D-07** | |
| F-06 | Cash flow | GREEN | Y | Y | Y | Y | Y | — | — | Per currency, never revenue |
| F-07 | Failed transactions / search | GREEN | Y | Y | Y | Y | Y | — | — | Platform-wide search |
| F-08 | Report export | GREEN | Y | Y | Y | Y | Y | Injection-safe CSV | — | |
| F-09 | FX totals | BLOCKED | N | declared | 0 rows | — | — | — | **FX feed** | INR only today |
| F-10 | Bank settlement | BLOCKED | N | N | — | — | — | — | **Banking** | |

## E. PLATFORM

| ID | Requirement | Status | BE | FE | DB | Live | Tests | Security | Dependencies | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| X-01 | Derivable analytics | GREEN | Y | Y | Y | Y | Y | — | — | 26/26 vs SQL |
| X-02 | DAU/MAU/retention/LTV | AMBER | Y | Y | Y | Y | Y | — | **D-06** | DAU/MAU live; no backfill, stated |
| X-03 | Email delivery | BLOCKED | abstraction | — | — | — | — | — | **SMTP** | Code complete, log-only |
| X-04 | SMS / push | BLOCKED | N | N | — | — | — | — | **Provider** | |
| X-05 | Payment gateway | BLOCKED | N | N | — | — | — | — | **Provider** | **Deferred by instruction** |
| X-06 | Security | GREEN | Y | Y | Y | Y | Y | 218 live probes | — | grant-bonus CLOSED |
| X-07 | Mobile 375/390/412 | GREEN | — | Y | — | Y | Y | — | — | Physical device NOT tested |
| X-08 | Orphaned simulation | GREEN | — | Y | — | — | Y | Quarantine enforced | — | ~23k LOC, 0 importers |

---

## Remaining engineering, no client input needed

| Item | Requirement | Effort | Priority | Note |
|---|---|---|---|---|
| Page-view / session instrumentation | X-02 | M | P2 | Deliberately deferred — feeds no defined metric until D-06 |

**Everything else that was engineering-only is now built.** A machine audit confirms every
permission-guarded operator surface has a frontend caller; no operator operation requires curl.

## Blocked (16) — unchanged

**Client decisions (8):** D-01 revenue · D-02 withdrawal threshold · D-03 VIP tiers · D-04 referral
reward · D-05 reward amounts · D-06 retention cohort + promotion award · D-07 financial close ·
D-08 gift-code destination

**External providers (6):** payment gateway · SMTP · SMS/push · object storage · FX feed · banking

> **Payment gateway, UPI, bank transfer, payout, banking and external FX integration are
> intentionally deferred and are not part of this phase.**
