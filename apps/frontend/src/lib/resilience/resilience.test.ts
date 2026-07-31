import { describe, expect, it, vi } from 'vitest';

import { sizeConnectionPool, sizeReplicas, sizeWorkers, planPeak, estimateCost, projectGrowth } from './capacity';
import { ChaosExperiment, FailureInjector, simulate } from './chaos';
import { EndpointState, HealthBasedRouter, InMemoryLeaseStore, LeaderElection } from './ha';
import { AdaptiveRateLimiter, BackpressureMonitor, DegradationRegistry, LoadLevel } from './load-shedding';
import { Bulkhead, CircuitBreaker, CircuitState, RetryBudget, withFallback, withTimeout } from './patterns';
import { Resilience } from './resilient';
import { SLOTracker, SREPlatform } from './sre';

/**
 * Scalability, HA & resilience platform (Phase 10). Deterministic (injected clocks/
 * delays) tests for circuit breakers, bulkheads, timeouts, retry budgets, fallbacks,
 * adaptive rate limiting, backpressure, degradation, leader election, health routing,
 * chaos experiments, capacity math and the SLO/error-budget engine. Pure wrappers —
 * no business or financial logic is touched.
 */

describe('circuit breaker', () => {
  it('opens after the failure threshold, short-circuits, then half-opens + closes', async () => {
    let t = 0;
    const cb = new CircuitBreaker('dep', { failureThreshold: 3, openMs: 1000, halfOpenTrials: 1, clock: () => t });
    const boom = () => Promise.reject(new Error('x'));
    for (let i = 0; i < 3; i += 1) await expect(cb.exec(boom)).rejects.toThrow('x');
    expect(cb.getState()).toBe(CircuitState.Open);
    // short-circuits while open
    await expect(cb.exec(() => Promise.resolve('ok'))).rejects.toMatchObject({ code: 'circuit_open' });
    expect(cb.stats.shortCircuited).toBe(1);
    // after openMs → half-open → a success closes it
    t = 1000;
    expect(cb.getState()).toBe(CircuitState.HalfOpen);
    await expect(cb.exec(() => Promise.resolve('ok'))).resolves.toBe('ok');
    expect(cb.getState()).toBe(CircuitState.Closed);
  });
});

describe('bulkhead', () => {
  it('caps concurrency and rejects past the queue limit', async () => {
    const bh = new Bulkhead('db', 1, 0); // 1 concurrent, no queue
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p1 = bh.exec(() => gate.then(() => 'a')); // occupies the slot
    await expect(bh.exec(() => Promise.resolve('b'))).rejects.toMatchObject({ code: 'bulkhead_full' });
    release();
    await expect(p1).resolves.toBe('a');
  });
});

describe('timeout', () => {
  it('times out a slow op (injected delay) and passes a fast one', async () => {
    const immediate = (_ms: number) => Promise.resolve();
    await expect(withTimeout(() => new Promise(() => {}), 50, { delay: immediate })).rejects.toMatchObject({ code: 'timeout' });
    const never = (_ms: number) => new Promise<void>(() => {});
    await expect(withTimeout(() => Promise.resolve('fast'), 50, { delay: never })).resolves.toBe('fast');
  });
});

describe('retry budget', () => {
  it('limits retries to the configured ratio', () => {
    const t = 0;
    const rb = new RetryBudget({ ratio: 0.5, minPerSec: 1, clock: () => t });
    // start with minPerSec=1 token; each request adds 0.5
    rb.onRequest(); // 1 + 0.5 = 1.5
    expect(rb.canRetry()).toBe(true); // 0.5 left
    expect(rb.canRetry()).toBe(false); // budget exhausted
  });
});

describe('fallback', () => {
  it('runs the fallback when the primary fails', async () => {
    const r = await withFallback<string>(() => Promise.reject(new Error('down')), () => 'cached');
    expect(r).toBe('cached');
  });
});

