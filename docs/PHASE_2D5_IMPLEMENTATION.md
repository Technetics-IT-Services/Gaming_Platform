# Phase 2D.5 — Implementation

## 1. F-03 Operating expenses (GREEN)

### Schema — `packages/database/prisma/schema/finance.prisma` (additive)

| Model | Notes |
|---|---|
| `ExpenseCategory` | operator-defined `code`/`name`. A **table, not an enum** — categories are the client's chart of accounts, and hardcoding a list would invent it |
| `Expense` | `amount Decimal(20,8)`, `currencyId`, `incurredOn` (business **date**, not row creation time), `status` (DRAFT/CONFIRMED/VOID), unique `reference`, `createdByUserId`, void attribution |

Indexed on `(status, currencyId, incurredOn)` so the period rollups a future profit calculation
needs are deterministic.

### RBAC

`expenses:read` / `expenses:write`, granted to `admin` (super-admin inherits). **`wallets:adjust` is
neither reused nor required** — recording what the business spent is not the authority to move
player money.

### API — `/admin/finance/expenses`

`GET /categories` · `POST /categories` · `GET /` · `GET /totals` · `GET /:id` · `POST /` ·
`POST /:id/confirm` · `POST /:id/void`

### The rules that matter

| Rule | Implementation |
|---|---|
| **No money movement** | An expense creates **no ledger entry, no wallet transaction, no balance change**. Verified live: ledger debit/credit **and entry count** byte-identical across a 12,345.67891234 expense through create→confirm→void |
| **No profit** | `totals()` returns expense sums **only**, per currency, and declares `profit` unavailable naming the missing revenue definition |
| Always DRAFT | A client cannot create a CONFIRMED expense; `status` in the body is a 400 |
| Void, never delete | Financial records are retained with who voided and why; excluded from totals |
| Duplicate guard | A unique `reference` stops the same invoice being recorded twice |
| Concurrency | Conditional `updateMany` — two concurrent confirms cannot both win |
| Per currency | Totals never combined; an unknown currency filter yields empty, not everything |

## 2. PA-08 Partner notifications (AMBER)

Three events added to the **existing** 2D.1 `NotificationEventsService` — no second system:
`partnerStatusChanged`, `partnerShareChanged`, `partnerMemberAdded`.

**BLOCKED and deliberately absent:** partner *daily profit* notifications. They depend on PA-03,
which is blocked on the revenue definition; emitting one would require a fabricated amount. A test
asserts no such method exists.

### A real bug caught by testing

The first event keys were `partner:status:<partnerId>:<status>` — **without the recipient**. Because
notification ids are deterministic from the key, the second member's notification deduplicated
against the first, so **every member after the first silently received nothing**. Fixed by including
`userId` in the key; verified live that a status change notifies *both* members (count 2 → 4) while
repeating the same transition still does not duplicate (stays 4).

## 3. Deliberately NOT built, with reasons

| Req | Why not |
|---|---|
| **AD-09 Settings CRUD** | `ApplicationSetting` is **already the live store for real-money game variant configs** (dice, crash, roulette, card) plus alerts/missions/seasons/tournaments — 37 usages. A generic settings CRUD over it would hand an admin a UI to edit money-affecting game configuration. The brief says stop before changing money-affecting behaviour. Doing this safely needs a `SystemSetting`-backed **key whitelist**, which was scoped but not shipped rather than rushed |
| **AD-08 Promotions admin** | Models exist and CRUD is implementable, but the **monetary awarding** has no defined rule. Deprioritised behind F-03/PA-08 under the deadline; no fabricated reward was created |
| **P-17 Referral** | Attribution is implementable, but the "qualifying deposit" **threshold is undefined**, so reward crediting is BLOCKED. Splitting it mid-phase risked shipping a partial vertical slice, which the brief tells me to avoid |

## 4. Frozen surfaces

Untouched: `WalletEngine`, wallet-core, ledger, settlement, `GameMoneyBridge`, game engines,
provably-fair, runtime. **No `FROZEN_CHANGE_PROPOSAL` was needed** — an expense posts nothing, and
notifications move no money.

## 5. Tests

| Suite | Count |
|---|---|
| Expense integration (real Postgres) | **24** |
| Partner + notification integration | **27** (21 partner + 6 notification) |
| Live HTTP (authz, validation, mass assignment, lifecycle, financial safety, audit, notifications) | **37** |
