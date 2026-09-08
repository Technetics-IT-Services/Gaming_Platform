# Phase 2D.7 — Performance Benchmarks

**These are BENCHMARK RESULTS ON A SYNTHETIC DATASET. They are not a production capacity claim.**
See §6 for exactly what they do and do not establish.

---

## 1. Method

| Aspect | Detail |
|---|---|
| Harness | Boots the **real Nest application context** and times the **real `AnalyticsService` methods** — not a re-implementation, not raw SQL |
| Database | An **isolated** database, `gaming_platform_bench`, created in the same container. **The live disposable database was never used for benchmarking**, so its financial reconcile stayed valid throughout |
| Data | Synthetic rows with the same columns, enums and status/currency/game distributions as real ones, spread over 365 days. **Not real activity** |
| Ranges | 1 / 7 / 30 / 90 / 366 days |
| Runs | 2 warm-up + 12 measured per (method, range) |
| Metrics | p50, p95, max (ms); serialised payload size (bytes); RSS delta (MB) across the 12 runs, with `--expose-gc` |
| Host | Windows 11, Postgres 16 in Docker (`gp_phase1_pg`), single Node process |

### Dataset (matches the brief's Part P minimums)

| Table | Rows |
|---|---|
| `game_rounds` | **10,000** |
| `wallet_transactions` | **50,000** |
| `deposit_requests` | **10,000** |
| `withdrawal_requests` | **10,000** |
| `audit_trails` | **10,000** |
| `security_events` | 10,000 |
| `notifications` | 10,000 |
| `login_history` | 10,000 |
| `users` | 5,000 |

---

## 2. Baseline — BEFORE the Phase 2D.7 fix

Indexes as in production (no `created_at` index). Abridged; the full matrix is in §4.

| Method | Range | p50 | p95 | max | RSS delta |
|---|---|---|---|---|---|
| gaming | 366d | 5.4 ms | 6.5 ms | 6.5 ms | +0.4 MB |
| financial | 366d | 18.4 ms | 19.8 ms | 19.8 ms | +0.3 MB |
| **users** | **366d** | **19.0 ms** | **21.4 ms** | 21.4 ms | **+11.5 MB** |
| daily | 366d | 15.7 ms | 24.5 ms | 24.5 ms | +0.1 MB |
| **summary** (full dashboard) | **366d** | **31.8 ms** | **335.4 ms** | **335.4 ms** | **+39.0 MB** |

### The finding

`users()` allocated **+11.5 MB per call** at a 366-day range, and dominated `summary()`, whose p95
spiked to **335 ms** — a garbage-collection pause caused by that allocation, not by the database.

**Cause, identified by reading the code rather than guessing:** four metrics were computed as

```ts
this.prisma.gameRound.findMany({ where: inRange, distinct: ['userId'], select: { userId: true } })
```

…and then only `.length` was read. That transfers **one row per distinct user** into Node to produce
a single number. Memory therefore scaled with the size of the user base.

An `EXPLAIN (ANALYZE, BUFFERS)` on the stake aggregation confirmed a **Seq Scan** (7.9 ms at 6 k
rows) — real, but a second-order effect next to the row transfer.

---

## 3. AFTER the fix — `count(DISTINCT …)` in Postgres

The four `findMany({ distinct })` calls became parameterised `count(DISTINCT user_id)` raw queries.
Identical schema, identical dataset, **no new indexes**:

| Method | Range | p50 | p95 | max | RSS delta |
|---|---|---|---|---|---|
| gaming | 366d | 5.4 ms | 6.0 ms | 6.0 ms | +0.3 MB |
| financial | 366d | 18.1 ms | 19.2 ms | 19.2 ms | +0.0 MB |
| **users** | **366d** | **3.6 ms** | **4.2 ms** | 4.2 ms | **+0.0 MB** |
| daily | 366d | 14.8 ms | 16.4 ms | 16.4 ms | +0.3 MB |
| **summary** (full dashboard) | **366d** | **13.5 ms** | **22.9 ms** | **22.9 ms** | **+0.0 MB** |

### Measured improvement (code change only, no schema change)

| Metric | Before | After | Change |
|---|---|---|---|
| `users` @366d p50 | 19.0 ms | 3.6 ms | **5.3× faster** |
| `users` @366d RSS | +11.5 MB | +0.0 MB | **eliminated** |
| `summary` @366d p50 | 31.8 ms | 13.5 ms | **2.4× faster** |
| `summary` @366d p95 | 335.4 ms | 22.9 ms | **14.6× faster** |
| `summary` @366d RSS | +39.0 MB | +0.0 MB | **eliminated** |

The p95 spike disappeared because the allocation that caused the GC pause is gone. This matters far
more than the millisecond figures: memory that scales with the user base is the failure mode that
would actually bite in production.

---

## 4. Full matrix after the fix (no added indexes)

