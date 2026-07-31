/**
 * Texas Hold'em — provably-fair deck (Sprint 5, STEP 5).
 *
 * Reuses the shared card primitives (`@/lib/deck`) and shuffles a standard 52-card
 * deck deterministically from the FROZEN `IProvablyFairProvider`: a Fisher-Yates
 * pass whose every swap draws an independent float keyed by `(serverSeed, clientSeed,
 * nonce*100 + swapIndex)`. The shuffle is fully reproducible → any hand's deck, hole
 * cards and board can be re-derived and verified from the revealed seeds.
 */
import type { IFairnessProof, IProvablyFairProvider } from '@gaming-platform/types';

import { createDeck, rankOf, suitOf, type Card } from '@/lib/deck';

export { rankOf, suitOf, type Card };

/** Poker rank value: 2..10, J=11, Q=12, K=13, A=14 (ace low handled by the evaluator). */
export function rankVal(card: Card): number {
  const r = rankOf(card);
  if (r === 'A') return 14;
  if (r === 'K') return 13;
  if (r === 'Q') return 12;
  if (r === 'J') return 11;
  if (r === 'T') return 10;
  return Number(r);
}

/**
 * A provably-fair Fisher-Yates shuffle of a fresh 52-card deck. Deterministic in
 * `(serverSeed, clientSeed, nonce)`; `base` offsets the sub-nonce so independent
 * shuffles in the same round never collide.
 */
export function shuffleDeck(rng: IProvablyFairProvider, fairness: IFairnessProof, base = 0): Card[] {
  const deck = createDeck();
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const f = rng.nextFloat({
      serverSeed: fairness.serverSeed ?? '',
      clientSeed: fairness.clientSeed,
      nonce: fairness.nonce * 100 + base + (deck.length - 1 - i),
    });
    const j = Math.min(i, Math.floor(f * (i + 1)));
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }
  return deck;
}

export interface ShuffleVerification {
  valid: boolean;
  deck: Card[];
  reason?: string;
}

/** Verify a hand's deck by re-deriving the shuffle from the revealed seeds. */
export function verifyShuffle(
  rng: IProvablyFairProvider,
  input: { serverSeed: string; clientSeed: string; nonce: number; expected: Card[] },
): ShuffleVerification {
  const deck = shuffleDeck(rng, { serverSeed: input.serverSeed, serverSeedHash: '', clientSeed: input.clientSeed, nonce: input.nonce });
  const valid = deck.join(',') === input.expected.join(',');
  return { valid, deck, reason: valid ? undefined : 'deck mismatch' };
}

/**
 * Deal a hand from a shuffled deck. Hole cards are dealt one-at-a-time to each seat
 * (standard alternating order starting left of the button), then the board is taken
 * off the top (a burn card precedes the flop, turn and river as in live poker).
 */
export function deal(deck: Card[], seatCount: number): { holes: Card[][]; board: Card[] } {
  const holes: Card[][] = Array.from({ length: seatCount }, () => []);
  let k = 0;
  for (let round = 0; round < 2; round += 1) {
    for (let s = 0; s < seatCount; s += 1) {
      holes[s]!.push(deck[k]!);
      k += 1;
    }
  }
  k += 1; // burn
  const flop = [deck[k]!, deck[k + 1]!, deck[k + 2]!];
  k += 3;
  k += 1; // burn
  const turn = deck[k]!;
  k += 1;
  k += 1; // burn
  const river = deck[k]!;
  return { holes, board: [...flop, turn, river] };
}
