/**
 * Sic Bo probability model (Sprint 3, STEP 3).
 *
 * Three dice → 216 equally-likely outcomes. Every probability + win test is derived by
 * enumerating those outcomes and applying the bet rules — there is NO hardcoded winning
 * logic and no hardcoded counts. `resolveBet` decides a win strictly from the dice.
 */
import { type Bet, BetType, type Dice } from './types';

/** All 216 dice outcomes (deterministic order). */
export const ALL_OUTCOMES: Dice[] = (() => {
  const out: Dice[] = [];
  for (let a = 1; a <= 6; a += 1) for (let b = 1; b <= 6; b += 1) for (let c = 1; c <= 6; c += 1) out.push([a, b, c]);
  return out;
})();

export function total(dice: Dice): number {
  return dice[0] + dice[1] + dice[2];
}
export function isTriple(dice: Dice): boolean {
  return dice[0] === dice[1] && dice[1] === dice[2];
}
export function countOf(n: number, dice: Dice): number {
  return dice.filter((d) => d === n).length;
}

/**
 * Resolve a bet against a dice outcome. Returns `{ won, tier }` where `tier` is the
 * count of matches for a Single bet (drives its tiered payout), else 0.
 */
export function resolveBet(bet: Bet, dice: Dice): { won: boolean; tier: number } {
  const t = total(dice);
  const triple = isTriple(dice);
  const v = bet.value;
  switch (bet.type) {
    case BetType.Small:
      return { won: t >= 4 && t <= 10 && !triple, tier: 0 };
    case BetType.Big:
      return { won: t >= 11 && t <= 17 && !triple, tier: 0 };
    case BetType.Odd:
      return { won: t % 2 === 1 && !triple, tier: 0 };
    case BetType.Even:
      return { won: t % 2 === 0 && !triple, tier: 0 };
    case BetType.Single: {
      const c = countOf(v as number, dice);
      return { won: c >= 1, tier: c };
    }
    case BetType.Double:
      return { won: countOf(v as number, dice) >= 2, tier: 0 };
    case BetType.Triple:
      return { won: triple && dice[0] === (v as number), tier: 0 };
    case BetType.AnyTriple:
      return { won: triple, tier: 0 };
    case BetType.Combo2: {
      const [a, b] = v as number[];
      return { won: countOf(a!, dice) >= 1 && countOf(b!, dice) >= 1, tier: 0 };
    }
    case BetType.Combo3: {
      const [a, b, c] = v as number[];
      return { won: countOf(a!, dice) >= 1 && countOf(b!, dice) >= 1 && countOf(c!, dice) >= 1, tier: 0 };
    }
    case BetType.Total:
      return { won: t === (v as number), tier: 0 };
    default:
      return { won: false, tier: 0 };
  }
}

/** Count of the 216 outcomes that win this bet (exact). */
export function winCount(bet: Bet): number {
  return ALL_OUTCOMES.reduce((n, dice) => n + (resolveBet(bet, dice).won ? 1 : 0), 0);
}

/** Exact win probability of a bet. */
export function probability(bet: Bet): number {
  return winCount(bet) / 216;
}

/** For a Single bet: the distribution of match counts (1,2,3 appearances). */
export function singleTierProbs(value: number): { p1: number; p2: number; p3: number } {
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  for (const dice of ALL_OUTCOMES) {
    const c = countOf(value, dice);
    if (c === 1) p1 += 1;
    else if (c === 2) p2 += 1;
    else if (c === 3) p3 += 1;
  }
  return { p1: p1 / 216, p2: p2 / 216, p3: p3 / 216 };
}
