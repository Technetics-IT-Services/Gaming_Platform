import { describe, expect, it } from 'vitest';

import { Ledger, TransactionType, WalletService } from '@/lib/ledger';

import { Benchmark, BenchmarkSuite } from './benchmark';
import { LatencyHistogram } from './histogram';
import { CacheStats, Profiler, QueryProfiler } from './profiling';
import { qualify, scorecardReport } from './qualification';
import { RegressionChecker, metricTrend } from './regression';
import { analyzeTrend, soakReport } from './soak';
import { arrivalSchedule, runLoad, stressRamp, type LoadOp } from './workload';

/**
 * Performance validation & qualification tooling (Phase 11). Deterministic tests for
 * the histogram/percentiles, benchmark runner, synthetic workloads, load + stress
 * simulation, soak leak detection, profiling, regression comparison, and the
 * qualification scorecard — plus a REAL micro-benchmark of the frozen ledger. Pure
 * measurement tooling; no business or financial logic is modified.
 */

describe('latency histogram', () => {
  it('computes nearest-rank percentiles', () => {
    const h = new LatencyHistogram();
    h.recordMany(Array.from({ length: 100 }, (_, i) => i + 1)); // 1..100
    const s = h.stats();
    expect(s.count).toBe(100);
    expect(s.min).toBe(1);
    expect(s.max).toBe(100);
    expect(s.p50).toBe(50);
    expect(s.p95).toBe(95);
    expect(s.p99).toBe(99);
  });
});

describe('benchmark framework (injected clock)', () => {
  it('measures ops/sec + percentiles deterministically', async () => {
    let t = 0;
    const clock = () => (t += 5); // every clock read advances 5ms → each iter ≈ 5ms
    const bench = new Benchmark({ iterations: 10, warmup: 0, clock });
    const r = await bench.run('noop', () => undefined);
    expect(r.iterations).toBe(10);
    expect(r.latency.count).toBe(10);
    expect(r.latency.p50).toBeGreaterThan(0);
    const suite = new BenchmarkSuite({ iterations: 5, warmup: 0, clock });
    await suite.add('a', () => undefined);
    expect(suite.report().rows).toHaveLength(1);
  });
});

describe('synthetic workload generation', () => {
  it('produces steady/ramp/burst arrival schedules', () => {
    const steady = arrivalSchedule({ kind: 'steady', rps: 10, durationSec: 1 });
    expect(steady.length).toBe(10); // 10 rps × 1s
    const burst = arrivalSchedule({ kind: 'burst', baseRps: 1, spikeRps: 100, spikeAtSec: 0, spikeDurationSec: 1, durationSec: 1 });
    expect(burst.length).toBeGreaterThan(50); // spike dominates
    const ramp = arrivalSchedule({ kind: 'ramp', fromRps: 1, toRps: 10, durationSec: 1 });
    expect(ramp.length).toBeGreaterThan(0);
  });
});

describe('load simulation', () => {
  it('drives concurrency, computes throughput + error rate deterministically', async () => {
    // Each op takes a fixed 20ms; 1 in 10 fails.
    const op: LoadOp = async (i) => ({ ok: i % 10 !== 0, latencyMs: 20 });
    const res = await runLoad(op, { requests: 100, concurrency: 10 });
    expect(res.requests).toBe(100);
    expect(res.errors).toBe(10);
    expect(res.errorRate).toBeCloseTo(0.1, 5);
    expect(res.latency.p50).toBe(20);
    // closed-loop throughput ≈ concurrency / mean-latency = 10 / 0.02s = 500 rps
    expect(res.throughputPerSec).toBe(500);
  });
});

describe('stress ramp — knee detection', () => {
  it('finds the sustainable concurrency before p95 breaches the SLO', async () => {
    // Model: latency grows with concurrency; p95 breaches 100ms above ~40 users.
    const makeOp = (c: number): LoadOp => async () => ({ ok: true, latencyMs: 10 + c * 2 });
    const stress = await stressRamp(makeOp, { startConcurrency: 10, step: 10, maxConcurrency: 100, requestsPerLevel: 20, sloP95Ms: 100 });
    expect(stress.breachedAt).toBeGreaterThan(stress.kneeConcurrency);
    expect(stress.kneeConcurrency).toBeLessThanOrEqual(40); // 10+40*2=90 ok; 10+50*2=110 breaches
  });
});

