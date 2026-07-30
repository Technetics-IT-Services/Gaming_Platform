/**
 * Policy engine (Phase 5D, STEP 2).
 *
 * A registry of configurable, data-driven `DecisionRule`s evaluated against a
 * context + resolved signals. Rules are added/removed/toggled at runtime, so new
 * policy (jurisdictions, VIP tiers, responsible-gaming caps, business hours) ships
 * as configuration — never a code change. Rules are pure and NEVER move money.
 */
import {
  DecisionAction,
  type DecisionContext,
  type DecisionReason,
  type DecisionRule,
  type DecisionSignals,
  GeoStatus,
  OperationType,
  RiskFlag,
  RiskLevel,
  VerificationStatus,
} from './types';

export class PolicyEngine {
  private readonly rules = new Map<string, DecisionRule>();

  constructor(rules: DecisionRule[] = []) {
    for (const r of rules) this.rules.set(r.id, r);
  }

  /** Register or replace a rule at runtime. */
  set(rule: DecisionRule): this {
    this.rules.set(rule.id, rule);
    return this;
  }
  remove(id: string): this {
    this.rules.delete(id);
    return this;
  }
  toggle(id: string, enabled: boolean): this {
    const r = this.rules.get(id);
    if (r) r.enabled = enabled;
    return this;
  }
  list(): DecisionRule[] {
    return [...this.rules.values()];
  }

  /** Evaluate every enabled rule; collect the reasons that fired. */
  evaluate(ctx: DecisionContext, signals: DecisionSignals): DecisionReason[] {
    const reasons: DecisionReason[] = [];
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      const reason = rule.evaluate(ctx, signals);
      if (reason) reasons.push(reason);
    }
    return reasons;
  }
}

/** Small helper for authoring rules. */
function reason(code: string, message: string, severity: DecisionAction, source = 'policy'): DecisionReason {
  return { code, message, severity, source };
}

/** True when the context marks the player as a whitelisted VIP (policy exception). */
function isVip(ctx: DecisionContext): boolean {
  return ctx.attributes?.vip === true;
}

/**
 * A production-representative default policy set. Every threshold is a parameter,
 * so a deployment tunes limits without touching rule code.
 */
