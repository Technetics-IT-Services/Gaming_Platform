/**
 * Performance profiling (Phase 11, STEP 6).
 *
 * Lightweight, injectable-clock profilers: a span timer (CPU/wall time per operation),
 * an allocation counter (manual instrumentation hook), a database query profiler
 * (top-N by total/mean), and a cache hit-ratio tracker. Instrumentation only — the
 * profiled code is unchanged; profiling is opt-in around a call.
 */
import { LatencyHistogram, type LatencyStats } from './histogram';

export type Clock = () => number;
const wallClock: Clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/* -------------------------------- span timer ------------------------------ */

export class Profiler {
  private readonly hists = new Map<string, LatencyHistogram>();
  private readonly allocs = new Map<string, number>();
  constructor(private readonly clock: Clock = wallClock) {}

  /** Time an async operation under a label. */
  async time<T>(label: string, op: () => Promise<T> | T): Promise<T> {
    const t0 = this.clock();
    try {
      return await op();
    } finally {
      this.hist(label).record(this.clock() - t0);
    }
  }
  private hist(label: string): LatencyHistogram {
    let h = this.hists.get(label);
    if (!h) {
      h = new LatencyHistogram();
      this.hists.set(label, h);
    }
    return h;
  }
  /** Record an allocation count for a label (manual allocation profiling hook). */
  countAllocation(label: string, bytes: number): void {
    this.allocs.set(label, (this.allocs.get(label) ?? 0) + bytes);
  }

  profile(): { label: string; latency: LatencyStats; allocatedBytes: number }[] {
    return [...this.hists.entries()]
      .map(([label, h]) => ({ label, latency: h.stats(), allocatedBytes: this.allocs.get(label) ?? 0 }))
      .sort((a, b) => b.latency.mean - a.latency.mean);
  }
}

/* ----------------------------- query profiler ----------------------------- */

export interface QueryStat {
  query: string;
  count: number;
  totalMs: number;
  meanMs: number;
  maxMs: number;
}

/** Aggregates DB query timings; surfaces the slowest queries (N+1 / hotspot hunting). */
export class QueryProfiler {
  private readonly stats = new Map<string, { count: number; total: number; max: number }>();
  record(query: string, ms: number): void {
    const s = this.stats.get(query) ?? { count: 0, total: 0, max: 0 };
    s.count += 1;
    s.total += ms;
    s.max = Math.max(s.max, ms);
    this.stats.set(query, s);
  }
  top(n = 10): QueryStat[] {
    return [...this.stats.entries()]
      .map(([query, s]) => ({ query, count: s.count, totalMs: Math.round(s.total * 1000) / 1000, meanMs: Math.round((s.total / s.count) * 1000) / 1000, maxMs: s.max }))
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, n);
  }
}

/* ------------------------------- cache stats ------------------------------ */

export class CacheStats {
  private hits = 0;
  private misses = 0;
  hit(): void {
    this.hits += 1;
  }
  miss(): void {
    this.misses += 1;
  }
  ratio(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : Math.round((this.hits / total) * 10000) / 10000;
  }
  summary(): { hits: number; misses: number; hitRatio: number } {
    return { hits: this.hits, misses: this.misses, hitRatio: this.ratio() };
  }
}
