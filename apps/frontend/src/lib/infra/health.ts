/**
 * Health-check framework (Phase 7, STEP 1/4/5).
 *
 * Liveness + readiness probes for the container/orchestrator. Components (database,
 * redis, queue depth, downstream deps) register a probe; the registry aggregates
 * them into an overall status suitable for a `/healthz` (liveness) and `/readyz`
 * (readiness) endpoint. Read-only — probes observe, never mutate.
 */

export enum HealthState {
  Healthy = 'healthy',
  Degraded = 'degraded',
  Unhealthy = 'unhealthy',
}

export interface ProbeResult {
  state: HealthState;
  detail?: string;
}
export interface HealthCheck {
  name: string;
  /** Critical checks fail readiness; non-critical only degrade it. */
  critical?: boolean;
  probe: () => ProbeResult | Promise<ProbeResult>;
}
export interface ComponentReport extends ProbeResult {
  name: string;
  critical: boolean;
  durationMs: number;
}
export interface HealthReport {
  state: HealthState;
  components: ComponentReport[];
  checkedAt: number;
}

export class HealthRegistry {
  private readonly checks = new Map<string, HealthCheck>();
  constructor(private readonly clock: () => number = () => Date.now()) {}

  register(check: HealthCheck): this {
    this.checks.set(check.name, { critical: true, ...check });
    return this;
  }
  unregister(name: string): void {
    this.checks.delete(name);
  }

  /** Liveness: is the process itself up? (No component probes — cheap + always true.) */
  liveness(): HealthReport {
    return { state: HealthState.Healthy, components: [], checkedAt: this.clock() };
  }

  /** Readiness: run every probe and aggregate (critical failure ⇒ Unhealthy). */
  async readiness(): Promise<HealthReport> {
    const components: ComponentReport[] = [];
    for (const check of this.checks.values()) {
      const started = this.clock();
      let result: ProbeResult;
      try {
        result = await check.probe();
      } catch (e) {
        result = { state: HealthState.Unhealthy, detail: (e as Error).message };
      }
      components.push({ name: check.name, critical: check.critical ?? true, durationMs: this.clock() - started, ...result });
    }
    let state = HealthState.Healthy;
    for (const c of components) {
      if (c.state === HealthState.Unhealthy && c.critical) state = HealthState.Unhealthy;
      else if (c.state !== HealthState.Healthy && state === HealthState.Healthy) state = HealthState.Degraded;
    }
    return { state, components, checkedAt: this.clock() };
  }
}

/** Convenience probes for the standard production dependencies. */
export const probes = {
  /** A DB probe backed by a `SELECT 1`-style ping. */
  database(ping: () => Promise<boolean> | boolean): HealthCheck['probe'] {
    return async () => ((await ping()) ? { state: HealthState.Healthy } : { state: HealthState.Unhealthy, detail: 'ping failed' });
  },
  /** A redis probe backed by a PING. */
  redis(ping: () => Promise<boolean> | boolean): HealthCheck['probe'] {
    return async () => ((await ping()) ? { state: HealthState.Healthy } : { state: HealthState.Unhealthy, detail: 'PING failed' });
  },
  /** Queue-depth probe: degraded past `warn`, unhealthy past `max`. */
  queueDepth(depth: () => number, thresholds: { warn: number; max: number }): HealthCheck['probe'] {
    return () => {
      const d = depth();
      if (d >= thresholds.max) return { state: HealthState.Unhealthy, detail: `depth ${d} ≥ ${thresholds.max}` };
      if (d >= thresholds.warn) return { state: HealthState.Degraded, detail: `depth ${d} ≥ ${thresholds.warn}` };
      return { state: HealthState.Healthy, detail: `depth ${d}` };
    };
  },
};