| Method | 1d | 7d | 30d | 90d | 366d | payload @366d |
|---|---|---|---|---|---|---|
| gaming | 3.9 | 3.5 | 3.6 | 3.7 | 5.4 ms | 1,175 B |
| financial | 5.8 | 5.0 | 5.6 | 7.0 | 18.1 ms | 1,790 B |
| users | 1.9 | 1.4 | 1.5 | 1.9 | 3.6 ms | 221 B |
| operations | 2.1 | 1.6 | 1.6 | 1.6 | 2.8 ms | 381 B |
| daily | 3.0 | 3.2 | 3.8 | 6.2 | 14.8 ms | **131,165 B** |
| **summary** | 8.9 | 7.0 | 8.4 | 9.5 | **13.5 ms** | 5,487 B |

(p50, milliseconds.) **Worst p95 across every method and range: 22.9 ms.**

`daily` @366d has the largest payload (128 KB) because it returns one row per UTC day per currency —
by design, and never zero-filled.

---

## 5. Index experiment — measured, and deliberately NOT applied

Adding `created_at` indexes to the eight source tables in the benchmark database:

| Method @366d | No index | With `created_at` index |
|---|---|---|
| gaming | 5.4 ms | 7.1 ms (no gain) |
| **financial** | 18.1 ms | **10.0 ms (1.8×)** |
| users | 3.6 ms | 3.6 ms (no gain — already a DB-side count) |
| daily | 14.8 ms | 17.4 ms (no gain) |
| summary | 13.5 ms | 11.8 ms (1.1×) |

**Decision: NOT APPLIED.** Two reasons, stated plainly:

1. The tables involved (`game_rounds`, `wallet_transactions`, `deposit_requests`,
   `withdrawal_requests`) are **financial schema, which this phase must not modify.**
2. At the benchmarked volume the gain is not needed — the full dashboard is already 13.5 ms p50.

**Recorded as a measured recommendation for a future phase**, with the evidence above, rather than
implemented speculatively. The one clearly worthwhile index is
`wallet_transactions(created_at)`, which is where the 1.8× came from.

---

## 6. PART C — caching decision: **NOT ADDED**

The brief said to add Redis caching *only if benchmarks prove it materially helps*, and to document
the reasoning if not.

**Evidence:** after the Part A fix, the complete operator dashboard at the maximum permitted
366-day range has **p50 13.5 ms and p95 22.9 ms**, with no measurable memory growth.

**Why caching was rejected:**

- A Redis round-trip on this host is ~1 ms, so the ceiling on any saving is roughly 20 ms.
- Cached financial figures go **stale**. An operator looking at deposits and withdrawals seeing a
  figure from up to N seconds ago is a real correctness cost, paid for a 20 ms latency gain.
- A cache key must encode range, currency, gameKey and report type. Getting that wrong leaks one
  filter's numbers into another's view — a *correctness* failure mode introduced to solve a
  performance problem that the measurements say does not exist.
- The infrastructure exists (`RedisService`, `GameCacheService`'s epoch pattern), so this can be
  revisited cheaply if real production volume changes the numbers.

**No caching was added. This is an evidence-based decision, not an omission.**

---

## 7. Export size (Part M)

Every report is an **aggregate** (grouped by currency/status/type/day), so row counts are bounded by
the number of distinct groups, not by table size.

| Measurement | Value |
|---|---|
| Largest export measured (financial, maximum permitted 366-day range, live DB) | **2,149 bytes** |
| `MAX_REPORT_ROWS` ceiling | 50,000 rows |
| Behaviour at the ceiling | **`400` rejection stating "The report was NOT truncated"** — never silent truncation |
| Streaming | **Not implemented, and not needed** at these sizes. Documented as a limitation rather than claimed |

The practical guard against an unbounded export is the **range ceiling** (`ANALYTICS_MAX_RANGE_DAYS`,
default 366), verified live: an 11-year request returns `400` on both the JSON and CSV routes.

---

## 8. What these benchmarks DO and DO NOT establish

**They establish:**

- A real, reproducible memory defect existed in `users()` and is fixed, with before/after numbers
  from the same harness on the same data.
- At 10 k rounds / 50 k transactions, no analytics or report query is slow, and none allocates
  per-user memory.
- Adding a `created_at` index helps `financial` by ~1.8× and little else.

**They DO NOT establish:**

- **Production capacity.** This is one Node process, one Postgres container, one concurrent caller,
  and **synthetic** data. Nothing here says what happens at 10 M rounds or under concurrent operator
  load.
- **Behaviour under concurrency.** No load test, no soak test, no connection-pool saturation test was
  performed. **NOT VERIFIED.**
- **Real-world data distribution.** Synthetic rows are uniformly spread over 365 days; real activity
  is bursty, which changes both cache behaviour and index selectivity.

**Limitation L1 from Phase 2D.6 is therefore NARROWED, not closed:** analytics still aggregate live
with no caching, and that remains untested under concurrent production load.
