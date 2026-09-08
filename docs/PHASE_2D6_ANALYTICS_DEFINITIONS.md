# Phase 2D.6 — Analytics Definitions

**Every metric the platform exposes, with its exact formula, source table, currency handling,
timezone, applicable filters and limitations.** Nothing on the analytics dashboard is estimated,
modelled, extrapolated or defaulted. If a figure is not in this document, the platform does not
produce it.

Implementation: [analytics.service.ts](../apps/backend/src/modules/analytics/analytics.service.ts).
Source-of-truth evidence (live row counts): [PHASE_2D6_AUDIT.md](PHASE_2D6_AUDIT.md).

---

## 0. Rules that apply to every metric below

| Rule | Statement |
|---|---|
| **Timezone** | **UTC, always.** Range filtering uses `created_at >= from AND created_at < to`. Daily grouping uses `date_trunc('day', created_at AT TIME ZONE 'UTC')`. No local timezone is offered, because none is stored per user. |
| **Range** | Half-open `[from, to)`. Default when omitted: the last 30 days. **Maximum 366 days** — a longer range is rejected with `400`, it is not silently clamped. `from > to`, a future `from`, and unparseable dates are all rejected. |
| **Currency** | Amounts are **always returned as per-currency buckets and are never summed across currencies.** `exchange_rates` is empty and nothing writes it, so no FX source exists (audit §4). A cross-currency total would be a fabricated number. |
| **Amount type** | Money is returned as a **decimal string** carried straight from Postgres `numeric`. It is never converted to a JS float for transport. |
| **Missing data** | A metric that cannot be computed truthfully returns **`null`** and is listed in `meta.unavailable` with the reason. **It is never returned as `0`.** The dashboard renders these as "Not available". |
| **Read-only** | Analytics issues `count` / `groupBy` / `aggregate` / `findMany(select)` / read-only `$queryRaw` **only**. Proven by test (§7). |
| **Raw SQL** | Every `$queryRaw` is a tagged template; all values are bound parameters. No value is string-interpolated. |

### 0.1 Filters accepted by every endpoint

| Filter | Applies to | Behaviour |
|---|---|---|
| `from`, `to` | all windowed metrics | ISO-8601. See range rules above. |
| `currency` | gaming, financial, daily | ISO code, e.g. `INR`. **An unknown code returns empty results, not platform-wide totals** — it resolves to a sentinel UUID that matches no row, so a typo can never be silently reported under the wrong currency label. |
| `gameKey` | gaming, daily(rounds) | Exact `game_rounds.game_key`. |

**Filters that do NOT apply to a metric are documented per metric below.** `users.registered`,
`users.emailVerified`, `operations.pendingSettlements`, `operations.recoveryFailed` and
`operations.recovering` are **point-in-time platform state, not windowed** — they deliberately
ignore `from`/`to`.

---

## 1. Gaming — source `game_rounds`

`game_rounds` holds **one row per round**. This is the *game-level* measure.

**The settled-status filter.** Every stake/payout figure below counts only rounds in
`SETTLED`, `RECOVERED`, `RESOLVED` — the statuses in which money has finally moved and the round has
a final stake and payout. `roundsTotal` is the only gaming metric that counts *all* statuses.

