'use client';

import type { IFairnessProof, IProvablyFairProvider } from '@gaming-platform/types';

/**
 * Provably-fair helpers for the instant-games catalog (Phase 4).
 *
 * Every new game derives ALL its randomness from the runtime's provably-fair
 * provider — no `Math.random`, no local generators. Multi-value games (Keno draws,
 * Mines board, Tower traps) need several independent floats from a single round's
 * fairness, so we vary the `clientSeed` by an index. Fully reproducible from the
 * committed seeds, exactly like the single-value games.
 */

/** i-th independent float in `[0,1)` for a round, deterministic + reproducible. */
export function floatAt(rng: IProvablyFairProvider, fairness: IFairnessProof, index: number): number {
  return rng.nextFloat({
    serverSeed: fairness.serverSeed ?? '',
    clientSeed: `${fairness.clientSeed}#${index}`,
    nonce: fairness.nonce,
  });
}

/** A provably-fair Fisher–Yates permutation of `[0, n)`. */
export function shuffleFair(n: number, rng: IProvablyFairProvider, fairness: IFairnessProof): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(floatAt(rng, fairness, i) * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}
