/**
 * Hi-Lo mathematics (Sprint 2).
 *
 * Standard 52-card deck (4 suits × ranks 2..14, Ace high), drawn WITHOUT replacement.
 * The multiplier for a prediction is the fair inverse-probability payout with a house
 * edge: `mult = (1 − edge) / P(prediction)`. Every step therefore returns `1 − edge`
 * in expectation, so cashing out at any point has an **RTP of 1 − edge (96–97%)**
 * regardless of the path. No hardcoded winning logic — probabilities come from the
 * live deck composition, the card itself from the provably-fair stream.
 */
import { type HiLoCard, type HiLoDirection, type HiLoOdds } from './types';

export function cardOf(id: number): HiLoCard {
  return { id, rank: (id % 13) + 2, suit: Math.floor(id / 13) };
}

/** Counts of remaining cards strictly higher / lower / equal to `rank`. */
export function counts(rank: number, remaining: number[]): { higher: number; lower: number; equal: number } {
  let higher = 0;
  let lower = 0;
  let equal = 0;
  for (const id of remaining) {
    const r = (id % 13) + 2;
    if (r > rank) higher += 1;
    else if (r < rank) lower += 1;
    else equal += 1;
  }
  return { higher, lower, equal };
}

/** Probability of a prediction given the current rank + remaining deck. */
export function probability(direction: HiLoDirection, rank: number, remaining: number[]): number {
  if (remaining.length === 0) return 0;
  const c = counts(rank, remaining);
  return c[direction] / remaining.length;
}

/** Fair multiplier for a prediction (0 if impossible). */
export function stepMultiplier(direction: HiLoDirection, rank: number, remaining: number[], edge: number): number {
  const p = probability(direction, rank, remaining);
  if (p <= 0) return 0;
  return Math.round(((1 - edge) / p) * 100) / 100;
}

/** The odds offered for each legal prediction at the current card. */
export function oddsFor(rank: number, remaining: number[], edge: number, allowEqual: boolean): HiLoOdds {
  const odds: HiLoOdds = {
    higher: stepMultiplier('higher', rank, remaining, edge),
    lower: stepMultiplier('lower', rank, remaining, edge),
  };
  if (allowEqual) odds.equal = stepMultiplier('equal', rank, remaining, edge);
  return odds;
}

/** Is a revealed card correct for a prediction? (Equal ties count only for 'equal'.) */
export function isCorrect(direction: HiLoDirection, currentRank: number, nextRank: number): boolean {
  if (direction === 'higher') return nextRank > currentRank;
  if (direction === 'lower') return nextRank < currentRank;
  return nextRank === currentRank;
}

/** A fresh, ordered 52-card deck (ids 0..51). */
export function fullDeck(): number[] {
  return Array.from({ length: 52 }, (_, i) => i);
}
