/**
 * Persistent Feature Flag Service (Phase 3.2, STEP 6).
 *
 * Persists global rules and per-tenant overrides and resolves a flag through the Phase 3.1
 * precedence chain: Kill Switch → Tenant Override → Operator Allow-list → Percentage
 * Rollout → Plan Flag → Global Default. Percentage rollout is DETERMINISTIC (stable
 * FNV hash of `flag + tenantId`) — never random. Every change is audited; results are
 * cached per tenant and invalidated on any write. Additive; no frozen module.
 */
import { PLAN_FEATURES } from '../defaults';
import { TenantPlan } from '../types';
import type { FeatureFlagRow } from '../persistence/records';
import type { FeatureFlagRepository } from '../persistence/repositories';
import { ControlPlaneCache } from './cache';
import type { AuditService } from './audit-service';

export interface FlagContext {
  tenantId: string;
  operatorId?: string;
  plan?: TenantPlan;
}

/** Deterministic 0–99 bucket for (flag, tenant) — stable across runs/restarts. */
export function rolloutBucket(flag: string, tenantId: string): number {
  let h = 2166136261;
  const s = `${flag}:${tenantId}`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100;
}

export class FeatureFlagService {
  constructor(
    private readonly repo: FeatureFlagRepository,
    private readonly audit?: AuditService,
    private readonly cache: ControlPlaneCache = new ControlPlaneCache(),
  ) {}

  /* --------------------------------- writes ------------------------------- */

  setGlobalRule(flag: string, rule: NonNullable<FeatureFlagRow['rule']>, actor?: string): void {
    const before = this.repo.getGlobalRule(flag)?.rule;
    this.repo.setGlobalRule(flag, rule, actor);
    this.cache.clear(); // global change affects every tenant
    this.audit?.record({ actorId: actor, action: 'flag.global.set', resource: 'feature-flag', resourceId: flag, before, after: rule });
  }

  setKillSwitch(flag: string, on: boolean, actor?: string): void {
    const rule = this.repo.getGlobalRule(flag)?.rule ?? {};
    this.setGlobalRule(flag, { ...rule, killSwitch: on }, actor);
    this.audit?.record({ actorId: actor, action: 'flag.kill-switch', resource: 'feature-flag', resourceId: flag, after: { killSwitch: on } });
  }

  setTenantOverride(tenantId: string, flag: string, enabled: boolean, actor?: string): void {
    const before = this.repo.getTenantOverride(tenantId, flag)?.enabled;
    this.repo.setTenantOverride(tenantId, flag, enabled, actor);
    this.cache.invalidateKind(tenantId, 'flags');
    this.audit?.record({ tenantId, actorId: actor, action: 'flag.tenant.override', resource: 'feature-flag', resourceId: flag, before, after: enabled });
  }

  clearTenantOverride(tenantId: string, flag: string, actor?: string): void {
    this.repo.clearTenantOverride(tenantId, flag);
    this.cache.invalidateKind(tenantId, 'flags');
    this.audit?.record({ tenantId, actorId: actor, action: 'flag.tenant.clear', resource: 'feature-flag', resourceId: flag });
  }

  /* -------------------------------- resolve ------------------------------- */

  isEnabled(flag: string, ctx: FlagContext): boolean {
    const rule = this.repo.getGlobalRule(flag)?.rule;
    // 1) Kill switch.
    if (rule?.killSwitch) return false;
    // 2) Tenant override.
    const override = this.repo.getTenantOverride(ctx.tenantId, flag);
    if (override?.enabled !== undefined) return override.enabled;
    // 3) Operator allow-list.
    if (rule?.operatorAllowList && ctx.operatorId && rule.operatorAllowList.includes(ctx.operatorId)) return true;
    // 4) Percentage rollout (deterministic).
    if (rule?.rolloutPercentage !== undefined && rolloutBucket(flag, ctx.tenantId) < rule.rolloutPercentage) return true;
    // 5) Plan flag.
    if (ctx.plan) {
      if (rule?.plans && rule.plans[ctx.plan] !== undefined) return rule.plans[ctx.plan]!;
      const planDefault = PLAN_FEATURES[ctx.plan]?.[flag];
      if (planDefault !== undefined && rule?.default === undefined && rule?.rolloutPercentage === undefined) return planDefault;
    }
    // 6) Global default.
    return rule?.default ?? false;
  }

  /** Resolve every known flag for a tenant → a flat map, cached under 'flags'. */
  resolveAll(ctx: FlagContext): Record<string, boolean> {
    const cached = this.cache.get<Record<string, boolean>>(ctx.tenantId, 'flags');
    if (cached) return cached;
    const flags = new Set<string>([
      ...this.repo.listGlobal().map((r) => r.flag),
      ...this.repo.listTenant(ctx.tenantId).map((r) => r.flag),
      ...Object.keys(PLAN_FEATURES[ctx.plan ?? TenantPlan.Starter]),
    ]);
    const out: Record<string, boolean> = {};
    for (const flag of flags) out[flag] = this.isEnabled(flag, ctx);
    this.cache.set(ctx.tenantId, 'flags', out);
    return out;
  }
}
