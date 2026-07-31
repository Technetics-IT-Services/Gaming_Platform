# Performance Engineering Guide (Phase 11)

> Tooling + methodology only — no business, financial or architectural change. Module:
> `apps/frontend/src/lib/perf/`. Companion docs: `docs/QUALIFICATION_REPORT.md`,
> `docs/CAPACITY_REPORT.md` (and Phase-10 `docs/SRE_HANDBOOK.md`).

## Toolkit

| Concern | Tool | Notes |
|---|---|---|
| Benchmarks (STEP 1) | `Benchmark` / `BenchmarkSuite` | warmup + N iterations, injectable clock, ops/sec + percentiles |
| Latency histogram (STEP 5) | `LatencyHistogram` | nearest-rank P50/P90/P95/P99/max/mean |
| Synthetic traffic (STEP 1) | `arrivalSchedule` | steady / burst / ramp / mixed patterns |
| Load testing (STEP 2) | `runLoad` | closed-loop concurrency → throughput + error rate + latency |
| Stress testing (STEP 3) | `stressRamp` | ramp concurrency to the SLO "knee" |
| Soak / leak detection (STEP 4) | `analyzeTrend` / `soakReport` | least-squares slope + R² → leak flag |
| Profiling (STEP 6) | `Profiler` / `QueryProfiler` / `CacheStats` | span timing, top-N queries, cache hit ratio |
| Regression (STEP 8) | `RegressionChecker` | baseline compare + thresholds + trend |
| Qualification (STEP 7/9) | `qualify` / `scorecardReport` | grade vs targets → scorecard |

## Methodology

1. **Benchmark** hot paths with warmup to steady state; report ops/sec + p95/p99.
2. **Load test** at expected concurrency; confirm throughput and error rate.
3. **Stress test** past capacity to find the knee (`stressRamp`).
4. **Soak** long-duration; assert no memory/connection/queue leak (`analyzeTrend`).
5. **Profile** to attribute latency (CPU/query/cache) and find hotspots.
6. **Qualify** against production targets; **regression-gate** every release vs the baseline.

## Determinism

Every tool takes an injectable clock and ops report their own measured latency, so CI runs are
**deterministic** (no wall-clock flakiness). Real runs bind `performance.now()` and ops that measure
actual wall time around a frozen-platform call.

## Ownership rule

Perf tooling **wraps and measures** — it never modifies the code under test. The frozen ledger
micro-benchmark asserts `ledger.reconcile().systemSum === 0` after the run: **measuring must never
perturb financial integrity.**
