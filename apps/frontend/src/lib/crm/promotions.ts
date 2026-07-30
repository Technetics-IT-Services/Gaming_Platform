/**
 * Promotion engine (Phase 6B, STEP 6).
 *
 * Campaigns, coupon/promo codes, seasonal events, challenges + daily missions with
 * eligibility rules, scheduling (active windows) and leaderboard hooks. Evaluates
 * eligibility and tracks redemptions/progress — it grants rewards through the CRM's
 * own engines (loyalty/bonus), never through money movement.
 */
import type { Campaign, Challenge, CodeKind, PromoCode, Schedule, Segment } from './types';

function active(schedule: Schedule, now: number): boolean {
  if (schedule.startsAt !== undefined && now < schedule.startsAt) return false;
  if (schedule.endsAt !== undefined && now > schedule.endsAt) return false;
  return true;
}

export class PromotionEngine {
  private readonly campaigns = new Map<string, Campaign>();
  private readonly codes = new Map<string, PromoCode>();
  private readonly challenges = new Map<string, Challenge>();
  /** code → player → redemption count (per-player limit enforcement). */
  private readonly redemptionsByPlayer = new Map<string, Map<string, number>>();
  /** challengeId → player → progress. */
  private readonly progress = new Map<string, Map<string, number>>();

  constructor(private readonly clock: () => number = () => Date.now()) {}

  /* ------------------------------- campaigns ------------------------------ */

  createCampaign(c: Campaign): Campaign {
    this.campaigns.set(c.id, c);
    return c;
  }
  listCampaigns(): Campaign[] {
    return [...this.campaigns.values()];
  }
  /** Active campaigns a player (with these segments) is eligible for now. */
  eligibleCampaigns(playerSegments: Segment[], now: number = this.clock()): Campaign[] {
    const set = new Set(playerSegments);
    return this.listCampaigns().filter((c) => c.enabled && active(c.schedule, now) && (c.segments.length === 0 || c.segments.some((s) => set.has(s))));
  }

  /* --------------------------------- codes -------------------------------- */

  createCode(code: PromoCode): PromoCode {
    this.codes.set(code.code.toUpperCase(), code);
    return code;
  }

  /** Validate a coupon/promo code for a player without consuming it. */
  validateCode(code: string, playerId: string, now: number = this.clock()): { ok: boolean; reason?: string; promo?: PromoCode } {
    const promo = this.codes.get(code.toUpperCase());
    if (!promo || !promo.enabled) return { ok: false, reason: 'unknown or disabled code' };
    if (!active(promo.schedule, now)) return { ok: false, reason: 'code not in active window' };
    if (promo.maxRedemptions !== undefined && promo.redemptions >= promo.maxRedemptions) return { ok: false, reason: 'code exhausted' };
    if (promo.perPlayerLimit !== undefined) {
      const used = this.redemptionsByPlayer.get(promo.code.toUpperCase())?.get(playerId) ?? 0;
      if (used >= promo.perPlayerLimit) return { ok: false, reason: 'per-player limit reached' };
    }
    return { ok: true, promo };
  }

  /** Redeem a code (increments counters). Reward application is the caller's job. */
  redeemCode(code: string, playerId: string, now: number = this.clock()): { ok: boolean; reason?: string; reward?: PromoCode['reward'] } {
    const check = this.validateCode(code, playerId, now);
    if (!check.ok || !check.promo) return { ok: false, reason: check.reason };
    const promo = check.promo;
    promo.redemptions += 1;
    const perPlayer = this.redemptionsByPlayer.get(promo.code.toUpperCase()) ?? new Map<string, number>();
    perPlayer.set(playerId, (perPlayer.get(playerId) ?? 0) + 1);
    this.redemptionsByPlayer.set(promo.code.toUpperCase(), perPlayer);
    return { ok: true, reward: promo.reward };
  }

  isSeasonalActive(kind: CodeKind, now: number = this.clock()): boolean {
    return [...this.codes.values()].some((c) => c.kind === kind && active(c.schedule, now));
  }

  /* ----------------------- challenges & daily missions -------------------- */

  createChallenge(c: Challenge): Challenge {
    this.challenges.set(c.id, c);
    return c;
  }
  listChallenges(daily?: boolean): Challenge[] {
    return [...this.challenges.values()].filter((c) => daily === undefined || c.daily === daily);
  }

  /** Advance a player's progress; returns completion + reward when the target is hit. */
  advanceChallenge(challengeId: string, playerId: string, by = 1, now: number = this.clock()): { progress: number; completed: boolean; reward?: Challenge['reward'] } {
    const ch = this.challenges.get(challengeId);
    if (!ch) throw new Error('no such challenge');
    if (!active(ch.schedule, now)) return { progress: 0, completed: false };
    const perPlayer = this.progress.get(challengeId) ?? new Map<string, number>();
    const next = Math.min(ch.target, (perPlayer.get(playerId) ?? 0) + by);
    perPlayer.set(playerId, next);
    this.progress.set(challengeId, perPlayer);
    const completed = next >= ch.target;
    return { progress: next, completed, reward: completed ? ch.reward : undefined };
  }

  /** Reset daily-mission progress (scheduled sweep). */
  resetDailyMissions(): void {
    for (const ch of this.challenges.values()) if (ch.daily) this.progress.delete(ch.id);
  }
}
