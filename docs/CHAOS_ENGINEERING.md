# Chaos Engineering Guide (Phase 10, STEP 7)

Backed by `src/lib/resilience/chaos.ts`. Fault injection + experiment runner to *validate* the
resilience wrappers. **Test/staging tooling only** — never enabled on production request paths, and it
touches no business or financial logic.

## Principles

1. Define **steady state** (a measurable "healthy" signal — SLI within SLO, queue drained, reconcile == 0).
2. Hypothesize the system **stays in steady state** under a fault.
3. Inject the smallest real-world fault; observe.
4. **Always roll back** (the runner guarantees it).
5. Automate + widen the blast radius gradually; run as scheduled game-days.

## Failure injection

`FailureInjector.wrap(op)` applies the active `FailureProfile` to any async call: added **latency**,
probabilistic **errors**, or a hard **outage**. Category simulators (`simulate.*`):

| Category | Simulator | Validates |
|---|---|---|
| Network latency | `simulate.networkLatency(ms)` | timeouts + budgets hold |
| Dependency outage | `simulate.dependencyOutage()` | circuit opens; fallback serves |
| Intermittent errors | `simulate.intermittentErrors(p)` | retries within budget succeed |
| Queue saturation | `simulate.queueSaturation()` | backpressure sheds non-critical |
| Database outage | `simulate.databaseOutage()` | degraded/read-only mode; money fails closed |
| Worker crash | `simulate.workerCrash()` | jobs recovered from processing list; leader failover |

## Experiment runner

```ts
const injector = new FailureInjector();
const exp = new ChaosExperiment(injector, () => sli() >= target); // steady state
const result = await exp.run({
  name: 'paypal-outage',
  profile: simulate.dependencyOutage(),
  probe: async () => {
    const out = await withFallback(() => injector.wrap(() => paypal.health()), () => 'degraded');
    return out === 'degraded';           // handled gracefully, not a crash
  },
});
// result.survived === true, result.steadyStateAfter === true (fault rolled back)
```

The runner: verify steady state → inject → probe → **roll back** → re-verify. `survived` means the
hypothesis held under fault (graceful degradation, not breakage).

## Game-day catalog

| Experiment | Fault | Expected |
|---|---|---|
| Gateway outage | dependency outage on a payment adapter | circuit opens, deposits queued/failed-closed, no double-credit |
| Slow DB | +500ms latency on reads | timeouts trip, reads shed to replica/cache, writes unaffected |
| Redis primary loss | outage on cache/queue | Sentinel failover; queues resume from AOF |
| Zone loss | drain a zone's nodes | PDB + spread keep quorum; no request errors |
| Worker crash | kill workers mid-job | in-flight jobs recovered from processing list |
| Traffic spike | 3× RPS | HPA scales; adaptive limiter shapes; SLO within budget |

Every game-day ends by asserting **`ledger.reconcile().systemSum === 0`** — resilience must never
compromise financial integrity.
