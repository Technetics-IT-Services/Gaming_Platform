/**
 * Sic Bo RTP (Sprint 3, STEP 3).
 *
 * Exact per-bet RTP over the 216 equally-likely outcomes: `RTP = Σ betReturn(bet,dice)
 * / 216`. Deterministic — no Monte-Carlo. Every bet type is calibrated into the 96–98%
 * band by the derived paytable; this module proves it.
 */
import { betReturn } from './paytable';
import { ALL_OUTCOMES } from './probability';
import { type Bet, BetType } from './types';

/** Exact RTP of a single bet (expected return per unit stake). */
export function betRtp(bet: Bet): number {
  return ALL_OUTCOMES.reduce((s, dice) => s + betReturn(bet, dice), 0) / 216;
}

/** House edge for a bet. */
export function betHouseEdge(bet: Bet): number {
  return 1 - betRtp(bet);
}

/** Every distinct bet in the table (for RTP verification + the paytable doc). */
export function allBets(): Bet[] {
  const bets: Bet[] = [{ type: BetType.Small }, { type: BetType.Big }, { type: BetType.Odd }, { type: BetType.Even }, { type: BetType.AnyTriple }];
  for (let n = 1; n <= 6; n += 1) {
    bets.push({ type: BetType.Single, value: n }, { type: BetType.Double, value: n }, { type: BetType.Triple, value: n });
  }
  for (let a = 1; a <= 6; a += 1) for (let b = a + 1; b <= 6; b += 1) bets.push({ type: BetType.Combo2, value: [a, b] });
  for (let a = 1; a <= 6; a += 1) for (let b = a + 1; b <= 6; b += 1) for (let c = b + 1; c <= 6; c += 1) bets.push({ type: BetType.Combo3, value: [a, b, c] });
  for (let t = 4; t <= 17; t += 1) bets.push({ type: BetType.Total, value: t });
  return bets;
}

/** Min/max RTP across the whole betting table. */
export function rtpRange(): { min: number; max: number; count: number } {
  const rtps = allBets().map(betRtp);
  return { min: Math.min(...rtps), max: Math.max(...rtps), count: rtps.length };
}
