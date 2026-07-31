/**
 * Texas Hold'em — provably-fair replay & verification (Sprint 5, STEP 5).
 *
 * Every hand's deck is a deterministic function of the revealed seeds. Given
 * `(serverSeed, clientSeed, nonce)` and the seat count, a player can re-derive the exact
 * shuffled deck, each seat's hole cards, and the board — then confirm they match what
 * was dealt. Reuses the frozen `IProvablyFairProvider`.
 */
import type { IProvablyFairProvider } from '@gaming-platform/types';

import { deal, shuffleDeck, type Card } from './cards';

export interface HandReplay {
  deck: Card[];
  holes: Card[][];
  board: Card[];
}

/** Re-derive the full deal (deck, holes, board) from the revealed seeds. */
export function replayHand(
  rng: IProvablyFairProvider,
  input: { serverSeed: string; clientSeed: string; nonce: number; seatCount: number },
): HandReplay {
  const deck = shuffleDeck(rng, { serverSeed: input.serverSeed, serverSeedHash: '', clientSeed: input.clientSeed, nonce: input.nonce });
  const { holes, board } = deal(deck, input.seatCount);
  return { deck, holes, board };
}

export interface HandVerification {
  valid: boolean;
  replay: HandReplay;
  reason?: string;
}

/** Verify a hand by re-deriving its deck and comparing to what was dealt. */
export function verifyHand(
  rng: IProvablyFairProvider,
  input: { serverSeed: string; clientSeed: string; nonce: number; seatCount: number; expectedDeck: Card[] },
): HandVerification {
  const replay = replayHand(rng, input);
  const valid = replay.deck.join(',') === input.expectedDeck.join(',');
  return { valid, replay, reason: valid ? undefined : 'deck mismatch' };
}
