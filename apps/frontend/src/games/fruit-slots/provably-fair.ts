/**
 * Fruit Slots provably-fair reel stops (Sprint 2).
 *
 * Each reel's stop index comes from an independent provably-fair float keyed by
 * `(serverSeed, clientSeed, nonce*100 + spin*10 + reel)` — so the base spin and every
 * free spin are reproducible and verifiable. Randomness lives only in the frozen
 * provider.
 */
import type { IFairnessProof, IProvablyFairProvider } from '@gaming-platform/types';

import { REELS } from './types';

/** Provider nonce for a reel on a given spin index within the round. */
export function reelNonce(nonce: number, spin: number, reel: number): number {
  return nonce * 100 + spin * 10 + reel;
}

/** Derive the 5 reel stops for a spin. `spin` = 0 base, 1..N free spins. */
export function reelStops(rng: IProvablyFairProvider, fairness: IFairnessProof, stripLength: number, spin: number): number[] {
  return Array.from({ length: REELS }, (_, reel) => {
    const f = rng.nextFloat({ serverSeed: fairness.serverSeed ?? '', clientSeed: fairness.clientSeed, nonce: reelNonce(fairness.nonce, spin, reel) });
    return Math.min(stripLength - 1, Math.floor(f * stripLength));
  });
}
