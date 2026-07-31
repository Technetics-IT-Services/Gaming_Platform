/**
 * Tenant Observability (Phase 3.1, STEP 11).
 *
 * Automatically attaches `tenantId`, `operatorId`, `plan` and `region` to logs, metrics,
 * traces, audit events and health reports. It ENRICHES telemetry from the tenant context
 * and forwards it to whatever sink the app already uses (the frozen Analytics /
 * Observability platform is passed in as a sink and never modified). Additive.
 */
import type { TenantContext } from './types';

/** The tenant dimensions stamped onto every telemetry item. */
export interface TenantDimensions {
  tenantId: string;
  operatorId: string;
  plan: string;
  region: string;
  requestId: string;
}

export function dimensionsOf(ctx: TenantContext): TenantDimensions {
  return { tenantId: ctx.tenantId, operatorId: ctx.operatorId, plan: ctx.plan, region: ctx.region, requestId: ctx.requestId };
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface TenantLogEntry {
  level: LogLevel;
  message: string;
  at: number;
  dimensions: TenantDimensions;
  fields?: Record<string, unknown>;
}

export interface TenantMetric {
  name: string;
  value: number;
  at: number;
  dimensions: TenantDimensions;
  tags?: Record<string, string>;
}

export interface TenantAuditEvent {
  action: string;
  at: number;
  dimensions: TenantDimensions;
  actor?: string;
  target?: string;
  detail?: Record<string, unknown>;
}

/** Pluggable sinks — wire these to the existing (frozen) logging/metrics/audit systems. */
export interface TelemetrySinks {
  log?: (entry: TenantLogEntry) => void;
  metric?: (metric: TenantMetric) => void;
  audit?: (event: TenantAuditEvent) => void;
}

export class TenantObservability {
  private readonly logs: TenantLogEntry[] = [];
  private readonly metrics: TenantMetric[] = [];
  private readonly audits: TenantAuditEvent[] = [];

  constructor(private readonly sinks: TelemetrySinks = {}, private readonly clock: () => number = () => Date.now()) {}

  /** A logger/metrics/audit facade bound to one tenant context. */
  forContext(ctx: TenantContext): {
    log: (level: LogLevel, message: string, fields?: Record<string, unknown>) => void;
    metric: (name: string, value: number, tags?: Record<string, string>) => void;
    audit: (action: string, detail?: { actor?: string; target?: string } & Record<string, unknown>) => void;
  } {
    const dims = dimensionsOf(ctx);
    return {
      log: (level, message, fields) => {
        const entry: TenantLogEntry = { level, message, at: this.clock(), dimensions: dims, fields };
        this.logs.push(entry);
        this.sinks.log?.(entry);
      },
      metric: (name, value, tags) => {
        const m: TenantMetric = { name, value, at: this.clock(), dimensions: dims, tags };
        this.metrics.push(m);
        this.sinks.metric?.(m);
      },
      audit: (action, detail) => {
        const { actor, target, ...rest } = detail ?? {};
        const e: TenantAuditEvent = { action, at: this.clock(), dimensions: dims, actor, target, detail: rest };
        this.audits.push(e);
        this.sinks.audit?.(e);
      },
    };
  }

  /** A per-tenant health report enriched with tenant dimensions. */
  healthReport(ctx: TenantContext, checks: { name: string; healthy: boolean; detail?: string }[]): {
    dimensions: TenantDimensions;
    healthy: boolean;
    checks: { name: string; healthy: boolean; detail?: string }[];
    at: number;
  } {
    return { dimensions: dimensionsOf(ctx), healthy: checks.every((c) => c.healthy), checks, at: this.clock() };
  }

  /* -------- read-side (for tests / dashboards) — filtered by tenant -------- */

  logsFor(tenantId: string): TenantLogEntry[] {
    return this.logs.filter((l) => l.dimensions.tenantId === tenantId);
  }
  metricsFor(tenantId: string): TenantMetric[] {
    return this.metrics.filter((m) => m.dimensions.tenantId === tenantId);
  }
  auditsFor(tenantId: string): TenantAuditEvent[] {
    return this.audits.filter((a) => a.dimensions.tenantId === tenantId);
  }
}
