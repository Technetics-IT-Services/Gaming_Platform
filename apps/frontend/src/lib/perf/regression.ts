/**
 * Performance regression framework (Phase 11, STEP 8).
 *
 * Compares current metrics against a stored baseline with per-metric thresholds,
 * flags regressions, and reports the trend. Lower-is-better metrics (latency) and
 * higher-is-better metrics (throughput) are handled by direction. Pure comparison.
 */

export type MetricDirection = 'lower_is_better' | 'higher_is_better';

export interface MetricThreshold {
  /** Allowed relative drift before it's a regression (e.g. 0.1 = 10%). */
  tolerance: number;
  direction: MetricDirection;
}

export interface Baseline {
  capturedAt: number;
  metrics: Record<string, number>;
}

export interface MetricComparison {
  metric: string;
  baseline: number;
  current: number;
  deltaPct: number;
  regressed: boolean;
  improved: boolean;
}
export interface RegressionReport {
  passed: boolean;
  comparisons: MetricComparison[];
  regressions: string[];
}

export class RegressionChecker {
  constructor(private readonly thresholds: Record<string, MetricThreshold>) {}

  compare(baseline: Baseline, current: Record<string, number>): RegressionReport {
    const comparisons: MetricComparison[] = [];
    const regressions: string[] = [];
    for (const [metric, base] of Object.entries(baseline.metrics)) {
      const cur = current[metric];
      if (cur === undefined) continue;
      const threshold = this.thresholds[metric] ?? { tolerance: 0.1, direction: 'lower_is_better' as MetricDirection };
      const deltaPct = base === 0 ? (cur === 0 ? 0 : 1) : (cur - base) / base;
      let regressed: boolean;
      let improved: boolean;
      if (threshold.direction === 'lower_is_better') {
        regressed = deltaPct > threshold.tolerance; // got slower/bigger
        improved = deltaPct < -threshold.tolerance;
      } else {
        regressed = deltaPct < -threshold.tolerance; // got slower throughput
        improved = deltaPct > threshold.tolerance;
      }
      comparisons.push({ metric, baseline: base, current: cur, deltaPct: Math.round(deltaPct * 10000) / 10000, regressed, improved });
      if (regressed) regressions.push(metric);
    }
    return { passed: regressions.length === 0, comparisons, regressions };
  }
}

/** Trend across historical baselines for a single metric (for dashboards). */
export function metricTrend(history: Baseline[], metric: string): { at: number; value: number }[] {
  return history.filter((b) => b.metrics[metric] !== undefined).map((b) => ({ at: b.capturedAt, value: b.metrics[metric]! }));
}
