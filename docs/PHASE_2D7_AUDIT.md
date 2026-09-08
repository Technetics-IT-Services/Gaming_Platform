# Phase 2D.7 — Audit & Capability Matrix (before code)

**Evidence gathered by inspecting the repository and querying the live disposable database
(`gp_phase1_pg`:55432), not by assuming.** Companions:
[PHASE_2D7_IMPLEMENTATION.md](PHASE_2D7_IMPLEMENTATION.md),
[PHASE_2D7_REPORT_DEFINITIONS.md](PHASE_2D7_REPORT_DEFINITIONS.md),
[PHASE_2D7_PERFORMANCE.md](PHASE_2D7_PERFORMANCE.md),
[PHASE_2D7_SECURITY_TESTS.md](PHASE_2D7_SECURITY_TESTS.md),
[PHASE_2D7_FINAL_REPORT.md](PHASE_2D7_FINAL_REPORT.md).

---

## 1. Starting point (verified, not assumed)

| Area | State found |
|---|---|
| Analytics service/controller | 7 read-only routes, `analytics:read`, verified 26/26 against SQL in Phase 2D.6 |
| Range ceiling | **Hardcoded** `MAX_RANGE_DAYS = 366` in the DTO — not configurable |
| Caching | **None.** Every request aggregates live (2D.6 limitation L1) |
| Redis | `RedisService` + `RedisModule` exist; `GameCacheService` shows an established read-through `wrap()` pattern with epoch invalidation |
| CSV / export utility (backend) | **NONE.** No `csv`, `StreamableFile`, `Content-Disposition` or `attachment;` anywhere in `apps/backend/src` |
| Export dependency | **NONE.** No `exceljs`, `papaparse`, `json2csv`, `fast-csv`, `csv-stringify`, `xlsx`, `pdfkit` in any package.json |
| File-generation infrastructure | **NONE** |
| CSV code in the repo | Only in `apps/frontend/src/lib/{analytics,operations,partners}/` — the **orphaned simulation** libraries proven dead in Phase 2C.18. Not usable: client-side, fabricated data |
| Connection pool | Not tuned; Prisma default, `datasources.db.url` only |

**Consequence:** there was nothing to reuse for export. A dependency-free writer was built (60 lines)
rather than adding a library for one file format.

## 2. Source-of-truth confirmation (live row counts at audit time)

| Table | Rows | Authoritative? |
|---|---|---|
| `game_rounds` | 6,048 | yes — game-level, one row per round |
| `wallet_transactions` | 15,7xx+ | yes — ledger-level, one row per movement |
| `deposit_requests` / `withdrawal_requests` | 61 / 189 (grown since) | yes |
| `users` | 2,040+ | yes |
| `audit_trails` | 466 | yes — **the platform's only ACTIVE audit store** |
| `security_events` | 475+ | yes |
| `notifications` | 466+ | yes |
| `login_history` | 283+ | yes (login events only) |
| **`admin_audit_logs`** | **0** | **DORMANT — see §3** |
| **`admin_users`** | **0** | dormant (FK target of the above) |
| `exchange_rates` | 0 | **NO FX SOURCE — unchanged from 2D.6** |

No new data source appeared, so **no previously-unavailable business metric became available.**
DAU, MAU, retention, LTV, revenue, expenses, profit, partner profit, FX-consolidated totals,
marketing conversion, session time and bounce rate all remain **NOT AVAILABLE**.

---

## 3. PART D — the two audit stores: relationship DETERMINED, not assumed

Four independent probes:

| # | Probe | Result |
|---|---|---|
| 1 | **Writers in code.** `grep` for every Prisma write across `apps/backend/src` | `audit_trails`: **exactly one** writer — `AuditService.record` → `auditTrail.create`. `admin_audit_logs`: **ZERO writers.** The only references anywhere are the two `count()` reads added in this phase. |
| 2 | **Rows.** Live counts | `audit_trails` = 466. `admin_audit_logs` = **0 all-time**. `admin_users` = 0. |
| 3 | **Subject.** Foreign keys, from `information_schema` | `audit_trails.user_id → users.id`; `admin_audit_logs.admin_id → admin_users.id`. **Different subject tables.** |
| 4 | **Correlating key.** Shared columns | Shared columns are only `id`, `action`, `created_at`, `ip_address`. The object identifiers differ entirely: `entity_type`/`entity_id` versus `resource`/`resource_id`. **No shared identifier, no FK between the tables.** |

### Verdict

They are **complementary stores that CANNOT BE SAFELY COMBINED.**

Probe 4 is the decisive one, and it is a **permanent property of the schema**, not a temporary
consequence of one store being empty: with no correlating key, if both were ever populated there
would be no way to detect or remove an overlapping event.