| Metric | Formula | Source | Currency | Filters | Limitations |
|---|---|---|---|---|---|
| `roundsTotal` | `count(*)` | `game_rounds` | n/a (count) | from, to, currency, gameKey | Counts **all** statuses including in-flight rounds. Not comparable to `settledRounds`. |
| `roundsByStatus` | `count(*) GROUP BY status` | `game_rounds` | n/a | from, to, currency, gameKey | — |
| `settledRounds` | `count(*) WHERE status IN (SETTLED, RECOVERED, RESOLVED)` | `game_rounds` | n/a | from, to, currency, gameKey | This is the denominator for every stake/payout figure. |
| `stakeByCurrency` | `SUM(stake) GROUP BY currency_id`, settled only | `game_rounds.stake` | **per currency** | from, to, currency, gameKey | Game-level. **Not** the same as ledger `GAME_BET` volume — see §5. |
| `payoutByCurrency` | `SUM(payout) GROUP BY currency_id`, settled only | `game_rounds.payout` | **per currency** | from, to, currency, gameKey | Game-level. Not ledger `GAME_WIN` volume. |
| `averageStakeByCurrency` | `AVG(stake) GROUP BY currency_id`, settled only | `game_rounds.stake` | **per currency** | from, to, currency, gameKey | Arithmetic mean over settled rounds. Not a median; the distribution is not reported. |
| `averagePayoutByCurrency` | `AVG(payout) GROUP BY currency_id`, settled only | `game_rounds.payout` | **per currency** | from, to, currency, gameKey | As above. |
| `payoutToStakeRatio` | `SUM(payout) / SUM(stake)` per currency | `game_rounds` | **per currency** | from, to, currency, gameKey | **`null` when `SUM(stake) = 0`** — a ratio over zero stake is undefined, and is never reported as `0` or `1`. **This is not certified RTP.** It is the realised payout ratio of the rounds in this window only; short windows and small samples deviate widely from theoretical RTP. |
| `outcomes.wins` | `count(*) WHERE payout > stake`, settled only | `game_rounds` | n/a | from, to, currency, gameKey | **Derived, not stored.** There is no win flag in the schema; the outcome is inferred from the money result. A round that returns exactly the stake is a tie, not a win. |
| `outcomes.ties` | `count(*) WHERE payout = stake`, settled only | `game_rounds` | n/a | from, to, currency, gameKey | Derived as above. |
| `outcomes.losses` | `settledRounds − wins − ties` | derived | n/a | from, to, currency, gameKey | Derived by subtraction; the three always sum to `settledRounds` exactly (asserted by integration test). |
| `topGames` | `count(*) GROUP BY game_key ORDER BY count DESC LIMIT 15` | `game_rounds.game_key` | n/a | from, to, currency, gameKey | Ranked by **round count, not by stake**. Counts all statuses. Ties in count are broken arbitrarily by Postgres. The dashboard displays the top 8 of these 15. |

---

## 2. Financial (ledger-level) — sources `wallet_transactions`, `deposit_requests`, `withdrawal_requests`

`wallet_transactions` holds **one row per money movement**. A single interactive round can produce
several (Blackjack `DOUBLE`, staged Mines). This is the *ledger-level* measure — see §5.

| Metric | Formula | Source | Currency | Filters | Limitations |
|---|---|---|---|---|---|
| `transactionsByType` | `count(*)`, `SUM(amount)` `GROUP BY type_id, currency_id` | `wallet_transactions` | **per currency** | from, to, currency | `type` is the `transaction_types.code` (e.g. `GAME_BET`, `DEPOSIT`). Counts **all** transaction statuses in the window. Amounts are magnitudes as stored; direction is expressed by the type, not by a sign. |
| `depositsByStatus` | `count(*)`, `SUM(amount)` `GROUP BY status, currency_id` | `deposit_requests` | **per currency** | from, to, currency | Windowed on **request creation**, not on completion. A deposit created just before `to` and completed after it still appears here under its status at query time. |
| `withdrawalsByStatus` | `count(*)`, `SUM(amount)` `GROUP BY status, currency_id` | `withdrawal_requests` | **per currency** | from, to, currency | Same creation-time caveat. |
| `averageCompletedDeposit` | `AVG(amount) WHERE status = COMPLETED GROUP BY currency_id` | `deposit_requests` | **per currency** | from, to, currency | Mean, not median. |
| `averageCompletedWithdrawal` | `AVG(amount) WHERE status = COMPLETED GROUP BY currency_id` | `withdrawal_requests` | **per currency** | from, to, currency | Mean, not median. |
| `pendingCashier.deposits` | `count(*) WHERE status IN (PENDING, PROCESSING)` | `deposit_requests` | n/a | from, to, currency | Operational queue depth **within the window** — not the all-time backlog. |
| `pendingCashier.withdrawals` | `count(*) WHERE status IN (PENDING, UNDER_REVIEW)` | `withdrawal_requests` | n/a | from, to, currency | As above. |
| `feesByCurrency` | `SUM(fee)` over all transactions, `GROUP BY currency` | `wallet_transactions.fee` | **per currency** | from, to, currency | Fees **actually recorded on transactions**. This is **not** platform revenue, gross gaming revenue, or margin — no such definition is established (§6). |

---

## 3. Users — sources `users`, `game_rounds`, `deposit_requests`, `withdrawal_requests`, `login_history`

