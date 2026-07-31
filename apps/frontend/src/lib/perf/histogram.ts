/**
 * Latency histogram (Phase 11).
 *
 * Records latency samples and computes percentiles (P50/P90/P95/P99/max), mean and
 * count. Nearest-rank percentiles over a sorted copy — deterministic and dependency-
 * free. Pure measurement tooling; touches no business or financial logic.
 */

export interface LatencyStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

export class LatencyHistogram {
  private readonly samples: number[] = [];

  record(ms: number): void {
    this.samples.push(ms);
  }
  recordMany(values: number[]): void {
    for (const v of values) this.samples.push(v);
  }
  count(): number {
    return this.samples.length;
  }

  /** Nearest-rank percentile (p in 0–100). */
  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
  }

  stats(): LatencyStats {
    if (this.samples.length === 0) return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
    const sorted = [...this.samples].sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
    return {
      count: sorted.length,
      min: sorted[0]!,
      max: sorted[sorted.length - 1]!,
      mean: Math.round((sum / sorted.length) * 1000) / 1000,
      p50: at(50),
      p90: at(90),
      p95: at(95),
      p99: at(99),
    };
  }
}
