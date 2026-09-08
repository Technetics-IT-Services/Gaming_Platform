# Phase 2D.6 — Audit & Data-Source Matrix (before code)

**No code written at the time of this document.** Companions: `PHASE_2D6_ANALYTICS_DEFINITIONS.md`,
`PHASE_2D6_IMPLEMENTATION.md`, `PHASE_2D6_SECURITY_TESTS.md`, `PHASE_2D6_FINAL_REPORT.md`.

Evidence gathered by querying the **live disposable database** (`gp_phase1_pg`), not by reading code.

---

## 1. What exists today

| Component | State |
| --- | --- |
| `AnalyticsService.getDashboardMetrics()` | throws `NotImplementedException` — live `GET /analytics/summary` → **501** |
| `AnalyticsController` | one route, guarded `@Roles(UserRole.ADMIN)` |
| `src/lib/analytics/` (frontend, 1,650 LOC) | **ORPHANED** — 0 `.tsx` importers, 0 routes, 0 backend calls (Phase 2C.18 §3.1) |
| `/admin/analytics` page | 24-line honest placeholder |
| `PERMISSIONS.ANALYTICS_READ` | **already exists** and is already in `ADMIN_PERMS` |
| `RolesGuard` / `hasAnyRole` | weight-based hierarchy (`SUPER_ADMIN 50 ≥ ADMIN 40`), so super-admin is not excluded |

## 2. Source-of-truth proof — live row counts

WHO writes / WHAT table / WHETHER authoritative, proven by counting:

| Table | Rows | Written by | Authoritative? | Verdict |
| --- | --- | --- | --- | --- |
| `game_rounds` | **5,379** | `GameMoneyBridgeService` (frozen) at play/settle | yes — one row per round | **USABLE** |
| `wallet_transactions` | **15,717** | `WalletEngineService` (frozen) on every movement | yes — ledger-level truth | **USABLE** |
| `deposit_requests` | **61** | `CashierService` | yes | **USABLE** |
| `withdrawal_requests` | **189** | `CashierService` | yes | **USABLE** |
| `users` | **1,826** | `AuthService.register` | yes | **USABLE** |
| `sessions` | **422** | `SessionService` | yes | **USABLE** |
| `login_history` | **283** | `AccountSecurityService.recordLogin` | yes (login events only) | **LIMITED** |
| `security_events` | **475** | `SecurityEventService` | yes | **USABLE** |
| `audit_trails` | **384** | `AuditService` | yes | **USABLE** |
| `notifications` | **466** | `NotificationsService` (Phase 2D.1) | yes | **USABLE** |
| `page_views` | **0** | **nothing** | — | **NOT AVAILABLE** |
| `player_sessions` | **0** | **nothing** | — | **NOT AVAILABLE** |
| `revenue_analytics` | **0** | **nothing** | — | **NOT AVAILABLE** |
| `traffic_analytics` | **0** | **nothing** | — | **NOT AVAILABLE** |
| `user_activities` | **0** | **nothing** | — | **NOT AVAILABLE** |
| `exchange_rates` | **0** | **nothing** | — | **NO FX SOURCE** |

Every "USABLE" source is written inside a database transaction by a service that already survives
restart, and each is independently reconcilable (`/admin/wallet/reconcile` returns
`balanced: true, difference: "0"`).

## 3. CRITICAL FINDING — `GameRound` and `WalletTransaction` measure DIFFERENT things

They must never be equated. Measured:

| Measure | Value |
| --- | --- |
| `SUM(GameRound.stake)` where status = SETTLED | 43,290.00 |
| `SUM(GameRound.stake)` where status ∈ (SETTLED, RECOVERED, RESOLVED) | **56,695.00** |
| `SUM(WalletTransaction.amount)` type GAME_BET | **56,785.00** |
| `SUM(GameRound.payout)` where status ∈ (SETTLED, RECOVERED, RESOLVED) | **6,554,865.80** |
| `SUM(WalletTransaction.amount)` type GAME_WIN | **6,555,061.80** |

The residual is **fully explained**, not hand-waved:

- **30 rounds carry more than one `GAME_BET` transaction** (verified by grouping GAME_BET references
  by round id). These are interactive games — Blackjack `DOUBLE` adds a second reservation
  (Phase 2C.4), Mines stages reveals — so one round legitimately produces several money movements.
- 5,027 distinct round ids have bet transactions vs 5,018 money-moving rounds; the extra references
  are synthetic `stress-*` keys produced by the concurrency stress suite, which are not game rounds.
- `FAILED` rounds (296, stake 7,410) had money moved and then refunded, so they appear in the ledger
  but not in any "settled" round filter.

**Design consequence:** gaming metrics come from `GameRound` (game-level, one row per round);
financial metrics come from `WalletTransaction` (ledger-level money movement). Each is labelled with
its source and its status filter, and the documentation states explicitly that the two totals are
**not expected to be equal**, with this reason.

