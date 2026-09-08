# Phase 2D.10 — Implementation Record

This phase ran in two parts: **implementation** of every remaining locally-implementable
requirement, then an **audit-only** forensic pass. This document records the implementation half;
the audit half is in `PHASE_2D10_FINAL_DELIVERY_STATUS.md` and
`PHASE_2D10_REQUIREMENT_MATRIX_FINAL.md`.

**No database schema change. No frozen surface modified.**

---

## 1. AD-07 — Operator bonus administration

`modules/bonus-admin/{bonus-admin.service.ts, bonus-admin.controller.ts, bonus-admin.module.ts}`

`BonusWalletService` was already real, but lived behind a **frozen** module and had no operator
surface. This module consumes it without modifying it, adding the three things the frozen layer
does not provide and cannot be changed to provide:

1. **Authorization** — `wallets:adjust` on every mutation, the same authority already required to
   credit a wallet. `AdminTwoFactorGuard` also applies because the path is under `/admin/`.
2. **Idempotency** — the frozen `grant()` takes no idempotency key, so a retried request would
   create a second bonus wallet. A grant here is anchored on an operator-supplied `reference`; a
   replay returns the original grant. The anchor is read from the audit trail, because `BonusWallet`
   has no reference column and the schema is frozen.
3. **Audit** — the frozen grant writes no audit row. Every grant and expiry here is attributed to
   the operator, with the reference, amount, wagering requirement and reason.

**Nothing is fabricated.** The amount and wagering requirement are typed by a human on each grant;
there is no eligibility rule, no schedule and no automatic award — `automaticBonusAward` is returned
as blocked with the reason. A single grant is capped at 1,000,000 as a typo guard, not a business
rule.

Expiring closes a bonus and zeroes it, conditional on the row still being `ACTIVE` so two operators
cannot both act, and records the forfeited balance.

**Granting moves no ledger entry** — a bonus is not real money until converted, and conversion still
enforces the wagering requirement. Verified live and in integration.

## 2. F-01 — Finance role and portal

**The `finance` role** (`rbac.constants.ts`): `transactions:read`, `wallets:read`, `analytics:read`,
`audit:read`, `expenses:read`, `expenses:write`. **`wallets:adjust` is deliberately absent** — a
finance operator inspects and records; deposit and withdrawal *decisions* remain on the cashier
surface. Proven live: a finance principal receives 403 from both `POST /admin/bonuses` and
`POST /admin/wallet/credit`.

Its coarse `UserRole` maps to `USER`, exactly as `partner` does — real authorization is by
permission, and mapping it to `ADMIN` would make it look elevated to any code still reading the
coarse role.

`GET /admin/finance/queues` returns review queue lengths as **counts only**; mixing an amount into a
queue length invites reading it as an exposure figure.

## 3. F-06 — Cash flow

`GET /admin/finance/cash-flow`. Money in = COMPLETED deposits; money out = COMPLETED withdrawals.
Pending and failed requests are excluded because they moved no money.

**Two rules the service obeys absolutely:** every figure is a per-currency bucket (no FX source
exists, so a cross-currency sum would be fabricated), and the response never uses the word revenue —
`revenue`, `profit` and `consolidatedCurrencyTotal` are returned as unavailable with reasons, and
the payload carries its own definition string which the UI prints verbatim.

Verified against direct SQL live and at all three mobile widths.

## 4. F-07 — Transaction search and failure view

**Search** (`GET /admin/finance/transactions`) is platform-wide and filterable by player, type,
status, currency, reference and amount range. The previous operator surface could only list one
user at a time. An **unknown filter value matches nothing** rather than being ignored — silently
dropping a filter would return platform-wide rows under a filter label the caller believes was
applied.

**Failures** (`GET /admin/finance/failures`) reports failed deposits, rejected/failed withdrawals
and failed game rounds. It deliberately does **not** render an empty "failed transactions" table over
`wallet_transactions`, because that table has **no failure status by design** — the engine posts a
transaction only after its ledger entries commit. The response says so, and the UI prints it.

