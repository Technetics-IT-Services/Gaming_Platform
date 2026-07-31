/**
 * Metrics infrastructure (Phase 6D, STEP 1).
 *
 * `MetricsRegistry` (metric definitions + counter/gauge/histogram values),
 * `TimeSeriesStore` (bucketed points with a `DimensionModel`), and `AggregationEngine`
 * (sum/count/avg/min/max/distinct over series). All in-memory, deterministic, and
 * read-oriented — nothing here changes business state.
 */
import { AggregateOp, Granularity, type MetricDefinition, MetricKind, type TimeSeriesPoint } from './types';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function bucketOf(at: number, grain: Granularity): number {
  const size = grain === Granularity.Hour ? HOUR_MS : DAY_MS;
  return Math.floor(at / size) * size;
}

export class MetricsRegistry {
  private readonly defs = new Map<string, MetricDefinition>();
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();

  register(def: MetricDefinition): void {
    this.defs.set(def.name, def);
  }
  definitions(): MetricDefinition[] {
    return [...this.defs.values()];
  }
  private ensure(name: string, kind: MetricKind): void {
    if (!this.defs.has(name)) this.defs.set(name, { name, kind, description: name });
  }

  increment(name: string, by = 1): void {
    this.ensure(name, MetricKind.Counter);
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }
  gauge(name: string, value: number): void {
    this.ensure(name, MetricKind.Gauge);
    this.gauges.set(name, value);
  }
  observe(name: string, value: number): void {
    this.ensure(name, MetricKind.Histogram);
    this.histograms.set(name, [...(this.histograms.get(name) ?? []), value]);
  }

  counter(name: string): number {
    return this.counters.get(name) ?? 0;
  }
  gaugeValue(name: string): number | undefined {
    return this.gauges.get(name);
  }
  histogram(name: string): number[] {
    return this.histograms.get(name) ?? [];
  }

  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.counters) out[`counter:${k}`] = v;
    for (const [k, v] of this.gauges) out[`gauge:${k}`] = v;
    for (const [k, v] of this.histograms) out[`hist:${k}:count`] = v.length;
    return out;
  }
}

interface Point {
  at: number;
  value: number;
  dims: Record<string, string>;
}

export class TimeSeriesStore {
  /** metric → points. Dimension filtering is applied at query time (DimensionModel). */
  private readonly series = new Map<string, Point[]>();

  record(metric: string, value: number, at: number, dims: Record<string, string> = {}): void {
    this.series.set(metric, [...(this.series.get(metric) ?? []), { at, value, dims }]);
  }

  private select(metric: string, filter?: { dims?: Record<string, string>; from?: number; to?: number }): Point[] {
    return (this.series.get(metric) ?? []).filter((p) => {
      if (filter?.from !== undefined && p.at < filter.from) return false;
      if (filter?.to !== undefined && p.at > filter.to) return false;
      if (filter?.dims) for (const [k, v] of Object.entries(filter.dims)) if (p.dims[k] !== v) return false;
      return true;
    });
  }

  /** Bucketed time-series for charting. */
  query(metric: string, grain: Granularity, filter?: { dims?: Record<string, string>; from?: number; to?: number }, op: AggregateOp = AggregateOp.Sum): TimeSeriesPoint[] {
    const buckets = new Map<number, number[]>();
    for (const p of this.select(metric, filter)) {
      const b = bucketOf(p.at, grain);
      buckets.set(b, [...(buckets.get(b) ?? []), p.value]);
    }
    return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([at, values]) => ({ at, value: AggregationEngine.reduce(values, op) }));
  }

  /** Scalar aggregate over a metric (optionally dimension/time filtered). */
  aggregate(metric: string, op: AggregateOp, filter?: { dims?: Record<string, string>; from?: number; to?: number }): number {
    return AggregationEngine.reduce(this.select(metric, filter).map((p) => p.value), op);
  }

  /** Distinct dimension values seen for a metric (the DimensionModel view). */
  dimensionValues(metric: string, dimension: string): string[] {
    const set = new Set<string>();
    for (const p of this.series.get(metric) ?? []) if (p.dims[dimension] !== undefined) set.add(p.dims[dimension]);
    return [...set];
  }
}

export class AggregationEngine {
  static reduce(values: number[], op: AggregateOp): number {
    if (values.length === 0) return 0;
    switch (op) {
      case AggregateOp.Sum:
        return values.reduce((s, v) => s + v, 0);
      case AggregateOp.Count:
        return values.length;
      case AggregateOp.Avg:
        return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
      case AggregateOp.Min:
        return Math.min(...values);
      case AggregateOp.Max:
        return Math.max(...values);
      case AggregateOp.DistinctCount:
        return new Set(values).size;
      default:
        return 0;
    }
  }
}
