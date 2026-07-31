# Load, Stress & Soak Testing Guide (Phase 11, STEP 2–4)

How to exercise the platform with `src/lib/perf/workload.ts` + `soak.ts`. In-repo simulations are
deterministic; staging runs bind ops to real, wall-clock-measured calls (k6/Gatling for HTTP,
the `runLoad` harness for library/worker paths).

## Workload patterns (STEP 2)

`arrivalSchedule(pattern)` produces request-arrival offsets:

- **Steady** — constant RPS for a duration (baseline capacity).
- **Burst** — a base rate with a spike window (event-night / flash traffic).
- **Ramp** — linearly increasing RPS (find the scaling response).
- **Mixed** — concatenated segments (a realistic daily curve).

Workload mix to cover: **API** (read + write), **worker** (job processing), **background jobs**
(scheduled), and **concurrent users** (mixed sessions).

## Load testing (STEP 2)

```ts
const op: LoadOp = async () => {
  const t0 = performance.now();
  const ok = await callApi();               // real frozen-platform call
  return { ok, latencyMs: performance.now() - t0 };
};
const res = await runLoad(op, { requests: 100_000, concurrency: 200 });
// res.throughputPerSec, res.errorRate, res.latency.{p50,p95,p99}
```
Closed-loop: `concurrency` virtual users issue requests until the count is met; throughput is derived
from concurrency ÷ mean latency (Little's Law).

## Stress testing (STEP 3)

`stressRamp(makeOp, { startConcurrency, step, maxConcurrency, sloP95Ms })` ramps until p95 breaches the
SLO or errors exceed the ceiling — returning the **sustainable knee** and the breach point. Targets:

| Dimension | Injected via |
|---|---|
| Traffic beyond capacity | rising `concurrency` |
| Queue saturation | Phase-10 `simulate.queueSaturation()` behind the op |
| Connection exhaustion | pool model in the op (reject past N) |
| Memory / CPU pressure | latency that grows with load in `makeOp(c)` |
| Database / Redis pressure | query latency model / `simulate.databaseOutage()` |

## Soak testing (STEP 4)

Run a long, steady workload while sampling memory, DB connections and queue depth. Feed the series to
`soakReport({ memory, connections, queueDepth })`: `analyzeTrend` runs least-squares regression and
flags a **leak** on a strong positive slope (slope > threshold, R² ≥ 0.8). `stable === true` means no
memory/connection leak and no unbounded queue growth over the window.

## Pass/fail gates

- Load: error rate ≤ 0.1%, p95 within SLO at target concurrency.
- Stress: knee ≥ (peak-expected concurrency × headroom).
- Soak: `stable === true`; `ledger.reconcile().systemSum === 0` at the end.
