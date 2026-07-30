/**
 * Loyalty engine (Phase 6B, STEP 3).
 *
 * Logical points / XP / levels with earn, redeem, manual adjustment, point + level
 * history, a reward catalog, and expiration hooks. Points are a LOGICAL engagement
 * currency — never ledger money, never posted to the wallet. Deterministic + auditable.
 */
import { LoyaltyEventType, type LevelChange, type LoyaltyAccount, type LoyaltyReward, type PointEntry } from './types';

/** XP thresholds per level (index = level). Configurable. */
const DEFAULT_LEVELS = [0, 100, 500, 1_500, 5_000, 15_000, 50_000];

export class LoyaltyEngine {
  private readonly accounts = new Map<string, LoyaltyAccount>();
  private readonly rewards = new Map<string, LoyaltyReward>();
  private seq = 0;

  constructor(
    private readonly levelThresholds: number[] = DEFAULT_LEVELS,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  private id(): string {
    this.seq += 1;
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return `pt_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  account(playerId: string): LoyaltyAccount {
    let a = this.accounts.get(playerId);
    if (!a) {
      a = { playerId, points: 0, lifetimePoints: 0, level: 0, xp: 0, history: [], levelHistory: [] };
      this.accounts.set(playerId, a);
    }
    return a;
  }

  private levelForXp(xp: number): number {
    let level = 0;
    for (let i = 0; i < this.levelThresholds.length; i += 1) {
      if (xp >= (this.levelThresholds[i] ?? Infinity)) level = i;
    }
    return level;
  }

  private applyLevel(a: LoyaltyAccount, reason: string): void {
    const newLevel = this.levelForXp(a.xp);
    if (newLevel !== a.level) {
      a.levelHistory.push({ from: a.level, to: newLevel, at: this.clock(), reason });
      a.level = newLevel;
    }
  }

  /** Earn points (also accrues XP toward level progression). */
  earn(playerId: string, points: number, reason: string, opts?: { expiresAt?: number }): PointEntry {
    if (points <= 0) throw new Error('earn points must be positive');
    const a = this.account(playerId);
    const entry: PointEntry = { id: this.id(), type: LoyaltyEventType.Earn, points, reason, at: this.clock(), expiresAt: opts?.expiresAt };
    a.points += points;
    a.lifetimePoints += points;
    a.xp += points;
    a.history.push(entry);
    this.applyLevel(a, reason);
    return entry;
  }

  /** Redeem points for a reward (or an ad-hoc cost). Never pays real money. */
  redeem(playerId: string, cost: number, reason: string): PointEntry {
    const a = this.account(playerId);
    if (cost <= 0) throw new Error('redeem cost must be positive');
    if (a.points < cost) throw new Error('insufficient points');
    a.points -= cost;
    const entry: PointEntry = { id: this.id(), type: LoyaltyEventType.Redeem, points: -cost, reason, at: this.clock() };
    a.history.push(entry);
    return entry;
  }

  redeemReward(playerId: string, rewardId: string): PointEntry {
    const reward = this.rewards.get(rewardId);
    if (!reward) throw new Error('no such reward');
    return this.redeem(playerId, reward.cost, `reward:${reward.name}`);
  }

  /** Manual adjustment (positive or negative), audited via history + actor. */
  adjust(playerId: string, points: number, reason: string, actor: string): PointEntry {
    const a = this.account(playerId);
    a.points = Math.max(0, a.points + points);
    if (points > 0) {
      a.lifetimePoints += points;
      a.xp += points;
    }
    const entry: PointEntry = { id: this.id(), type: LoyaltyEventType.Adjust, points, reason, at: this.clock(), actor };
    a.history.push(entry);
    this.applyLevel(a, `manual: ${reason}`);
    return entry;
  }

  /** Expire earned points whose `expiresAt` has passed (future-expiration hook). */
  expire(playerId: string, now: number = this.clock()): number {
    const a = this.account(playerId);
    let expired = 0;
    for (const e of a.history) {
      if (e.type === LoyaltyEventType.Earn && e.expiresAt !== undefined && now >= e.expiresAt && !e.actor?.startsWith('expired:')) {
        // mark as consumed by tagging; deduct remaining balance up to the entry amount
        const take = Math.min(a.points, e.points);
        if (take > 0) {
          a.points -= take;
          expired += take;
          a.history.push({ id: this.id(), type: LoyaltyEventType.Expire, points: -take, reason: `expired ${e.id}`, at: now });
        }
        e.actor = `expired:${e.id}`;
      }
    }
    return expired;
  }

  addReward(reward: LoyaltyReward): void {
    this.rewards.set(reward.id, reward);
  }
  listRewards(): LoyaltyReward[] {
    return [...this.rewards.values()];
  }

  tierProgress(playerId: string): { level: number; xp: number; nextLevelXp?: number; progress: number } {
    const a = this.account(playerId);
    const next = this.levelThresholds[a.level + 1];
    if (next === undefined) return { level: a.level, xp: a.xp, progress: 1 };
    const base = this.levelThresholds[a.level] ?? 0;
    return { level: a.level, xp: a.xp, nextLevelXp: next, progress: Math.min(1, (a.xp - base) / (next - base)) };
  }

  history(playerId: string): PointEntry[] {
    return [...this.account(playerId).history].sort((x, y) => y.at - x.at);
  }
  levelHistory(playerId: string): LevelChange[] {
    return [...this.account(playerId).levelHistory];
  }
}
