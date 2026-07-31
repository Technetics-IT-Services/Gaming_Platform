/**
 * Feature Flag Platform (Phase 3.1, STEP 7).
 *
 * Resolves a flag for a given tenant/operator through a precedence chain:
 *   Emergency Kill Switch → Tenant override → Operator rollout → Percentage rollout →
 *   Plan flag → Global default.
 * Supports global flags, per-tenant flags, per-plan flags, deterministic percentage
 * rollouts, operator allow-lists and an emergency kill switch. Deterministic (a stable
 * hash of flag+tenant drives percentage rollout — no RNG). Additive; no frozen module.
 */
import { PLAN_FEATURES } from './defaults';
import { type TenantContext, TenantPlan } from './types';

export interface FlagRule {
  /** Global default when nothing more specific matches. */
  default?: boolean;
  /** Per-plan values. */
  plans?: Partial<Record<TenantPlan, boolean>>;
  /** Percentage of tenants the flag is on for (0–100), by stable hash. */
  rolloutPercentage?: number;
  /** Operators the flag is force-enabled for. */
  operatorAllowList?: string[];
  /** Kill switch — when true the flag is OFF for everyone, overriding all else. */
  killSwitch?: boolean;
}

export interface FlagEvaluationInput {
  tenantId: string;
  operatorId?: string;
  plan?: TenantPlan;
  /** Tenant-level explicit override (from `tenant.features`). */
  tenantOverride?: boolean;
}

/** Deterministic 0–99 bucket for (flag, tenant) — stable across runs. */
function bucket(flag: string, tenantId: string): number {
  let h = 2166136261;
  const s = `${flag}:${tenantId}`;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100;
}

export class FeatureFlagService {
  private readonly rules = new Map<string, FlagRule>();

  /** Register or replace a flag's rule. */
  define(flag: string, rule: FlagRule): void {
    this.rules.set(flag, rule);
  }
  /** Flip the emergency kill switch for a flag. */
  setKillSwitch(flag: string, on: boolean): void {
    const rule = this.rules.get(flag) ?? {};
    rule.killSwitch = on;
    this.rules.set(flag, rule);
  }
  get(flag: string): FlagRule | undefined {
    return this.rules.get(flag);
  }
  list(): string[] {
    return [...this.rules.keys()];
  }

  /** Evaluate one flag for a tenant through the precedence chain. */
  isEnabled(flag: string, input: FlagEvaluationInput): boolean {
    const rule = this.rules.get(flag);

    // 1) Kill switch always wins.
    if (rule?.killSwitch) return false;
    // 2) Explicit tenant override.
    if (input.tenantOverride !== undefined) return input.tenantOverride;
    // 3) Operator allow-list.
    if (rule?.operatorAllowList && input.operatorId && rule.operatorAllowList.includes(input.operatorId)) return true;
    // 4) Percentage rollout (deterministic).
    if (rule?.rolloutPercentage !== undefined) {
      if (bucket(flag, input.tenantId) < rule.rolloutPercentage) return true;
    }
    // 5) Plan flag (explicit rule, then the plan defaults).
    if (input.plan) {
      if (rule?.plans && rule.plans[input.plan] !== undefined) return rule.plans[input.plan]!;
      const planDefault = PLAN_FEATURES[input.plan]?.[flag];
      if (planDefault !== undefined && !rule) return planDefault;
      if (planDefault !== undefined && rule?.default === undefined && rule?.rolloutPercentage === undefined) return planDefault;
    }
    // 6) Global default.
    return rule?.default ?? false;
  }

  /** Resolve every known flag (+ any extra keys) for a tenant → a flat map. */
  resolveAll(input: FlagEvaluationInput, tenantOverrides: Record<string, boolean> = {}, extraFlags: string[] = []): Record<string, boolean> {
    const flags = new Set<string>([...this.rules.keys(), ...Object.keys(tenantOverrides), ...extraFlags, ...Object.keys(PLAN_FEATURES[input.plan ?? TenantPlan.Starter])]);
    const out: Record<string, boolean> = {};
    for (const flag of flags) {
      out[flag] = this.isEnabled(flag, { ...input, tenantOverride: flag in tenantOverrides ? tenantOverrides[flag] : undefined });
    }
    return out;
  }
}

/** Convenience reader over an already-resolved context. */
export function contextFlag(ctx: TenantContext, flag: string): boolean {
  return ctx.featureFlags[flag] ?? false;
}
