/**
 * Analytics service (Phase 6D, STEP 1) — the event-ingest core.
 *
 * The rest of the platform emits `AnalyticsEvent`s here; the service appends them to
 * an in-memory event store, updates the `MetricsRegistry`, and records monetary/count
 * time-series into the `TimeSeriesStore`. It only reads the events it is handed — it
 * never reaches back into a frozen service to mutate anything. Tenant-aware queries.
 */
import { MetricsRegistry, TimeSeriesStore } from './metrics';
import { type AnalyticsEvent, type EventType, Granularity } from './types';

export class AnalyticsService {
  private readonly events: AnalyticsEvent[] = [];
  readonly metrics = new MetricsRegistry();
  readonly series = new TimeSeriesStore();

  constructor(private readonly clock: () => number = () => Date.now()) {}

  /** Ingest an event (read-only fact). Updates counters + monetary time-series. */
  track(event: AnalyticsEvent): void {
    const at = event.at || this.clock();
    const e = { ...event, at };
    this.events.push(e);
    this.metrics.increment(`events.${e.type}`);
    const dims: Record<string, string> = {};
    if (e.tenantId) dims.tenantId = e.tenantId;
    if (e.gameId) dims.gameId = e.gameId;
    this.series.record(`event.${e.type}.count`, 1, at, dims);
    if (typeof e.amount === 'number') this.series.record(`event.${e.type}.amount`, e.amount, at, dims);
  }

  /** All events, optionally scoped to a tenant + time window. */
  query(filter: { type?: EventType; tenantId?: string; from?: number; to?: number } = {}): AnalyticsEvent[] {
    return this.events.filter((e) => {
      if (filter.type && e.type !== filter.type) return false;
      if (filter.tenantId && e.tenantId !== filter.tenantId) return false;
      if (filter.from !== undefined && e.at < filter.from) return false;
      if (filter.to !== undefined && e.at > filter.to) return false;
      return true;
    });
  }

  count(): number {
    return this.events.length;
  }

  /** A charting time-series for an event count/amount. */
  timeSeries(metric: string, grain: Granularity = Granularity.Day, filter?: { dims?: Record<string, string>; from?: number; to?: number }) {
    return this.series.query(metric, grain, filter);
  }
}
