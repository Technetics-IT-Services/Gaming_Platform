'use client';

import type {
  IBetRequest,
  IFairnessProof,
  IGameResult,
  IGameSession,
  IProvablyFairProvider,
} from '@gaming-platform/types';

import { seededRng } from '@/lib/deck';
import type { RuntimeGameEngine } from '@/runtime/engine-registry';

/**
 * Plinko engine (Phase 2.3B migration).
 *
 * PURE game rules. The board (12 rows), the multiplier table, and the per-row
 * left/right walk are byte-for-byte the previous in-component logic. Randomness is
 * ENCAPSULATED here (allowed): the provably-fair float seeds the same `mulberry32`
 * walk the game used before, so the bin distribution is identical while the seed
 * is now provably-fair. The per-row `dirs` are returned so the ball animates the
 * exact same path.
 */
export interface PlinkoConfig {
  rows: number;
  /** Symmetric multiplier table (edges high, centre low). */
  mult: number[];
}
export const PLINKO_MULT = [16, 8, 4, 2, 1.2, 0.7, 0.4, 0.7, 1.2, 2, 4, 8, 16];
export const PLINKO_CONFIG: PlinkoConfig = { rows: 12, mult: PLINKO_MULT };

export interface PlinkoState {
  /** Per-row step: -1 (left) or +1 (right) — drives the ball animation. */
  dirs: number[];
  /** Landing bin index (0..rows). */
  bin: number;
  /** Bin multiplier. */
  mult: number;
}

export class PlinkoEngine implements RuntimeGameEngine<PlinkoConfig, unknown, PlinkoState> {
  readonly engineKey = 'plinko';

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest;
    config: PlinkoConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<PlinkoState> {
    const { session, config, rng, fairness } = input;
    const serverSeed = fairness.serverSeed ?? '';
    const r = rng.nextFloat({ serverSeed, clientSeed: fairness.clientSeed, nonce: fairness.nonce });

    // Randomness encapsulated in the engine: provably-fair float → mulberry32 walk.
    const prng = seededRng(Math.floor(r * 2 ** 31));
    const dirs: number[] = [];
    let rights = 0;
    for (let i = 0; i < config.rows; i += 1) {
      const right = prng() > 0.5 ? 1 : 0;
      rights += right;
      dirs.push(right ? 1 : -1);
    }
    const bin = rights;
    const mult = config.mult[bin] ?? 1;
    // Preserved semantics: only mult ≥ 1 is a paying win (sub-1 bins lose the stake).
    const win = mult >= 1;

    return {
      roundId: '',
      gameId: session.gameId,
      state: { dirs, bin, mult },
      multiplier: win ? mult : 0,
      win,
      fairness,
      computedAt: new Date().toISOString(),
      // History strip shows the bin multiplier exactly as before (e.g. "0.7×", "16×").
      display: { label: `${mult}×`, value: mult },
    };
  }
}
