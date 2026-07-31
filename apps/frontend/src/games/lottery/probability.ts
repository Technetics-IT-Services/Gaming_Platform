/**
 * Number Lottery probability model (Sprint 4, STEP 3).
 *
 * Default game: pick 6 from 1–49, draw 6 main + 1 bonus. Tier probabilities are the
 * exact hypergeometric counts (no hardcoded numbers) — the count of draws that yield
 * each match tier for a fixed ticket, over C(49,6) main draws. There is no hardcoded
 * winning logic: `tierFor` classifies strictly from the matched numbers.
 */
import { PrizeTier } from './types';

/** Exact binomial coefficient C(n, k) (n ≤ 49). */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

export interface TierCounts {
  total: number;
  counts: Record<PrizeTier, number>;
}

/**
 * Winning-draw counts per tier for a Pick-`p` / range-`R` game with `p` main drawn +
 * bonus. For the default 6/49: total = C(49,6); a "match k" tier has
 * C(6,k)·C(R−p, p−k) draws; the 5-match total splits into 5+bonus and 5.
 */
export function tierCounts(pick = 6, range = 49): TierCounts {
  const total = choose(range, pick);
  const nonTicket = range - pick; // 43
  const matchK = (k: number) => choose(pick, k) * choose(nonTicket, pick - k);
  const match5 = matchK(5); // 258
  // Of the 258 five-match main-combos, the bonus equals the ticket's unmatched number
  // in exactly `C(pick,5)` of them (one per unmatched ticket slot) → 6.
  const fivePlusBonus = choose(pick, pick - 1); // 6
  return {
    total,
    counts: {
      [PrizeTier.Jackpot]: matchK(6),
      [PrizeTier.FivePlusBonus]: fivePlusBonus,
      [PrizeTier.Five]: match5 - fivePlusBonus,
      [PrizeTier.Four]: matchK(4),
      [PrizeTier.Three]: matchK(3),
      [PrizeTier.Two]: matchK(2),
    },
  };
}

/** Exact probability of each tier. */
export function tierProbabilities(pick = 6, range = 49): Record<PrizeTier, number> {
  const { total, counts } = tierCounts(pick, range);
  const out = {} as Record<PrizeTier, number>;
  for (const tier of Object.values(PrizeTier)) out[tier] = counts[tier] / total;
  return out;
}

/** Classify a result into a prize tier — strictly from the match counts. */
export function tierFor(matches: number, bonusMatch: boolean, pick = 6): PrizeTier | null {
  if (matches === pick) return PrizeTier.Jackpot;
  if (matches === pick - 1 && bonusMatch) return PrizeTier.FivePlusBonus;
  if (matches === pick - 1) return PrizeTier.Five;
  if (matches === 4) return PrizeTier.Four;
  if (matches === 3) return PrizeTier.Three;
  if (matches === 2) return PrizeTier.Two;
  return null;
}

/** Count matches of a ticket against the drawn main numbers. */
export function countMatches(ticket: number[], main: number[]): number {
  const set = new Set(main);
  return ticket.reduce((n, x) => n + (set.has(x) ? 1 : 0), 0);
}