describe('soak — leak detection', () => {
  it('flags a rising memory series and clears a flat one', () => {
    const rising = Array.from({ length: 50 }, (_, i) => ({ at: i, value: 100 + i * 2 }));
    expect(analyzeTrend(rising).leaking).toBe(true);
    const flat = Array.from({ length: 50 }, (_, i) => ({ at: i, value: 100 + (i % 2) }));
    expect(analyzeTrend(flat).leaking).toBe(false);
    const report = soakReport({ memory: flat, connections: flat, queueDepth: flat });
    expect(report.stable).toBe(true);
  });
});

describe('profiling', () => {
  it('times operations, profiles queries, tracks cache hit ratio', async () => {
    let t = 0;
    const prof = new Profiler(() => (t += 10));
    await prof.time('db.read', async () => undefined);
    expect(prof.profile()[0]!.latency.count).toBe(1);

    const qp = new QueryProfiler();
    qp.record('SELECT * FROM ledger', 50);
    qp.record('SELECT * FROM ledger', 30);
    qp.record('SELECT 1', 1);
    expect(qp.top(1)[0]!.query).toBe('SELECT * FROM ledger');
    expect(qp.top(1)[0]!.meanMs).toBe(40);

    const cache = new CacheStats();
    cache.hit();
    cache.hit();
    cache.miss();
    expect(cache.ratio()).toBeCloseTo(0.6667, 3);
  });
});

describe('regression framework', () => {
  it('detects latency regressions and throughput improvements', () => {
    const checker = new RegressionChecker({
      p95: { tolerance: 0.1, direction: 'lower_is_better' },
      throughput: { tolerance: 0.1, direction: 'higher_is_better' },
    });
    const baseline = { capturedAt: 0, metrics: { p95: 100, throughput: 1000 } };
    const report = checker.compare(baseline, { p95: 130, throughput: 1200 });
    expect(report.passed).toBe(false);
    expect(report.regressions).toContain('p95'); // +30% latency
    expect(report.comparisons.find((c) => c.metric === 'throughput')!.improved).toBe(true);
    expect(metricTrend([baseline], 'p95')).toEqual([{ at: 0, value: 100 }]);
  });
});

describe('qualification scorecard', () => {
  it('grades checks against targets and computes a score', () => {
    const card = qualify(
      [
        { category: 'throughput', name: 'api rps', value: 1200, target: 1000, direction: 'higher_is_better', unit: 'rps' },
        { category: 'latency', name: 'p95', value: 220, target: 200, warnAt: 250, direction: 'lower_is_better', unit: 'ms' },
        { category: 'availability', name: 'uptime', value: 99.95, target: 99.9, direction: 'higher_is_better', unit: '%' },
        { category: 'resource', name: 'cpu', value: 90, target: 70, warnAt: 80, direction: 'lower_is_better', unit: '%' },
      ],
      0,
    );
    expect(card.results.find((r) => r.name === 'api rps')!.grade).toBe('pass');
    expect(card.results.find((r) => r.name === 'p95')!.grade).toBe('warn');
    expect(card.results.find((r) => r.name === 'cpu')!.grade).toBe('fail');
    expect(card.passed).toBe(false); // a fail present
    expect(card.score).toBeGreaterThan(0);
    expect(scorecardReport(card).columns).toContain('grade');
  });
});

describe('real micro-benchmark — frozen ledger (qualification, read-only)', () => {
  it('posts a batch of double-entry transactions and qualifies throughput', async () => {
    const ledger = new Ledger();
    const wallet = new WalletService(ledger, 'INR');
    wallet.credit('p1', 1_000_000, { type: TransactionType.Deposit });
    const bench = new Benchmark({ iterations: 2000, warmup: 100 });
    let i = 0;
    const result = await bench.run('wallet.debit', () => {
      wallet.debit('p1', 1, { type: TransactionType.Bet, idempotencyKey: `bet:${i++}` });
    });
    // The frozen ledger is in-memory + synchronous — expect very high throughput.
    expect(result.opsPerSec).toBeGreaterThan(1000);
    // And the ledger stays balanced after the benchmark (no perf tooling side effects).
    expect(ledger.reconcile().systemSum).toBe(0);
  });
});