describe('composed Resilience wrapper', () => {
  it('retries a retryable failure within budget, then succeeds', async () => {
    let n = 0;
    const res = new Resilience('svc', { maxAttempts: 3, timeoutMs: 1000, delay: () => new Promise<void>(() => {}), backoff: async () => undefined, retryBudget: new RetryBudget({ ratio: 5, minPerSec: 10, clock: () => 0 }) });
    const out = await res.run(async () => {
      n += 1;
      if (n < 3) throw new Error('flaky');
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(n).toBe(3);
  });

  it('falls back when the circuit is open', async () => {
    const res = new Resilience('svc2', { circuit: { failureThreshold: 1, openMs: 10_000, clock: () => 0 }, maxAttempts: 1, delay: () => new Promise<void>(() => {}) });
    await expect(res.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom'); // trips
    const out = await res.run(() => Promise.reject(new Error('boom')), () => 'degraded');
    expect(out).toBe('degraded');
  });
});

describe('adaptive rate limiter + backpressure + degradation', () => {
  it('adapts the rate down on overload and up when healthy', () => {
    const rl = new AdaptiveRateLimiter({ baseRatePerSec: 100, clock: () => 0 });
    rl.onOverload();
    expect(rl.currentRate()).toBe(50);
    rl.onHealthy();
    expect(rl.currentRate()).toBeGreaterThan(50);
    expect(rl.tryAcquire()).toBe(true);
  });

  it('sheds low-priority load first, keeps critical during shedding', () => {
    const bp = new BackpressureMonitor({ warn: 100, shed: 1000 });
    expect(bp.level(50)).toBe(LoadLevel.Normal);
    expect(bp.admit(150, 'low')).toBe(false); // elevated drops low
    expect(bp.admit(150, 'normal')).toBe(true);
    expect(bp.admit(1500, 'normal')).toBe(false); // shedding drops normal
    expect(bp.admit(1500, 'critical')).toBe(true); // money paths survive
  });

  it('flips a feature into a degraded mode', () => {
    const reg = new DegradationRegistry(() => 0);
    reg.degrade('recommendations', 'disable');
    expect(reg.isDegraded('recommendations')).toBe(true);
    expect(reg.strategyFor('recommendations')).toBe('disable');
    reg.restore('recommendations');
    expect(reg.isDegraded('recommendations')).toBe(false);
  });
});

describe('leader election', () => {
  it('elects one leader; a follower takes over after the lease expires', () => {
    let t = 0;
    const store = new InMemoryLeaseStore();
    const a = new LeaderElection('scheduler', 'node-a', store, 1000, () => t);
    const b = new LeaderElection('scheduler', 'node-b', store, 1000, () => t);
    expect(a.tick()).toBe(true);
    expect(b.tick()).toBe(false); // a holds the lease
    t = 1001; // lease expired, a did not renew (crash) → b takes over
    expect(b.tick()).toBe(true);
    expect(a.currentLeader()).toBe('node-b');
  });
});

describe('health-based routing', () => {
  it('prefers same region, fails over cross-region, and drains endpoints', () => {
    const router = new HealthBasedRouter(
      [
        { id: 'us1', region: 'us', weight: 1, state: EndpointState.Healthy },
        { id: 'eu1', region: 'eu', weight: 1, state: EndpointState.Healthy },
      ],
      () => 0,
    );
    expect(router.route('us')!.id).toBe('us1');
    router.drain('us1');
    expect(router.route('us')!.region).toBe('eu'); // regional failover
    expect(router.regionFailed('us')).toBe(true);
  });
});

describe('chaos framework', () => {
  it('injects a dependency outage and the wrapper survives via fallback', async () => {
    const injector = new FailureInjector(() => 0, async () => undefined);
    const exp = new ChaosExperiment(injector, () => true);
    const result = await exp.run({
      name: 'dependency-outage',
      profile: simulate.dependencyOutage(),
      probe: async () => {
        const out = await withFallback(() => injector.wrap(() => Promise.resolve('live')), () => 'degraded');
        return out === 'degraded'; // handled gracefully under fault
      },
    });
    expect(result.survived).toBe(true);
    expect(result.steadyStateAfter).toBe(true); // rolled back
    expect(injector.stats.injectedErrors).toBe(1);
  });

  it('injects latency deterministically', async () => {
    const sleep = vi.fn(async () => undefined);
    const injector = new FailureInjector(() => 1, sleep);
    injector.configure(simulate.networkLatency(200));
    await injector.wrap(() => Promise.resolve('ok'));
    expect(sleep).toHaveBeenCalledWith(200);
  });
});

describe('capacity engineering', () => {
  it('sizes replicas, workers, pools, peak, cost and growth', () => {
    const svc = { rps: 1000, latencyMs: 50, perPodConcurrency: 50, headroom: 1.3, targetUtilization: 0.65 };
    const { concurrency, replicas } = sizeReplicas(svc);
    expect(concurrency).toBe(50); // 1000 × 0.05s
    expect(replicas).toBe(2); // ceil(50×1.3 / (50×0.65)) = ceil(2.0) = 2
    expect(sizeWorkers({ arrivalRatePerSec: 100, serviceRatePerWorker: 20, targetUtilization: 0.7 }).workers).toBe(8);
    const pool = sizeConnectionPool({ replicas: 20, perInstancePool: 20, serverMaxConnections: 200, reservedForAdmin: 10 });
    expect(pool.withinLimit).toBe(false); // 400 > 190
    expect(planPeak(svc, 3).replicas).toBeGreaterThan(replicas);
    expect(estimateCost(2, 8, { perPodMonthly: 100, perWorkerMonthly: 80, fixedMonthly: 500 })).toBe(2 * 100 + 8 * 80 + 500);
    expect(projectGrowth(1000, 0.1, 3)).toEqual([1100, 1210, 1331]);
  });
});

describe('SRE — SLO / error budget', () => {
  it('computes SLI, error budget, burn rate and burn alerts', () => {
    const tracker = new SLOTracker({ name: 'availability', target: 0.99, windowMs: 30 * 24 * 3_600_000 }, () => 1000);
    tracker.record(9900, 100); // 99.0% exactly at target
    const s = tracker.status();
    expect(s.sli).toBeCloseTo(0.99, 5);
    expect(s.healthy).toBe(true);
    expect(s.budgetConsumed).toBe(100);
    expect(s.budgetRemaining).toBeCloseTo(0, 6); // consumed ~exactly the 1% budget
    // burn rate = actual(1%)/allowed(1%) = 1
    expect(s.burnRate).toBeCloseTo(1, 5);

    const bad = new SLOTracker({ name: 'a', target: 0.999, windowMs: 3_600_000 }, () => 1000);
    bad.record(800, 200); // 20% errors → huge burn
    expect(bad.burnAlert()).toBe('page');

    expect(SREPlatform.downtimeBudgetMinutes(0.999, 30)).toBeCloseTo(43.2, 1); // 3 nines ≈ 43.2 min/30d
  });

  it('rolls up multiple SLOs on the dashboard', () => {
    const sre = new SREPlatform(() => 0);
    sre.defineSLO({ name: 'availability', target: 0.999, windowMs: 1000 }).record(999, 1);
    sre.defineSLO({ name: 'latency', target: 0.95, windowMs: 1000 }).record(96, 4);
    const dash = sre.dashboard();
    expect(dash).toHaveLength(2);
    expect(dash.every((d) => d.status.healthy)).toBe(true);
  });
});