## 5. AD-12 — Blanket admin-action audit

`common/interceptors/admin-action-audit.interceptor.ts`, registered globally.

Per-service auditing was good but only as complete as the next developer remembers to make it, and
one high-privilege surface was genuinely missing: `POST /admin/wallet/credit` and `/debit` record
the adjustment in `wallet_transactions` but **not which operator performed it**. That controller is
frozen.

Every successful **mutating** request under `/admin/` is now recorded as an `admin_action`,
attributed to the operator, with the route and a filtered body. Path-scoping is the right shape for
an observer — a future admin controller cannot forget to be audited, and over-matching is safe.

- It is written **after** the handler succeeds and can never throw; an audit row must not be able to
  fail an operator's action or make a completed money movement look failed.
- The body passes an **allow-list** of descriptive keys, then a **second, independent deny-list**
  for credential-shaped names. The allow-list was surveyed and is safe today; the deny-list makes
  that invariant local to the file rather than dependent on a survey staying true.
- GETs are not recorded — a read is not an action. Verified live.

## 6. PA-07 — Partner team

`GET /partner/members` returns the caller's own colleagues, resolved from their own membership.
**Usernames only — no user ids**: a partner needs to know who their colleagues are, not to be handed
an identifier usable against another surface.

## 7. X-08 — Orphaned simulation quarantine

`src/lib/orphaned-simulation.test.ts` — enforcement, not documentation.

Twelve directories (~19k LOC) must have **zero importers anywhere**. Two more (`payments`, `ledger`,
~2k LOC) are honestly acknowledged as reachable **only from the demo wallet**, and the test names
the exact four files permitted to import them. A further assertion proves no real-money route page
touches the demo wallet, and a classification check fails if a new unclassified directory appears.

The detector is self-tested against known-good and known-bad inputs so it cannot pass vacuously.

---

## 8. Frontend

| Surface | File |
|---|---|
| Finance console (queues, cash flow, search, failures) | `app/admin/finance/page.tsx` — **read-only by construction: it does not import `useMutation`** |
| Bonus administration | `app/admin/bonuses/page.tsx` — no pre-filled amount, no auto-award control, mandatory reference and reason |
| Partner team panel | `app/partner/page.tsx` |
| Clients | `lib/finance-ops-api.ts`, `lib/bonus-admin-api.ts`, `lib/partner-api.ts` |
| Navigation | Bonuses and Finance added to the admin shell |
| Demo isolation | `/admin/finance/*`, `/admin/bonuses`, `/partner/members` asserted blocked for demo sessions |

---

## 9. Tests added

| Suite | Count |
|---|---|
| `finance-ops.integration.spec.ts` | 18 |
| `orphaned-simulation.test.ts` | 6 |
| `finance-ops-api.test.ts` | 23 |
| `p2d10-finance-bonuses.spec.ts` (mobile, ×3 viewports) | 24 |
| Live HTTP harness | 50 |

Totals moved from 769 → **787** backend and 1008 → **1041** frontend, with **0 skipped** in both.

---

## 10. What was deliberately NOT built

- **Automatic bonus awarding** — no rule defines the trigger, audience or amount
- **Revenue, profit, GGR anywhere in the finance console** — an existing `houseProfit = bets − wins`
  computation was found in the frozen reporting service, but it **sums across currencies without an
  FX source** and is a gaming metric, not an accounting definition. It is reported to the client as
  *one option* in the decision pack; it was not adopted
- **Gift-code redemption (P-13)** — the destination wallet and the percentage base are undefined
- **VIP tier configuration (P-15)** — choosing even the *metric* a tier is measured by would be
  inventing commercial policy
- **The `grant-bonus` security fix** — frozen surface; proposal raised, awaiting approval