*(The extreme payout/stake ratio is also explained and legitimate: number-lottery jackpots pay the
configured 50,000× tier — `stake 10 → payout 500,000` — and the deterministic test seeds hit
six-number matches repeatedly. Real data, skewed fixtures.)*

## 4. Multi-currency — CONVERSION IS IMPOSSIBLE

`currencies` holds **INR and USD, both active**. `exchange_rates` has **0 rows** and nothing writes
it. **There is no FX-rate source.**

Therefore **no financial metric may be summed across currencies.** Every financial aggregate is
returned as a per-currency bucket. A consolidated single-currency total is marked **RED — NOT
AVAILABLE (no FX source)**, and no rate will be invented.

*(Observed: all current game rounds are INR; USD is configured but unused. The per-currency shape is
still mandatory so a USD round cannot silently corrupt a total later.)*

## 5. Timezone

All timestamps are Postgres `timestamp` values written by `@default(now())` / `new Date()` from Node,
i.e. **UTC**. Analytics group and filter in **UTC**, and this is stated in the API response and in the
definitions document. No timestamp is reinterpreted.

## 6. Data-source matrix (Step 2)

Legend: **GREEN** directly derivable · **YELLOW** derivable with a stated limitation · **RED** source
data absent · **D** external/business dependency.

### 6.1 Gaming — source `game_rounds`

| Metric | Source field | Calculation | Time | User | Game | Currency | Authoritative | Safe | Class |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Total rounds | `id` | `count()` | `createdAt` | ✔ | ✔ | ✔ | yes | yes | **GREEN** |
| Rounds by status | `status` | `groupBy(status)` | ✔ | ✔ | ✔ | ✔ | yes | yes | **GREEN** |
| Stake volume | `stake` | `sum` where status ∈ settled-set | ✔ | ✔ | ✔ | ✔ | yes | yes | **GREEN** |
| Payout volume | `payout` | `sum` where status ∈ settled-set | ✔ | ✔ | ✔ | ✔ | yes | yes | **GREEN** |
| Average stake ("average bet") | `stake` | `avg` | ✔ | ✔ | ✔ | ✔ | yes | yes | **GREEN** |
| Average payout | `payout` | `avg` | ✔ | ✔ | ✔ | ✔ | yes | yes | **GREEN** |
| Payout / stake ratio | both | `sum(payout)/sum(stake)`, null when stake = 0 | ✔ | ✔ | ✔ | ✔ | yes | yes | **GREEN** |
| Wins / losses | `payout` | `payout > stake` / `payout < stake` | ✔ | ✔ | ✔ | ✔ | yes | yes | **YELLOW** — derived from the money outcome, not a stored win flag |
| Ties | `payout` | `payout = stake` | ✔ | ✔ | ✔ | ✔ | yes | yes | **YELLOW** — same |
| Most-played games | `gameKey` | `groupBy(gameKey)` ordered by count | ✔ | ✔ | ✔ | ✔ | yes | yes | **GREEN** |
| Daily rounds / stake / payout | `createdAt` | `groupBy(day)` in UTC | ✔ | ✔ | ✔ | ✔ | yes | yes | **GREEN** |
| Pending settlements | `status` | count of `PENDING_SETTLEMENT` | ✔ | — | ✔ | ✔ | yes | yes | **GREEN** |
| Recovery failures | `status`, `recoveryAttempts` | count of `RECOVERY_FAILED` | ✔ | — | ✔ | ✔ | yes | yes | **GREEN** |

### 6.2 Financial (ledger-level) — source `wallet_transactions`, `deposit_requests`, `withdrawal_requests`

| Metric | Source | Calculation | Currency | Class |
| --- | --- | --- | --- | --- |
| Transaction count / volume by type | `wallet_transactions` + `transaction_types.code` | `groupBy(type, currency)` | per-currency | **GREEN** |
| Deposit requests by status | `deposit_requests.status` | `groupBy(status)`, `sum(amount)` | per-currency | **GREEN** |
| Withdrawal requests by status | `withdrawal_requests.status` | `groupBy(status)`, `sum(amount)` | per-currency | **GREEN** |
| Average deposit / withdrawal | same | `avg(amount)` on COMPLETED | per-currency | **GREEN** |
| Pending cashier requests | both | count of PENDING / UNDER_REVIEW | per-currency | **GREEN** |
| Wallet balances / active wallets | `wallet_balances` | `sum(available)`, count > 0 | per-currency | **GREEN** |
| Fees | `wallet_transactions.fee` | `sum(fee)` | per-currency | **YELLOW** — the column is authoritative but the cashier currently sets `fee = 0`, so the total is genuinely 0, not missing |
| **Revenue** | — | — | — | **RED — accounting definition not established** |
| **Expenses** | **no expense model exists** | — | — | **RED — SOURCE DATA NOT PRESENT** |
| **Profit** | needs revenue − expenses | — | — | **RED — blocked by expenses** |
| **Partner profit** | no partner entity | — | — | **RED — SOURCE DATA NOT PRESENT** |
| **Consolidated multi-currency total** | needs FX | — | — | **RED — NO FX SOURCE** |

