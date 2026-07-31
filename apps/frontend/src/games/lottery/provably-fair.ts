/**
 * Number Lottery provably-fair draw (Sprint 4, STEP 5).
 *
 * The draw's main + bonus numbers (and quick-pick tickets) are derived ONLY from the
 * frozen `IProvablyFairProvider`: distinct numbers are drawn sequentially from a
 * shrinking pool using independent floats keyed by `(serverSeed, clientSeed, nonce*100
 * + index + base)`. Every draw is reproducible and verifiable.
 */
import type { IFairnessProof, IProvablyFairProvider } from '@gaming-platform/types';

import { type DrawResult } from './types';

/** Draw `count` distinct numbers from 1..range (without replacement). */
export function pickDistinct(rng: IProvablyFairProvider, fairness: IFairnessProof, count: number, range: number, base: number): number[] {
  const pool = Array.from({ length: range }, (_, i) => i + 1);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const f = rng.nextFloat({ serverSeed: fairness.serverSeed ?? '', clientSeed: fairness.clientSeed, nonce: fairness.nonce * 100 + base + i });
    const idx = Math.min(pool.length - 1, Math.floor(f * pool.length));
    out.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return out;
}

/** Derive the draw: `drawMain` main numbers (sorted) + 1 bonus. */
export function deriveDraw(rng: IProvablyFairProvider, fairness: IFairnessProof, opts: { drawMain: number; range: number; bonus: boolean }): DrawResult {
  const n = opts.drawMain + (opts.bonus ? 1 : 0);
  const drawn = pickDistinct(rng, fairness, n, opts.range, 0);
  const main = drawn.slice(0, opts.drawMain).sort((a, b) => a - b);
  const bonus = opts.bonus ? drawn[opts.drawMain]! : 0;
  return { main, bonus };
}

/** Provably-fair quick pick for a ticket (distinct, sorted). */
export function quickPick(rng: IProvablyFairProvider, fairness: IFairnessProof, opts: { pick: number; range: number }): number[] {
  return pickDistinct(rng, fairness, opts.pick, opts.range, 700).sort((a, b) => a - b);
}

export interface DrawVerification {
  valid: boolean;
  draw: DrawResult;
  reason?: string;
}

/** Verify a draw by re-deriving it from the revealed seeds. */
export function verifyDraw(rng: IProvablyFairProvider, input: { serverSeed: string; clientSeed: string; nonce: number; drawMain: number; range: number; bonus: boolean; expected: DrawResult }): DrawVerification {
  const draw = deriveDraw(rng, { serverSeed: input.serverSeed, serverSeedHash: '', clientSeed: input.clientSeed, nonce: input.nonce }, { drawMain: input.drawMain, range: input.range, bonus: input.bonus });
  const valid = draw.main.join(',') === input.expected.main.join(',') && draw.bonus === input.expected.bonus;
  return { valid, draw, reason: valid ? undefined : 'draw mismatch' };
}
