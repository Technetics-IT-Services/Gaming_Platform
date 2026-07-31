/**
 * Benchmark framework + runner (Phase 11, STEP 1).
 *
 * Runs a repeatable workload N times (with warmup), measures per-iteration latency via
 * an injectable high-resolution clock, and reports throughput + latency percentiles.
 * A `BenchmarkSuite` groups benchmarks and emits a report. Measurement only — it never
 * mutates the code under test.
 */
import { LatencyHistogram, type LatencyStats } from './histogram';

/** High-resolution now (ms). Injectable for deterministic tests; real runs use perf. */
export type Clock = () => number;

export function defaultClock(): Clock {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return () => performance.now();
  return () => Date.now();
}

export interface BenchmarkOptions {
  iterations?: number;
  warmup?: number;
  clock?: Clock;
}

export interface BenchmarkResult {
  name: string;
  iterations: number;
  latency: LatencyStats;
  /** Operations per second, derived from mean latency. */
  opsPerSec: number;
  totalMs: number;
}

export class Benchmark {
  constructor(private readonly opts: BenchmarkOptions = {}) {}

  async run(name: string, fn: () => unknown | Promise<unknown>): Promise<BenchmarkResult> {
    const iterations = this.opts.iterations ?? 1000;
    const warmup = this.opts.warmup ?? Math.min(50, Math.floor(iterations / 10));
    const clock = this.opts.clock ?? defaultClock();
    const hist = new LatencyHistogram();

    for (let i = 0; i < warmup; i += 1) await fn();

    const start = clock();
    for (let i = 0; i < iterations; i += 1) {
      const t0 = clock();
      await fn();
      hist.record(clock() - t0);
    }
    const totalMs = clock() - start;
    const latency = hist.stats();
    const opsPerSec = latency.mean > 0 ? Math.round(1000 / latency.mean) : Infinity;
    return { name, iterations, latency, opsPerSec, totalMs: Math.round(totalMs * 1000) / 1000 };
  }
}

export class BenchmarkSuite {
  private readonly results: BenchmarkResult[] = [];
  constructor(private readonly opts: BenchmarkOptions = {}) {}

  async add(name: string, fn: () => unknown | Promise<unknown>): Promise<BenchmarkResult> {
    const result = await new Benchmark(this.opts).run(name, fn);
    this.results.push(result);
    return result;
  }
  all(): BenchmarkResult[] {
    return [...this.results];
  }

  /** Export-ready benchmark report. */
  report(): { columns: string[]; rows: (string | number)[][] } {
    return {
      columns: ['benchmark', 'iterations', 'ops/sec', 'p50 (ms)', 'p95 (ms)', 'p99 (ms)', 'max (ms)'],
      rows: this.results.map((r) => [r.name, r.iterations, r.opsPerSec, r.latency.p50, r.latency.p95, r.latency.p99, r.latency.max]),
    };
  }
}
