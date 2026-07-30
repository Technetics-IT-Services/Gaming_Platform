'use client';

import type {
  IBetRequest,
  IFairnessProof,
  IGameResult,
  IGameSession,
  IProvablyFairProvider,
} from '@gaming-platform/types';

import { createDeck, rankValue, shuffle, suitOf, type Card } from '@/lib/deck';
import type { RuntimeGameEngine } from '@/runtime/engine-registry';

/**
 * Teen Patti engine (Phase 3 migration).
 *
 * PURE 3-card hand ranking + comparison — byte-for-byte the previous logic; only
 * the RNG seed moves to the provably-fair provider. Ties go to the dealer (house
 * edge), the winning multiplier is 2 + a hand-rank bonus.
 */
const HAND_BONUS = [0, 0.2, 0.5, 1, 2, 4]; // extra multiplier on top of the even-money base

export interface HandRank {
  /** 1 (high card) … 6 (trail). */
  category: number;
  name: string;
  /** Tiebreaker card values, high → low. */
  tiebreak: number[];
}

/** Straight where A can be high (A-K-Q) or low (A-2-3). */
function isSequence(vals: number[]): boolean {
  const s = [...vals].sort((a, b) => b - a);
  const a = s[0]!;
  const b = s[1]!;
  const c = s[2]!;
  if (a - b === 1 && b - c === 1) return true;
  return a === 14 && b === 3 && c === 2;
}

export function evaluateHand(cards: Card[]): HandRank {
  const vals = cards.map(rankValue).sort((a, b) => b - a);
  const suits = cards.map(suitOf);
  const flush = suits.every((s) => s === suits[0]);
  const seq = isSequence(vals);

  const isWheel = vals[0] === 14 && vals[1] === 3 && vals[2] === 2;
  const seqTiebreak = isWheel ? [3, 2, 1] : vals;

  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const trail = [...counts.values()].some((n) => n === 3);
  const pairVal = [...counts.entries()].find(([, n]) => n === 2)?.[0];

  if (trail) return { category: 6, name: 'Trail', tiebreak: vals };
  if (seq && flush) return { category: 5, name: 'Pure Sequence', tiebreak: seqTiebreak };
  if (seq) return { category: 4, name: 'Sequence', tiebreak: seqTiebreak };
  if (flush) return { category: 3, name: 'Color', tiebreak: vals };
  if (pairVal !== undefined) {
    const kicker = vals.find((v) => v !== pairVal) ?? 0;
    return { category: 2, name: 'Pair', tiebreak: [pairVal, pairVal, kicker] };
  }
  return { category: 1, name: 'High Card', tiebreak: vals };
}

/** > 0 if a beats b, < 0 if b beats a, 0 on an exact tie. */
export function compareHands(a: HandRank, b: HandRank): number {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < a.tiebreak.length; i++) {
    const av = a.tiebreak[i] ?? 0;
    const bv = b.tiebreak[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

export interface TeenPattiState {
  player: Card[];
  dealer: Card[];
  playerRank: HandRank;
  dealerRank: HandRank;
  cmp: number;
}

function buildDeal(seed: number): { player: Card[]; dealer: Card[] } {
  const deck = shuffle(createDeck(), seed);
  return {
    player: [deck[0] ?? 'AS', deck[2] ?? 'KS', deck[4] ?? 'QS'],
    dealer: [deck[1] ?? 'AH', deck[3] ?? 'KH', deck[5] ?? 'QH'],
  };
}

export class TeenPattiEngine implements RuntimeGameEngine<unknown, unknown, TeenPattiState> {
  readonly engineKey = 'teen-patti';

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest;
    config: unknown;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<TeenPattiState> {
    const { session, rng, fairness } = input;
    const r = rng.nextFloat({ serverSeed: fairness.serverSeed ?? '', clientSeed: fairness.clientSeed, nonce: fairness.nonce });
    const { player, dealer } = buildDeal(Math.floor(r * 2 ** 31));
    const playerRank = evaluateHand(player);
    const dealerRank = evaluateHand(dealer);
    const cmp = compareHands(playerRank, dealerRank);

    const win = cmp > 0; // ties go to the dealer (house edge)
    const bonus = win ? (HAND_BONUS[playerRank.category - 1] ?? 0) : 0;
    const multiplier = win ? 2 + bonus : 0;
    const label = win ? `Win · ${playerRank.name}` : cmp === 0 ? 'Tie→dealer' : `Lost · ${dealerRank.name}`;

    return {
      roundId: '',
      gameId: session.gameId,
      state: { player, dealer, playerRank, dealerRank, cmp },
      multiplier,
      win,
      fairness,
      computedAt: new Date().toISOString(),
      display: { label, value: playerRank.category },
    };
  }
}