### 6.3 Users

| Metric | Source | Calculation | Class |
| --- | --- | --- | --- |
| Registered users | `users` | `count(deletedAt = null)` | **GREEN** |
| Users by status | `users.status` | `groupBy(status)` | **GREEN** |
| Email-verified users | `users.emailVerified` | `count(true)` | **GREEN** |
| Users who have played | `game_rounds.userId` | `distinct` over the range | **GREEN** |
| Users who have deposited | `deposit_requests.userId` | `distinct` where COMPLETED | **GREEN** |
| Users who have withdrawn | `withdrawal_requests.userId` | `distinct` where COMPLETED | **GREEN** |
| Deposit conversion | above ÷ registered | explicit ratio, precisely named | **YELLOW** — this is *deposit* conversion, **not** marketing/visitor conversion (which needs `page_views`, empty) |
| Users who logged in, per day | `login_history` | `distinct userId` where success | **YELLOW** — counts **logins**, not engagement; a returning user with a live session produces no row |
| **DAU** | — | — | **RED — NO RELIABLE ACTIVITY EVENT SOURCE.** `page_views`, `player_sessions`, `user_activities` are all empty. Login count is not DAU and will not be labelled as such. |
| **MAU** | — | — | **RED — same** |
| **Retention / cohorts** | — | — | **RED — SOURCE DATA NOT PRESENT** |
| **LTV** | — | — | **RED — needs lifetime financial attribution + activity** |
| **Session time** | `sessions.lastActivityAt` | — | **RED** — `lastActivityAt` only advances on token rotation (Phase 2D.2), so a duration derived from it would be an artefact of refresh cadence, not user behaviour |
| **Bounce rate** | — | — | **RED — SOURCE DATA NOT PRESENT** |

### 6.4 Operations

| Metric | Source | Class |
| --- | --- | --- |
| Audit action counts | `audit_trails` `groupBy(action/entityType)` | **GREEN** |
| Security event counts | `security_events` `groupBy(type/severity)` | **GREEN** |
| Notification counts / unread | `notifications` | **GREEN** |
| Recovery health | `game_rounds` status counts | **GREEN** |
| Account status counts | `users.status` | **GREEN** |

## 7. Scope decisions

**Player-facing analytics: NOT BUILT.** The client requirement's analytics list (DAU, MAU, retention,
revenue, profit, average bet, most-played games, conversion, LTV, average deposit/withdrawal, session
time, bounce rate) is an **operator** metric set. Players already have `/games/history` and
`/wallet/history`. Building a player analytics surface would be adding an unrequested feature, so it
is deliberately out of scope — per Step 9.

**Authorization: no new permission.** `PERMISSIONS.ANALYTICS_READ` already exists and is already
granted to `admin` (and to `super_admin` via `ALL_PERMISSIONS`). The controller will use
`@RequirePermissions(ANALYTICS_READ)` — matching `operations.controller.ts` — rather than the coarser
`@Roles`. **No financial mutation permission is involved, and `wallets:adjust` is not touched.**

**Caching: not added.** Correctness over optimisation for a first implementation (Step 13). Bounded
date ranges and database-side aggregation are the performance controls instead.

## 8. Performance plan

- All aggregation runs **in the database** via Prisma `groupBy` / `aggregate` / `count` — no loading
  rows into Node to sum them.
- Existing indexes cover the access paths: `game_rounds(userId, createdAt)`, `game_rounds(status)`,
  `wallet_transactions(userId, createdAt)`, `(typeId)`, `(currencyId)`, `(statusId)`.
- Daily series is the one place Prisma cannot group by a date truncation. Repository convention
  permits `$queryRaw` (used already in `wallet` reconciliation); it will be used **read-only** with
  **parameterised bindings only** — never string interpolation.
- A hard **maximum range of 366 days** is enforced, and `from > to` / invalid dates are rejected.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| Mislabelling ledger volume as "revenue" | Revenue/expenses/profit stay RED; the word "revenue" is not used for any exposed metric |
| Silently summing INR + USD | Every financial metric is per-currency; no FX conversion exists |
| Analytics mutating state | Service is strictly read-only: only `count`/`aggregate`/`groupBy`/`findMany`/`$queryRaw` SELECTs |
| Expensive scans | DB-side aggregation + 366-day cap + existing indexes |
| Fabricated zeros in the UI | Unavailable metrics render **"Not available"**, never `0` |

**No blocker. No migration required. No frozen surface required. Proceeding to implementation.**
