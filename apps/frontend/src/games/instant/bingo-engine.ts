'use client';

import type {
  IBetRequest,
  IFairnessProof,
  IGameResult,
  IGameSession,
  IProvablyFairProvider,
} from '@gaming-platform/types';

import type { RuntimeGameEngine } from '@/runtime/engine-registry';

import { shuffleFair } from './rng';

/**
 * Bingo engine (Phase 4 — instant, single-shot).
 *
 * Rules: a 5×5 card; the round draws `draws` cells (provably fair); the payout is
 * driven by how many of the 12 lines (5 rows + 5 cols + 2 diagonals) are fully
 * marked. PURE: no wallet/history.
 */
export interface BingoConfig {
  size: number;
  draws: number;
  /** paytable[linesCompleted] → multiplier. */
  paytable: number[];
}
export const BINGO_CONFIG: BingoConfig = {
  size: 5,
  draws: 10,
  paytable: [0, 3, 8, 20, 45, 100, 220, 450, 900, 1800, 3600, 6000, 10000],
};

/** The 12 winning lines of a size×size card, as cell indices. */
export function bingoLines(size: number): number[][] {
  const lines: number[][] = [];
  for (let r = 0; r < size; r += 1) lines.push(Array.from({ length: size }, (_, c) => r * size + c));
  for (let c = 0; c < size; c += 1) lines.push(Array.from({ length: size }, (_, r) => r * size + c));
  lines.push(Array.from({ length: size }, (_, i) => i * size + i));
  lines.push(Array.from({ length: size }, (_, i) => i * size + (size - 1 - i)));
  return lines;
}

export interface BingoState {
  marked: number[];
  lines: number;
  multiplier: number;
}

export class BingoEngine implements RuntimeGameEngine<BingoConfig, unknown, BingoState> {
  readonly engineKey = 'bingo';

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest;
    config: BingoConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<BingoState> {
    const { session, config, rng, fairness } = input;
    const cells = config.size * config.size;
    const marked = shuffleFair(cells, rng, fairness).slice(0, config.draws);
    const markedSet = new Set(marked);
    const lines = bingoLines(config.size).filter((line) => line.every((cell) => markedSet.has(cell))).length;
    const multiplier = config.paytable[lines] ?? 0;

    const win = multiplier >= 1;
    return {
      roundId: '',
      gameId: session.gameId,
      state: { marked, lines, multiplier },
      multiplier: win ? multiplier : 0,
      win,
      fairness,
      computedAt: new Date().toISOString(),
      display: { label: lines > 0 ? `${lines} line${lines > 1 ? 's' : ''} · ${multiplier}×` : 'No line', value: win ? multiplier : 0 },
    };
  }
}
