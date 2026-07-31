/**
 * Observability platform (Phase 6D, STEP 6).
 *
 * Distributed tracing (spans + traces keyed by correlation id), structured logs, a
 * request timeline, latency/performance metrics and a service dependency graph. It
 * records what the app hands it — it never instruments or mutates a frozen service.
 */
import {
  type DependencyEdge,
  type LatencyStats,
  type LogEntry,
  LogLevel,
  type Span,
} from './types';

function secureId(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export class Observability {
  private readonly spans = new Map<string, Span>();
  private readonly byTrace = new Map<string, string[]>();
  private readonly logs: LogEntry[] = [];

  constructor(private readonly clock: () => number = () => Date.now()) {}

  /* --------------------------------- tracing ------------------------------ */

  /** Start a span. `traceId` groups a request; defaults to a new trace. */
  startSpan(input: { service: string; operation: string; traceId?: string; parentId?: string; attributes?: Record<string, string>; at?: number }): Span {
    const span: Span = {
      id: secureId('span'),
      traceId: input.traceId ?? secureId('trace'),
      parentId: input.parentId,
      service: input.service,
      operation: input.operation,
      startedAt: input.at ?? this.clock(),
      status: 'ok',
      attributes: input.attributes,
    };
    this.spans.set(span.id, span);
    this.byTrace.set(span.traceId, [...(this.byTrace.get(span.traceId) ?? []), span.id]);
    return span;
  }
  endSpan(spanId: string, opts?: { status?: 'ok' | 'error'; at?: number }): Span {
    const span = this.spans.get(spanId);
    if (!span) throw new Error('no such span');
    span.endedAt = opts?.at ?? this.clock();
    span.durationMs = span.endedAt - span.startedAt;
    if (opts?.status) span.status = opts.status;
    return span;
  }

  /** All spans in a trace, ordered by start (the request timeline). */
  trace(traceId: string): Span[] {
    return (this.byTrace.get(traceId) ?? []).map((id) => this.spans.get(id)!).sort((a, b) => a.startedAt - b.startedAt);
  }

  /* ---------------------------------- logs -------------------------------- */

  log(entry: Omit<LogEntry, 'at'> & { at?: number }): void {
    this.logs.push({ at: entry.at ?? this.clock(), level: entry.level, service: entry.service, message: entry.message, correlationId: entry.correlationId, attributes: entry.attributes });
  }
  queryLogs(filter: { level?: LogLevel; service?: string; correlationId?: string; from?: number; to?: number } = {}): LogEntry[] {
    return this.logs.filter((l) => {
      if (filter.level && l.level !== filter.level) return false;
      if (filter.service && l.service !== filter.service) return false;
      if (filter.correlationId && l.correlationId !== filter.correlationId) return false;
      if (filter.from !== undefined && l.at < filter.from) return false;
      if (filter.to !== undefined && l.at > filter.to) return false;
      return true;
    });
  }
  errorRate(service?: string): number {
    const rows = this.logs.filter((l) => !service || l.service === service);
    if (rows.length === 0) return 0;
    return rows.filter((l) => l.level === LogLevel.Error).length / rows.length;
  }

  /* ------------------------- performance & topology ----------------------- */

  /** Latency percentiles for a service's completed spans. */
  latency(service?: string): LatencyStats {
    const ds = [...this.spans.values()].filter((s) => s.durationMs !== undefined && (!service || s.service === service)).map((s) => s.durationMs!).sort((a, b) => a - b);
    if (ds.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, max: 0 };
    const pct = (p: number) => ds[Math.min(ds.length - 1, Math.floor((p / 100) * ds.length))]!;
    return { count: ds.length, p50: pct(50), p95: pct(95), p99: pct(99), max: ds[ds.length - 1]! };
  }

  /** Service dependency graph derived from parent→child span services. */
  dependencyGraph(): DependencyEdge[] {
    const edges = new Map<string, DependencyEdge>();
    for (const span of this.spans.values()) {
      if (!span.parentId) continue;
      const parent = this.spans.get(span.parentId);
      if (!parent || parent.service === span.service) continue;
      const key = `${parent.service}→${span.service}`;
      const edge = edges.get(key) ?? { from: parent.service, to: span.service, calls: 0, errors: 0 };
      edge.calls += 1;
      if (span.status === 'error') edge.errors += 1;
      edges.set(key, edge);
    }
    return [...edges.values()];
  }
}
