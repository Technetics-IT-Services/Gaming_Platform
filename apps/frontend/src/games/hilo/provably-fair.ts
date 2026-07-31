/**
 * Hi-Lo provably-fair card draw (Sprint 2).
 *
 * Each card is drawn from the remaining deck using an independent provably-fair float
 * keyed by `(serverSeed, clientSeed, nonce*100 + drawIndex)` — reproducible and
 * verifiable. Randomness lives only in the frozen `IProvablyFairProvider`.
 */
import type { IFairnessProof, IProvablyFairProvider } from '@gaming-platform/types';

import { cardOf } from './math';
import { type HiLoCard, type HiLoDirection, type HiLoRecord } from './types';

export function drawNonce(nonce: number, draw: number): number {
  return nonce * 100 + draw;
}

/** Draw one card from `remaining` (without replacement). Returns the card + rest. */
export function drawCard(rng: IProvablyFairProvider, fairness: IFairnessProof, draw: number, remaining: number[]): { card: HiLoCard; remaining: number[] } {
  const f = rng.nextFloat({ serverSeed: fairness.serverSeed ?? '', clientSeed: fairness.clientSeed, nonce: drawNonce(fairness.nonce, draw) });
  const idx = Math.min(remaining.length - 1, Math.floor(f * remaining.length));
  const id = remaining[idx]!;
  const rest = [...remaining.slice(0, idx), ...remaining.slice(idx + 1)];
  return { card: cardOf(id), remaining: rest };
}

export interface HiLoVerification {
  valid: boolean;
  cards: HiLoCard[];
  reason?: string;
}

/**
 * Verify a completed round: replay the exact draws from the revealed seeds and
 * confirm they match the recorded cards + prediction outcomes.
 */
export function verifyRound(rng: IProvablyFairProvider, input: { serverSeed: string; clientSeed: string; nonce: number; cards: HiLoCard[]; predictions: HiLoDirection[]; cashed: boolean }): HiLoVerification {
  const fairness: IFairnessProof = { serverSeed: input.serverSeed, serverSeedHash: '', clientSeed: input.clientSeed, nonce: input.nonce };
  let remaining = Array.from({ length: 52 }, (_, i) => i);
  const cards: HiLoCard[] = [];
  const draws = input.cashed ? input.predictions.length + 1 : input.predictions.length + 1;
  for (let d = 0; d < draws && remaining.length > 0; d += 1) {
    const { card, remaining: rest } = drawCard(rng, fairness, d, remaining);
    cards.push(card);
    remaining = rest;
  }
  const matches = cards.length === input.cards.length && cards.every((c, i) => c.id === input.cards[i]?.id);
  return { valid: matches, cards, reason: matches ? undefined : 'card sequence mismatch' };
}

/** Provably-fair summary for the UI panel. */
export function hiloFairness(rng: IProvablyFairProvider, record: HiLoRecord): { verified: boolean } & HiLoRecord {
  const verified =
    record.serverSeed !== undefined
      ? verifyRound(rng, { serverSeed: record.serverSeed, clientSeed: record.clientSeed, nonce: record.nonce, cards: record.cards, predictions: record.predictions, cashed: record.cashed }).valid
      : false;
  return { ...record, verified };
}