export function defaultPolicyRules(config?: {
  highValueAmount?: number;
  dailyWithdrawalMax?: number;
  restrictedCountries?: string[];
  businessHours?: { openHour: number; closeHour: number; timezoneOffsetMinutes?: number };
  responsibleGamingDailyMax?: number;
}): DecisionRule[] {
  const highValue = config?.highValueAmount ?? 500_000;
  const restricted = new Set((config?.restrictedCountries ?? ['US', 'IR', 'KP', 'SY']).map((c) => c.toUpperCase()));
  const rgMax = config?.responsibleGamingDailyMax;

  const rules: DecisionRule[] = [
    {
      id: 'kyc-required-for-withdrawal',
      description: 'Withdrawals require a verified KYC status.',
      enabled: true,
      evaluate: (ctx, s) => {
        if (ctx.operation !== OperationType.Withdrawal) return null;
        if (s.kyc?.status === VerificationStatus.Verified) return null;
        return reason('KYC_REQUIRED', 'KYC verification required before withdrawal.', DecisionAction.Hold, 'policy');
      },
    },
    {
      id: 'aml-sanctions-block',
      description: 'A sanctions or watchlist hit rejects the operation.',
      enabled: true,
      evaluate: (_ctx, s) => {
        if (!s.aml) return null;
        if (s.aml.flags.includes(RiskFlag.Sanctions)) return reason('AML_SANCTIONS', 'Sanctions list hit.', DecisionAction.Reject, 'policy');
        if (s.aml.flags.includes(RiskFlag.Watchlist)) return reason('AML_WATCHLIST', 'Watchlist hit.', DecisionAction.Escalate, 'policy');
        if (s.aml.flags.includes(RiskFlag.PEP)) return reason('AML_PEP', 'Politically-exposed person — enhanced review.', DecisionAction.ManualReview, 'policy');
        return null;
      },
    },
    {
      id: 'high-value-manual-review',
      description: `Transactions at/above ${highValue} minor units need manual review (VIP-exempt).`,
      enabled: true,
      evaluate: (ctx) => {
        if (ctx.amount === undefined || ctx.amount < highValue) return null;
        if (isVip(ctx)) return null;
        return reason('HIGH_VALUE', `High-value transaction (≥ ${highValue}).`, DecisionAction.ManualReview, 'policy');
      },
    },
    {
      id: 'restricted-jurisdiction',
      description: 'Block operations from restricted countries.',
      enabled: true,
      evaluate: (ctx, s) => {
        const country = (s.geo?.country ?? ctx.geo?.country)?.toUpperCase();
        if (country && restricted.has(country)) return reason('GEO_RESTRICTED', `Operation from restricted jurisdiction ${country}.`, DecisionAction.Reject, 'policy');
        if (s.geo?.status === GeoStatus.Blocked) return reason('GEO_BLOCKED', 'Location blocked by geo policy.', DecisionAction.Reject, 'policy');
        if (s.geo?.status === GeoStatus.Restricted) return reason('GEO_RESTRICTED_STATE', 'Location restricted by geo policy.', DecisionAction.Hold, 'policy');
        return null;
      },
    },
    {
      id: 'high-fraud-score',
      description: 'A high fraud score holds; a critical score rejects.',
      enabled: true,
      evaluate: (_ctx, s) => {
        if (!s.fraud) return null;
        if (s.fraud.level === RiskLevel.Critical) return reason('FRAUD_CRITICAL', `Critical fraud score (${s.fraud.score}).`, DecisionAction.Reject, 'policy');
        if (s.fraud.level === RiskLevel.High) return reason('FRAUD_HIGH', `High fraud score (${s.fraud.score}).`, DecisionAction.Hold, 'policy');
        return null;
      },
    },
    {
      id: 'velocity-exceeded',
      description: 'Any exceeded velocity window holds the operation.',
      enabled: true,
      evaluate: (_ctx, s) => {
        const hit = s.velocity?.find((v) => v.exceeded);
        if (!hit) return null;
        return reason('VELOCITY_EXCEEDED', `Velocity limit exceeded for ${hit.kind} (${hit.count}/${hit.limit}).`, DecisionAction.Hold, 'policy');
      },
    },
    {
      id: 'untrusted-device-review',
      description: 'A blocked device rejects; a suspicious device needs manual review.',
      enabled: true,
      evaluate: (_ctx, s) => {
        if (s.device?.risk === undefined) return null;
        if (s.device.risk === 'blocked') return reason('DEVICE_BLOCKED', 'Device blocked.', DecisionAction.Reject, 'policy');
        if (s.device.risk === 'suspicious') return reason('DEVICE_SUSPICIOUS', 'Suspicious device — manual review.', DecisionAction.ManualReview, 'policy');
        return null;
      },
    },
  ];

  if (config?.businessHours) {
    const { openHour, closeHour, timezoneOffsetMinutes = 0 } = config.businessHours;
    rules.push({
      id: 'business-hours-manual-review',
      description: `Operations outside ${openHour}:00–${closeHour}:00 need manual review.`,
      enabled: true,
      evaluate: (ctx) => {
        if (ctx.at === undefined) return null;
        const local = new Date(ctx.at + timezoneOffsetMinutes * 60_000);
        const hour = local.getUTCHours();
        if (hour >= openHour && hour < closeHour) return null;
        if (isVip(ctx)) return null;
        return reason('OUTSIDE_BUSINESS_HOURS', 'Operation outside business hours.', DecisionAction.ManualReview, 'policy');
      },
    });
  }

  if (rgMax !== undefined) {
    rules.push({
      id: 'responsible-gaming-cap',
      description: `Responsible-gaming daily cap of ${rgMax} minor units.`,
      enabled: true,
      evaluate: (ctx) => {
        const spent = typeof ctx.attributes?.dailySpent === 'number' ? ctx.attributes.dailySpent : 0;
        if (ctx.amount === undefined) return null;
        if (spent + ctx.amount <= rgMax) return null;
        return reason('RG_LIMIT', 'Responsible-gaming daily limit exceeded.', DecisionAction.Reject, 'policy');
      },
    });
  }

  return rules;
}
