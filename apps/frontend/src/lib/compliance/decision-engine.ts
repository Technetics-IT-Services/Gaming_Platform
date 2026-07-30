/**
 * Decision engine (Phase 5D, STEP 1).
 *
 * Pure aggregation: given a context + already-resolved signals + the policy reasons,
 * it derives ONE `DecisionResult`. The most severe reason wins (Reject > Escalate >
 * Hold > ManualReview > Approve); an empty reason set is `Approve`. It computes an
 * aggregate risk score but **never moves money** — Treasury reads `allowed` and acts.
 */
import { type PolicyEngine } from './policy-engine';
import {
  DECISION_SEVERITY,
  DecisionAction,
  type DecisionContext,
  type DecisionReason,
  type DecisionResult,
  type DecisionSignals,
  RiskLevel,
} from './types';

const RISK_WEIGHT: Record<RiskLevel, number> = {
  [RiskLevel.Low]: 10,
  [RiskLevel.Medium]: 40,
  [RiskLevel.High]: 70,
  [RiskLevel.Critical]: 100,
};

export class DecisionEngine {
  constructor(private readonly policy: PolicyEngine) {}

  /** Combine policy reasons + signals into a single decision. Deterministic + pure. */
  evaluate(ctx: DecisionContext, signals: DecisionSignals, at: number, correlationId: string): DecisionResult {
    const reasons = this.policy.evaluate(ctx, signals);
    const action = DecisionEngine.combine(reasons);
    return {
      action,
      allowed: action === DecisionAction.Approve,
      reasons,
      riskScore: DecisionEngine.riskScore(signals),
      signals,
      correlationId,
      at,
    };
  }

  /** The final action is the most severe of all fired reasons (Approve if none). */
  static combine(reasons: DecisionReason[]): DecisionAction {
    let action = DecisionAction.Approve;
    for (const r of reasons) {
      if (DECISION_SEVERITY[r.severity] > DECISION_SEVERITY[action]) action = r.severity;
    }
    return action;
  }

  /** Aggregate 0–100 risk score blended across the engines' signals. */
  static riskScore(signals: DecisionSignals): number {
    const parts: number[] = [];
    if (signals.fraud) parts.push(signals.fraud.score);
    if (signals.aml) parts.push(RISK_WEIGHT[signals.aml.riskLevel]);
    if (signals.device) parts.push(100 - signals.device.reputation.ipReputation);
    if (signals.velocity?.some((v) => v.exceeded)) parts.push(60);
    if (parts.length === 0) return 0;
    // Risk is dominated by the worst signal, nudged up by the average of the rest.
    const max = Math.max(...parts);
    const avg = parts.reduce((s, n) => s + n, 0) / parts.length;
    return Math.min(100, Math.round(max * 0.7 + avg * 0.3));
  }
}
