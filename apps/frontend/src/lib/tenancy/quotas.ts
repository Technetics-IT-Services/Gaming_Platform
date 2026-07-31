/**
 * Resource Quotas (Phase 3.1, STEP 12).
 *
 * Enforces per-tenant `TenantLimits` — concurrent players/sessions, storage, media, API
 * requests (per-minute rolling), scheduled jobs, queue usage, notifications (per-day
 * rolling) and background workers. Gauges track a live count (acquire/release);
 * rate-limited resources use a rolling window. Additive; owns only counters — no money,
 * no frozen module. Deterministic via an injected clock.
 */
import type { TenantLimits } from './types';

/** Resource keys that map to `TenantLimits`. */
export type QuotaResource = keyof TenantLimits;

/** Resources measured as a rolling rate rather than a live gauge. */
const RATE_RESOURCES: Partial<Record<QuotaResource, number>> = {
  apiRequestsPerMinute: 60_000,
  notificationsPerDay: 86_400_000,
};

export interface QuotaDecision {
  allowed: boolean;
  resource: QuotaResource;
  limit: number;
  current: number;
  remaining: number;
  reason?: string;
}

export class QuotaExceededError extends Error {
  constructor(readonly decision: QuotaDecision) {
    super(`quota exceeded for ${decision.resource}: ${decision.current}/${decision.limit}`);
    this.name = 'QuotaExceededError';
  }
}

export class QuotaService {
  /** Live gauges: tenant → resource → count. */
  private readonly gauges = new Map<string, Map<QuotaResource, number>>();
  /** Rolling timestamps for rate resources: tenant → resource → number[] (event times). */
  private readonly windows = new Map<string, Map<QuotaResource, number[]>>();

  constructor(private readonly clock: () => number = () => Date.now()) {}

  private gaugeMap(tenantId: string): Map<QuotaResource, number> {
    let m = this.gauges.get(tenantId);
    if (!m) this.gauges.set(tenantId, (m = new Map()));
    return m;
  }
  private windowMap(tenantId: string): Map<QuotaResource, number[]> {
    let m = this.windows.get(tenantId);
    if (!m) this.windows.set(tenantId, (m = new Map()));
    return m;
  }

  /** Current usage of a resource for a tenant. */
  usage(tenantId: string, resource: QuotaResource): number {
    if (resource in RATE_RESOURCES) {
      const times = this.windowMap(tenantId).get(resource) ?? [];
      const cutoff = this.clock() - RATE_RESOURCES[resource]!;
      return times.filter((t) => t > cutoff).length;
    }
    return this.gaugeMap(tenantId).get(resource) ?? 0;
  }

  /** Would acquiring `amount` be allowed? (does not mutate). */
  check(tenantId: string, resource: QuotaResource, limits: TenantLimits, amount = 1): QuotaDecision {
    const limit = limits[resource];
    const current = this.usage(tenantId, resource);
    const allowed = current + amount <= limit;
    return { allowed, resource, limit, current, remaining: Math.max(0, limit - current), reason: allowed ? undefined : 'limit reached' };
  }

  /** Acquire capacity; throws `QuotaExceededError` if it would exceed the limit. */
  acquire(tenantId: string, resource: QuotaResource, limits: TenantLimits, amount = 1): QuotaDecision {
    const decision = this.check(tenantId, resource, limits, amount);
    if (!decision.allowed) throw new QuotaExceededError(decision);
    if (resource in RATE_RESOURCES) {
      const times = this.windowMap(tenantId).get(resource) ?? [];
      const now = this.clock();
      for (let i = 0; i < amount; i += 1) times.push(now);
      this.windowMap(tenantId).set(resource, times);
    } else {
      this.gaugeMap(tenantId).set(resource, (this.gaugeMap(tenantId).get(resource) ?? 0) + amount);
    }
    return { ...decision, current: decision.current + amount, remaining: Math.max(0, decision.limit - decision.current - amount) };
  }

  /** Release gauge capacity (no-op for rate resources). */
  release(tenantId: string, resource: QuotaResource, amount = 1): void {
    if (resource in RATE_RESOURCES) return;
    const m = this.gaugeMap(tenantId);
    m.set(resource, Math.max(0, (m.get(resource) ?? 0) - amount));
  }

  /** A snapshot of every resource for a tenant. */
  snapshot(tenantId: string, limits: TenantLimits): Record<QuotaResource, QuotaDecision> {
    const out = {} as Record<QuotaResource, QuotaDecision>;
    for (const resource of Object.keys(limits) as QuotaResource[]) {
      const current = this.usage(tenantId, resource);
      out[resource] = { allowed: current < limits[resource], resource, limit: limits[resource], current, remaining: Math.max(0, limits[resource] - current) };
    }
    return out;
  }

  /** Reset all counters for a tenant (lifecycle suspend/delete). */
  resetTenant(tenantId: string): void {
    this.gauges.delete(tenantId);
    this.windows.delete(tenantId);
  }
}