Additional finding, which is why a `0` would be a lie: **`audit_trails` demonstrably contains
admin-initiated actions.** Live rows for `admin@money.local` include:

```
admin_session      | LOGIN   | 52
withdrawal_request | APPROVE | 6
withdrawal_request | REJECT  | 3
deposit_request    | APPROVE | 3
user_role          | UPDATE  | 1
two_factor         | UPDATE  | 1
withdrawal_request | EXECUTE | 1
```

### Correction to a Phase 2D.6 statement

Phase 2D.6 recorded limitation **L3** as *"`auditRecords` counts `audit_trails` only … the figure is
a lower bound, not a total."* That wording implied uncounted audit records exist elsewhere. **They do
not.** `admin_audit_logs` has never been written and has no writer, and admin actions are captured in
`audit_trails`. The accurate statement is the one above: one active store, one dormant store, no safe
combination. This is corrected in the 2D.7 documentation rather than left standing.

### Semantics implemented

| Field | Value | Why |
|---|---|---|
| `auditTrailRecords` | real count | the active store |
| `adminAuditRecords` | **`null`** while dormant (real count if rows ever appear) | `0` would read as "no admin actions were audited" — false |
| `totalAuditRecords` | **`null`, always** | no correlating key ⇒ overlap can never be ruled out. **No fabricated total.** |

---

## 4. Capability matrix

| Capability | Existing implementation | Authoritative source | Current performance | Security requirement | Limitation found | 2D.7 action |
|---|---|---|---|---|---|---|
| Live analytics aggregation | 2D.6 service, 7 routes | `game_rounds`, `wallet_transactions`, cashier, `users`, audit | seq scans; `users()` grew RSS **+11.5 MB** per 366-day call | `analytics:read`, read-only | rows loaded into Node scale with the user base | **Fixed** — `count(DISTINCT …)` in Postgres |
| Range ceiling | hardcoded 366 | n/a | bounds scan size | must reject, not truncate | not configurable per deployment | **`ANALYTICS_MAX_RANGE_DAYS`** env knob |
| Caching | none | n/a | measured after fix: full dashboard **p95 22.9 ms** | must never cache authz or cross-user data | none needed | **NOT ADDED — evidence says no** (§ Performance doc) |
| Audit counts | `audit_trails` only | `audit_trails` | trivial | must not fabricate | 2D.6 L3 mis-stated the gap | **Truthful split; no total** |
| Reports | **none** | analytics service | n/a | `analytics:read` | no report layer existed | **6 report types built** |
| CSV export | **none anywhere** | analytics service | n/a | formula injection, filename safety, no secrets | no utility, no dependency | **Dependency-free writer + escaping** |
| Player-facing export | none | n/a | n/a | strict `@CurrentUser` scoping | **not required by the client requirements** | **NOT BUILT** (§5) |
| Indexes on `created_at` | absent (only `(user_id, created_at)`) | n/a | seq scans confirmed by `EXPLAIN` | n/a | analytics filters by `created_at` alone | **Measured & recommended, NOT applied** (financial schema is frozen) |

---

## 5. PART H — player-facing exports: NOT required, therefore NOT built

Checked against the strongest available requirement source (the Phase 2C.16 transcription of the
client's own enumeration, per `PHASE_2C18_FULL_REQUIREMENT_AUDIT.md` §1):

- "reports" appears under **ADMIN** (§4.3), **SUPER ADMIN** (§4.4) and **Finance** ("report export", §4.x).
- Player-side requirements list **wallet history** and **transaction history** — both already GREEN
  and already server-authoritative.
- **No player-facing report or export requirement exists.**

Per the brief ("Only implement player-facing exports if the client requirements actually require
them"), none was built. No endpoint in this phase accepts a user selector of any kind.

---

## 6. STOP-check — was any report blocked by a missing source?

| Candidate report | Source | Decision |
|---|---|---|
| Financial activity (ledger) | `wallet_transactions`, cashier tables | **BUILT** |
| Gaming activity (game-level) | `game_rounds` | **BUILT** |
| Cashier | `deposit_requests`, `withdrawal_requests` | **BUILT** |
| Operations / recovery | `game_rounds` statuses, `notifications` | **BUILT** |
| User activity | `users`, `login_history`, cashier, `game_rounds` | **BUILT** |
| Security & audit | `audit_trails`, `security_events` | **BUILT** (admin store reported as unavailable) |
| **Revenue / P&L report** | none — no accounting definition, no expense model | **NOT BUILT** |
| **Partner report** | none — no partner entity in any schema file | **NOT BUILT** |
| **Retention / cohort report** | none — `page_views`, `player_sessions`, `user_activities` all empty | **NOT BUILT** |
| **Consolidated multi-currency report** | none — `exchange_rates` empty | **NOT BUILT** |

Four candidate reports were stopped at the audit for want of a source, exactly as the brief requires.
