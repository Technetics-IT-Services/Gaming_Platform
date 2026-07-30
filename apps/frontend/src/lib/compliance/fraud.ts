/**
 * Fraud framework (Phase 5D, STEP 5).
 *
 * `FraudEngine` blends rule-based signals into a 0–100 `FraudScore`: velocity,
 * duplicate accounts (shared device/IP), rapid deposits/withdrawals, unusual bet
 * patterns and an impossible-travel hook. Weights are configurable and the engine
 * exposes an explicit ML integration point for a future model. Pure scoring — it
 * never moves money and never decides on its own (the policy/decision engines do).
 */
import {
  type DecisionContext,
  type DeviceResult,
  type FraudScore,
  type FraudSignal,
  OperationType,
  RiskLevel,
  type VelocityResult,
} from './types';

/** Optional plug for a future ML model — returns extra weighted signals. */
export interface FraudModel {
  readonly name: string;
  score(ctx: DecisionContext, features: FraudFeatures): FraudSignal[];
}

export interface FraudFeatures {
  velocity: VelocityResult[];
  device?: DeviceResult;
  /** Accounts seen sharing this device/IP fingerprint (duplicate-account hook). */
  linkedAccounts?: number;
  /** Distinct recent countries — feeds the impossible-travel hook. */
  recentCountries?: string[];
  /** Bet-size z-score vs the player's baseline (unusual-pattern hook). */
  betAnomaly?: number;
}

export interface FraudWeights {
  velocity: number;
  duplicateAccount: number;
  rapidDeposit: number;
  rapidWithdrawal: number;
  unusualBet: number;
  impossibleTravel: number;
  badDeviceReputation: number;
}

const DEFAULT_WEIGHTS: FraudWeights = {
  velocity: 25,
  duplicateAccount: 30,
  rapidDeposit: 20,
  rapidWithdrawal: 25,
  unusualBet: 20,
  impossibleTravel: 40,
  badDeviceReputation: 20,
};

export class FraudEngine {
  private readonly weights: FraudWeights;

  constructor(
    weights: Partial<FraudWeights> = {},
    private readonly model?: FraudModel,
  ) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  /** Compute a fraud score from context + resolved features. Deterministic. */
  score(ctx: DecisionContext, features: FraudFeatures): FraudScore {
    const signals: FraudSignal[] = [];
    const w = this.weights;

    const exceeded = features.velocity.filter((v) => v.exceeded);
    for (const v of exceeded) {
      if (v.kind === 'deposit') signals.push({ code: 'RAPID_DEPOSIT', weight: w.rapidDeposit, detail: `${v.count}/${v.limit}` });
      else if (v.kind === 'withdrawal') signals.push({ code: 'RAPID_WITHDRAWAL', weight: w.rapidWithdrawal, detail: `${v.count}/${v.limit}` });
      else signals.push({ code: 'VELOCITY', weight: w.velocity, detail: `${v.kind} ${v.count}/${v.limit}` });
    }

    if ((features.linkedAccounts ?? 0) > 1) {
      signals.push({ code: 'DUPLICATE_ACCOUNT', weight: w.duplicateAccount, detail: `${features.linkedAccounts} linked accounts` });
    }

    if (features.device && features.device.reputation.ipReputation < 40) {
      signals.push({ code: 'BAD_DEVICE_REPUTATION', weight: w.badDeviceReputation, detail: `ip rep ${features.device.reputation.ipReputation}` });
    }

    if (typeof features.betAnomaly === 'number' && Math.abs(features.betAnomaly) >= 3 && ctx.operation === OperationType.Bet) {
      signals.push({ code: 'UNUSUAL_BET_PATTERN', weight: w.unusualBet, detail: `z=${features.betAnomaly.toFixed(1)}` });
    }

    // Impossible-travel hook: two distinct countries in the recent window.
    if ((features.recentCountries?.length ?? 0) > 1) {
      signals.push({ code: 'IMPOSSIBLE_TRAVEL', weight: w.impossibleTravel, detail: features.recentCountries!.join('→') });
    }

    // Future ML integration point — a model contributes additional weighted signals.
    if (this.model) signals.push(...this.model.score(ctx, features));

    const raw = signals.reduce((s, sig) => s + sig.weight, 0);
    const score = Math.min(100, raw);
    return { score, level: FraudEngine.level(score), signals };
  }

  static level(score: number): RiskLevel {
    if (score >= 80) return RiskLevel.Critical;
    if (score >= 50) return RiskLevel.High;
    if (score >= 25) return RiskLevel.Medium;
    return RiskLevel.Low;
  }
}
