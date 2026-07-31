/**
 * Number Lottery prize table + RTP (Sprint 4, STEP 3).
 *
 * Fixed-odds prizes (multiples of the ticket price) calibrated so the total RTP lands
 * in the 96–97% band. RTP = Σ P(tier) × prizeMultiplier(tier), computed exactly from
 * the hypergeometric probabilities — deterministic, no Monte-Carlo. The table is
 * configurable; changing it re-derives the RTP.
 */
import { tierCounts, tierProbabilities } from './probability';
import { type PrizeTable, PrizeTier } from './types';

/** Default prize table (× ticket price) for Pick-6 / 1–49 + bonus. */
export const DEFAULT_PRIZE_TABLE: PrizeTable = {
  [PrizeTier.Jackpot]: 4_000_000,
  [PrizeTier.FivePlusBonus]: 150_000,
  [PrizeTier.Five]: 3_000,
  [PrizeTier.Four]: 105,
  [PrizeTier.Three]: 11,
  [PrizeTier.Two]: 2,
};

/** Exact RTP for a prize table over the tier probabilities. */
export function rtp(prizeTable: PrizeTable, pick = 6, range = 49): number {
  const p = tierProbabilities(pick, range);
  return Object.values(PrizeTier).reduce((s, tier) => s + p[tier] * prizeTable[tier], 0);
}

/** Per-tier RTP contribution (for the RTP doc). */
export function rtpBreakdown(prizeTable: PrizeTable, pick = 6, range = 49): Record<PrizeTier, { probability: number; oneIn: number; multiplier: number; rtpShare: number }> {
  const { total, counts } = tierCounts(pick, range);
  const out = {} as Record<PrizeTier, { probability: number; oneIn: number; multiplier: number; rtpShare: number }>;
  for (const tier of Object.values(PrizeTier)) {
    const prob = counts[tier] / total;
    out[tier] = { probability: prob, oneIn: Math.round(total / counts[tier]), multiplier: prizeTable[tier], rtpShare: prob * prizeTable[tier] };
  }
  return out;
}
