/**
 * Control-plane observability (Phase 3.2, STEP 24).
 *
 * Every control-plane operation exposes tenantId, operatorId, requestId, correlationId,
 * operation, duration, result and error, plus counters for the key control-plane signals.
 * Emits to a pluggable sink that wires to the existing (frozen) Analytics/Observability
 * platform — this module ENRICHES and measures; it never modifies a frozen service.
 */
export interface ControlPlaneOperationRecord {
  operation: string;
  tenantId?: string;
  operatorId?: string;
  requestId?: string;
  correlationId?: string;
  durationMs: number;
  result: 'success' | 'failure';
  error?: string;
  at: number;
}

export type CounterName =
  | 'tenant.created' | 'provisioning.failed' | 'config.changed' | 'lifecycle.transition'
  | 'domain.verification.failed' | 'apikey.created' | 'apikey.revoked'
  | 'persistence.failed' | 'concurrency.conflict' | 'cache.hit' | 'cache.miss';

export interface ControlPlaneSink {
  operation?: (record: ControlPlaneOperationRecord) => void;
  counter?: (name: CounterName, delta: number, tags?: Record<string, string>) => void;
}

export class ControlPlaneObservability {
  private readonly records: ControlPlaneOperationRecord[] = [];
  private readonly counters = new Map<CounterName, number>();

  constructor(private readonly sink: ControlPlaneSink = {}, private readonly clock: () => number = () => Date.now()) {}

  record(rec: Omit<ControlPlaneOperationRecord, 'at'>): void {
    const full = { ...rec, at: this.clock() };
    this.records.push(full);
    this.sink.operation?.(full);
  }

  increment(name: CounterName, delta = 1, tags?: Record<string, string>): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + delta);
    this.sink.counter?.(name, delta, tags);
  }

  /** Time an operation, recording duration + result and re-throwing on error. */
  async time<T>(operation: string, ctx: { tenantId?: string; operatorId?: string; requestId?: string; correlationId?: string }, fn: () => T | Promise<T>): Promise<T> {
    const started = this.clock();
    try {
      const out = await fn();
      this.record({ operation, ...ctx, durationMs: this.clock() - started, result: 'success' });
      return out;
    } catch (err) {
      this.record({ operation, ...ctx, durationMs: this.clock() - started, result: 'failure', error: (err as Error).message });
      throw err;
    }
  }

  counter(name: CounterName): number {
    return this.counters.get(name) ?? 0;
  }
  operations(): ControlPlaneOperationRecord[] {
    return [...this.records];
  }
}
