/**
 * Texas Hold'em — hand evaluation (Sprint 5, STEP 4).
 *
 * Evaluates the best 5-card poker hand from any 5–7 cards by enumerating the C(7,5)=21
 * five-card subsets and taking the strongest. Every category is supported (High Card …
 * Royal Flush) with exact, lexicographic tiebreak ranks so ties (and split pots) are
 * decided precisely. Pure — no RNG, no IO.
 */
import { rankVal, suitOf, type Card } from './cards';
import { HandCategory, type PokerHand } from './types';

const CATEGORY_NAME: Record<HandCategory, string> = {
  [HandCategory.HighCard]: 'High Card',
  [HandCategory.Pair]: 'Pair',
  [HandCategory.TwoPair]: 'Two Pair',
  [HandCategory.ThreeOfAKind]: 'Three of a Kind',
  [HandCategory.Straight]: 'Straight',
  [HandCategory.Flush]: 'Flush',
  [HandCategory.FullHouse]: 'Full House',
  [HandCategory.FourOfAKind]: 'Four of a Kind',
  [HandCategory.StraightFlush]: 'Straight Flush',
  [HandCategory.RoyalFlush]: 'Royal Flush',
};

/** Highest card of a straight from distinct desc ranks, or 0 if none. Handles the wheel (A-2-3-4-5). */
function straightHigh(distinctDesc: number[]): number {
  const vals = distinctDesc.includes(14) ? [...distinctDesc, 1] : distinctDesc; // ace can be low
  for (let i = 0; i <= vals.length - 5; i += 1) {
    const window = vals.slice(i, i + 5);
    if (window[0]! - window[4]! === 4 && new Set(window).size === 5) return window[0]!;
  }
  return 0;
}

/** Score exactly 5 cards → a ranked PokerHand. */
export function evaluate5(cards: Card[]): PokerHand {
  const vals = cards.map(rankVal).sort((a, b) => b - a);
  const suits = cards.map(suitOf);
  const flush = suits.every((s) => s === suits[0]);
  const distinct = [...new Set(vals)].sort((a, b) => b - a);
  const high = straightHigh(distinct);
  const straight = high > 0;

  // rank → count, ordered by (count desc, rank desc)
  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]));
  const byCount = (n: number): number[] => groups.filter(([, c]) => c === n).map(([r]) => r);

  const quads = byCount(4);
  const trips = byCount(3);
  const pairs = byCount(2);
  const singles = byCount(1);

  let category: HandCategory;
  let ranks: number[];

  if (straight && flush) {
    category = high === 14 ? HandCategory.RoyalFlush : HandCategory.StraightFlush;
    ranks = [high];
  } else if (quads.length) {
    category = HandCategory.FourOfAKind;
    ranks = [quads[0]!, ...singles, ...pairs.filter((r) => r !== quads[0])];
  } else if (trips.length && pairs.length) {
    category = HandCategory.FullHouse;
    ranks = [trips[0]!, pairs[0]!];
  } else if (flush) {
    category = HandCategory.Flush;
    ranks = vals;
  } else if (straight) {
    category = HandCategory.Straight;
    ranks = [high];
  } else if (trips.length) {
    category = HandCategory.ThreeOfAKind;
    ranks = [trips[0]!, ...singles];
  } else if (pairs.length >= 2) {
    category = HandCategory.TwoPair;
    ranks = [pairs[0]!, pairs[1]!, ...singles];
  } else if (pairs.length === 1) {
    category = HandCategory.Pair;
    ranks = [pairs[0]!, ...singles];
  } else {
    category = HandCategory.HighCard;
    ranks = vals;
  }

  return { category, name: CATEGORY_NAME[category], ranks, cards: [...cards] };
}

/** All k-combinations of an array (used for best-5-of-7). */
function combos<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > arr.length) return [];
  const [head, ...tail] = arr;
  const withHead = combos(tail, k - 1).map((c) => [head!, ...c]);
  const withoutHead = combos(tail, k);
  return [...withHead, ...withoutHead];
}

/** Best 5-card hand from 5–7 cards. */
export function evaluate7(cards: Card[]): PokerHand {
  if (cards.length < 5) throw new Error('poker: need at least 5 cards to evaluate');
  if (cards.length === 5) return evaluate5(cards);
  let best: PokerHand | null = null;
  for (const five of combos(cards, 5)) {
    const h = evaluate5(five);
    if (!best || compareHands(h, best) > 0) best = h;
  }
  return best!;
}

/** > 0 if a beats b, < 0 if b beats a, 0 on an exact tie (split). */
export function compareHands(a: PokerHand, b: PokerHand): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.ranks.length, b.ranks.length);
  for (let i = 0; i < len; i += 1) {
    const av = a.ranks[i] ?? 0;
    const bv = b.ranks[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}