| Metric | Formula | Source | Currency | Filters | Limitations |
|---|---|---|---|---|---|
| `registered` | `count(*) WHERE deleted_at IS NULL` | `users` | n/a | **none — point-in-time** | Total live accounts now. Deliberately ignores `from`/`to`. |
| `byStatus` | `count(*) GROUP BY status WHERE deleted_at IS NULL` | `users` | n/a | **none — point-in-time** | — |
| `emailVerified` | `count(*) WHERE deleted_at IS NULL AND email_verified` | `users` | n/a | **none — point-in-time** | Email only. Not KYC/identity verification. |
| `playedInRange` | `count(DISTINCT user_id)` over rounds in window | `game_rounds` | n/a | from, to | **This is not DAU.** It is distinct players over the whole window, not a daily average. |
| `depositedInRange` | `count(DISTINCT user_id) WHERE status = COMPLETED` | `deposit_requests` | n/a | from, to | Completed deposits only. |
| `withdrewInRange` | `count(DISTINCT user_id) WHERE status = COMPLETED` | `withdrawal_requests` | n/a | from, to | Completed withdrawals only. |
| `loggedInInRange` | `count(DISTINCT user_id) WHERE success = true` | `login_history` | n/a | from, to | **Distinct successful logins — not DAU, not sessions, not visits.** A user who never logs out and stays active is counted once, or not at all. |
| `depositConversionRate` | `depositedInRange / registered` | derived | n/a | from, to | **`null` when `registered = 0`.** **This is DEPOSIT conversion only** — depositors in the window against *all* registered accounts, so its denominator is not cohort-matched to its numerator. It is **not** marketing/visitor conversion, which is unavailable (§6). |

---

## 4. Operations — sources `game_rounds`, `audit_trails`, `security_events`, `notifications`

| Metric | Formula | Source | Currency | Filters | Limitations |
|---|---|---|---|---|---|
| `pendingSettlements` | `count(*) WHERE status = PENDING_SETTLEMENT` | `game_rounds` | n/a | **none — point-in-time** | Current queue depth. |
| `recoveryFailed` | `count(*) WHERE status = RECOVERY_FAILED` | `game_rounds` | n/a | **none — point-in-time** | Rounds needing manual intervention. Should be watched, not just reported. |
| `recovering` | `count(*) WHERE status = RECOVERING` | `game_rounds` | n/a | **none — point-in-time** | — |
| `auditRecords` | `count(*)` in window | `audit_trails` | n/a | from, to | Counts the `audit_trails` store only. A second, separate audit store exists (`admin_audit_logs`) and is **not** included here — see limitation L3 below. |
| `auditByEntity` | `count(*) GROUP BY entity_type` | `audit_trails` | n/a | from, to | Same scope caveat. |
| `securityEvents` | `count(*)` in window | `security_events` | n/a | from, to | — |
| `securityByType` | `count(*) GROUP BY type` | `security_events` | n/a | from, to | — |
| `notifications` | `count(*) WHERE deleted_at IS NULL` | `notifications` | n/a | from, to | **Notifications created, i.e. in-app records written.** Not messages delivered to any external channel. |
| `notificationsUnread` | `count(*) WHERE deleted_at IS NULL AND read_at IS NULL` | `notifications` | n/a | from, to | Unread *as of now*, among notifications created in the window. |

---

## 5. Daily time series — `GET /analytics/daily`

| Metric | Formula | Source | Currency | Filters | Limitations |
|---|---|---|---|---|---|
| `rounds[]` | `count(*)`, `SUM(stake)`, `SUM(payout)` grouped by `date_trunc('day', created_at AT TIME ZONE 'UTC')` and currency, settled only | `game_rounds` | **per currency, per day** | from, to, currency, gameKey | **No zero-filling.** A date appears only because rows exist for it. A gap in the series means "no activity", and the dashboard must not draw it as a zero point. Days are UTC calendar days. |
| `cashier[]` | Completed deposits and withdrawals per UTC day and currency, `FULL OUTER JOIN`ed so a day with only one side still appears | `deposit_requests`, `withdrawal_requests` | **per currency, per day** | from, to, currency | Windowed on **creation date**, filtered to `COMPLETED`. Deposits and withdrawals for the same day/currency are reported as separate figures and are **never netted** into a single "net flow" number. |

### 5.1 Game-level ≠ ledger-level (the most important caveat on this dashboard)

`gaming.stakeByCurrency` and `financial.transactionsByType[GAME_BET]` **are not the same measure and
are not expected to match.** `game_rounds` has one row per round; `wallet_transactions` has one row
per money movement, and interactive games produce several per round. Presenting either as the other
would misstate volume. The dashboard labels the financial tables *"ledger-level"* and states this
explicitly in the UI. Detail and verification: [PHASE_2D6_AUDIT.md §3](PHASE_2D6_AUDIT.md).

---

## 6. Metrics that are NOT AVAILABLE, and why

Returned in `meta.unavailable` on **every** response so a client can render the reason rather than a
zero. Each reason names the missing source, verified empty in the audit.

