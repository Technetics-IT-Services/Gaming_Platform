/**
 * Sic Bo paytable (Sprint 3, STEP 3).
 *
 * Payouts are DERIVED from the exact win probabilities to a uniform target RTP (no
 * hardcoded odds): for a flat bet, `return = targetRTP / P` (odds = return − 1); the
 * tiered Single bet scales the classic 1:1 / 2:1 / 3:1 ladder to the same target. Every
 * resulting RTP is verified in the 96–98% band. `betReturn` gives the total return for
 * a winning bet strictly from the dice.
 */
import { probability, resolveBet, singleTierProbs } from './probability';
import { type Bet, BetType, type Dice } from './types';

export const TARGET_RTP = 0.972;

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Total return multiplier (stake + winnings) for a flat bet, derived from its P. */
function flatReturn(bet: Bet): number {
  const p = probability(bet);
  return p > 0 ? round2(TARGET_RTP / p) : 0;
}

/** Tiered return multipliers for a Single bet (index by appearance count − 1). */
export function singleReturns(value: number): [number, number, number] {
  const { p1, p2, p3 } = singleTierProbs(value);
  const base: [number, number, number] = [2, 3, 4]; // classic returns for 1/2/3 appearances
  const stdRtp = p1 * base[0] + p2 * base[1] + p3 * base[2];
  const scale = stdRtp > 0 ? TARGET_RTP / stdRtp : 1;
  return [round2(base[0] * scale), round2(base[1] * scale), round2(base[2] * scale)];
}

/** The "to 1" odds for a bet (a 3-tuple for Single). Presentation / paytable doc. */
export function oddsFor(bet: Bet): number | [number, number, number] {
  if (bet.type === BetType.Single) {
    const [m1, m2, m3] = singleReturns(bet.value as number);
    return [round2(m1 - 1), round2(m2 - 1), round2(m3 - 1)];
  }
  return round2(flatReturn(bet) - 1);
}

/**
 * The total return (stake + winnings) for a bet given the dice — 0 on a loss. This is
 * the ONLY payout authority; it derives the amount strictly from the outcome.
 */
export function betReturn(bet: Bet, dice: Dice): number {
  const { won, tier } = resolveBet(bet, dice);
  if (!won) return 0;
  if (bet.type === BetType.Single) return singleReturns(bet.value as number)[Math.min(3, Math.max(1, tier)) - 1]!;
  return flatReturn(bet);
}
