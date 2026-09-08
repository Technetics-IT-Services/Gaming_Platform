# Phase 2D.8 — Final Report

> Requested as `PHASE_2D4_*`, but those files hold the genuine Phase 2D.4 partner evidence.
> Overwriting them would destroy that record, so this phase uses the next free number.

## BEFORE
GREEN = 24 · AMBER = 10 · RED = **10** · BLOCKED = 11

*(The baseline RED was corrected from a mislabelled "8" — the row listed 10 IDs.)*

## AFTER
GREEN = **25** · AMBER = 10 · RED = **9** · BLOCKED = 11

## Requirements moved

| ID | Old | New | Evidence |
|---|---|---|---|
| **AD-09 Settings CRUD** | RED | **GREEN** | 17 integration + **35 live** + **18 mobile/E2E** across 375/390/412; UI→API→DB→player-page chain verified; allow-list proven to reject all money/safety keys |

## Tests

| Suite | Result |
|---|---|
| Backend (full, incl. DB integration + stress) | **728 passed · 59/59 suites · 0 skipped · 0 failed** (was 711) |
| Frontend | **962 passed · 0 failed** (was 945) |
| Settings integration | 17 passed |
| **Live HTTP security** | **35 passed, 0 failed** |
| Mobile + E2E (375/390/412) | **18 passed** |
| Concurrency stress | 10/10 |
| Typecheck (backend/frontend/database) | clean |
| Lint | backend 0/0 · frontend 0 errors |
| Production builds | backend ✅ · frontend ✅ 98/98 pages |

## Financial

- **Reconcile: `balanced: true`, `difference: "0"`**
- Negative balances: **0**
- Duplicate settlements: **0** (stress 10/10)
- Restart persistence: verified for settings
- Ledger debit total **and entry count** unchanged across all settings activity

## Frozen surfaces

**Changed? NO.** `WalletEngine`, wallet-core, ledger, settlement, `GameMoneyBridge`, game engines,
provably-fair and runtime are untouched. No `FROZEN_CHANGE_PROPOSAL` required.

## Client decisions still required

| Decision | Blocks |
|---|---|
| **Define "revenue"** | F-02, F-04 profit, F-05 daily settlement, PA-03/04/06/10 (the entire partner money layer) |
| **Large-withdrawal threshold** (a number) | AD-06 — mechanism built, disabled while unset |
| **Referral qualifying-deposit threshold + reward amount** | P-17 reward half, P-18 |
| **VIP tier thresholds + per-tier reward values** | P-15, P-16 |
| **Promotion award rule** | AD-08 awarding half |
| **Daily-login / spin / seasonal reward values** | P-14 |

## External dependencies

| Dependency | Blocks |
|---|---|
| Payment gateway provider + credentials | X-05 |
| SMTP credentials | X-03 |
| SMS / push provider | X-04 |
| Banking provider | F-10 |
| FX rate source | F-09 |
| Object storage | KYC document file bytes |

## Remaining RED (9)

P-14 · P-15 · P-16 · P-17 · P-18 · PA-07 · AD-08 · F-05 · X-02

Of these, only **P-17 attribution**, **AD-08 CRUD** and **X-02** are implementable without a client
decision; the rest need one of the decisions above.

## Remaining BLOCKED (11)

F-02 · F-04 · F-09 · F-10 · X-03 · X-04 · X-05 · PA-03 · PA-04 · PA-06 · PA-10 (+ KYC file upload)

## RELEASE VERDICT

**NOT COMPLETE — BLOCKED BY:**

1. **The revenue definition** (client) — blocks 7 requirements across finance and partner money.
2. **Reward/threshold values** (client) — blocks P-14/P-15/P-16/P-17 reward/AD-08 awarding/AD-06.
3. **External providers** — payments, SMTP, SMS/push, banking, FX, object storage.
4. **Unstarted implementable work** — P-17 attribution, AD-08 CRUD, X-02 event pipeline.

The system is a **production-grade core platform**: the money core, authentication, RBAC + 2FA,
audit, notifications, responsible-gaming enforcement, KYC, support, analytics/reporting, partner
principal, expenses and settings are all real, verified and financially safe. **25 of 54 tracked
requirements are GREEN with zero fabricated functionality.**

It is **not** the complete client system, and should not be presented as one.

## Honest note on this phase's size

One requirement moved. That is deliberate: I completed AD-09 as a **full vertical slice**
(registry → API → admin UI → player-facing consumer → tests → live → mobile) rather than starting
P-17 and AD-08 and leaving three things half-built. The brief asked for complete features over
partial ones, and the settings surface in particular needed the allow-list done carefully — a
generic version would have exposed live game-odds configuration.