| Metric | Status | Reason |
|---|---|---|
| `dau` | **NOT AVAILABLE — SOURCE DATA NOT PRESENT** | No activity event pipeline. `page_views`, `player_sessions`, `user_activities` are empty. Login counts are **not** DAU. |
| `mau` | **NOT AVAILABLE — SOURCE DATA NOT PRESENT** | Same missing pipeline as DAU. |
| `retention` | **NOT AVAILABLE — SOURCE DATA NOT PRESENT** | No activity events to build cohorts from. |
| `ltv` | **NOT AVAILABLE — SOURCE DATA NOT PRESENT** | Requires lifetime activity and attribution that are not persisted. |
| `sessionTime` | **NOT AVAILABLE** | `sessions.last_activity_at` advances only on **token rotation**, so any duration would measure refresh cadence, not user behaviour. Reporting it would be misleading, not merely imprecise. |
| `bounceRate` | **NOT AVAILABLE — SOURCE DATA NOT PRESENT** | `page_views` is empty. |
| `revenue` | **NOT AVAILABLE** | No accounting definition of revenue is established for this platform. Stake volume and ledger volume are reported instead, **under their own names**. |
| `expenses` | **NOT AVAILABLE — SOURCE DATA NOT PRESENT** | There is no expense model in the schema. |
| `profit` | **NOT AVAILABLE** | Blocked by `expenses`. Profit is **not** inferred from `deposits − withdrawals` or `stakes − payouts`; neither is profit. |
| `partnerProfit` | **NOT AVAILABLE — SOURCE DATA NOT PRESENT** | No partner entity exists in the schema. |
| `consolidatedCurrencyTotal` | **NOT AVAILABLE** | `exchange_rates` is empty and nothing writes it. Totals are per currency and never combined. |
| `marketingConversion` | **NOT AVAILABLE — SOURCE DATA NOT PRESENT** | The visitor funnel needs `page_views`, which is empty. `depositConversionRate` is a different, explicitly-named metric and is not a substitute. |

**BUSINESS-CONFIG / DATA-SOURCE REQUIRED** to unblock these: an activity-event pipeline (DAU/MAU/
retention/bounce/session time), an accounting definition plus an expense model (revenue/expenses/
profit), a partner entity (partner profit), and an FX-rate source (consolidated totals). None of
these are invented here.

---

## 7. Known limitations of this analytics layer

- **L1 — No caching or materialisation.** Every request aggregates live. Wide ranges over a large
  `game_rounds` table will get slower; the 366-day cap is the only bound. No pre-aggregation exists.
- **L2 — Creation-time windowing on cashier data.** Deposits and withdrawals are windowed by
  `created_at`, not by completion time, so a request that spans the window boundary is attributed to
  the day it was *created*.
- **L3 — Audit counts cover one of two stores.** `operations.auditRecords` counts `audit_trails`
  only; `admin_audit_logs` is a separate store and is not included. The figure is therefore a
  **lower bound** on total audit coverage, not a total.
- **L4 — Win/loss/tie is derived from money, not stored.** A game whose semantics differ from
  "payout vs stake" (e.g. a push handled as a partial return) is classified by its money result.
- **L5 — Averages are means.** No medians, percentiles, or distributions are computed.
- **L6 — `payoutToStakeRatio` is realised, not theoretical.** It is not certified RTP and must not be
  published as such.
- **L7 — Point-in-time metrics ignore the date filter** by design (marked "none — point-in-time"
  above). An operator changing the range will correctly see these figures stay still.
- **L8 — No per-user drill-down.** These are platform aggregates. No endpoint returns a user id,
  email, or any per-player row (asserted by test).

---

## 8. Access control

| Property | Enforcement |
|---|---|
| Authentication | Global `JwtAuthGuard`; no analytics route is public. |
| Authorisation | `@RequirePermissions(PERMISSIONS.ANALYTICS_READ)` on the controller — server-side, on every route. |
| Admin 2FA | Subject to the global `AdminTwoFactorGuard` chain established in Phase 2D.2. |
| Demo sessions | `/analytics` is in the frontend's `DEMO_BLOCKED_PATHS`; a demo session cannot issue an analytics request at all. |
| Mutation | **None exists.** Every analytics route is `GET`. Proven by unit test (the service is constructed against a Prisma mock exposing only read methods, and `create/update/delete/upsert` assert `undefined`) and by integration test (balances, ledger totals, transaction and round counts are byte-identical before and after running every analytics query). |
