'use client';

import type {
  IBetRequest,
  IFairnessProof,
  IGameResult,
  IGameSession,
  IProvablyFairProvider,
} from '@gaming-platform/types';

import type { RuntimeGameEngine } from '@/runtime/engine-registry';

/**
 * Roulette engine (Phase 2.3B migration).
 *
 * PURE European single-zero wheel rules. The outcome + payout table are unchanged
 * from the previous in-component logic (`floor(r * 37)`, straight 36×, outside 2×);
 * only the RNG source moves to the provably-fair provider. The wheel rules
 * (colour, label, outside-bet predicates) are exported so the board UI shares one
 * source of truth.
 */
export const ROULETTE_REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export type RouletteColor = 'red' | 'black' | 'green';
export function colorOf(n: number): RouletteColor {
  if (n === 0) return 'green';
  return ROULETTE_REDS.has(n) ? 'red' : 'black';
}
export function labelOf(n: number): string {
  const c = colorOf(n);
  return `${n} ${c === 'green' ? 'Green' : c === 'red' ? 'Red' : 'Black'}`;
}

export type OutsideKey = 'red' | 'black' | 'even' | 'odd' | 'low' | 'high';
/** Outside bet types (all pay 2×). */
export const OUTSIDE: { key: OutsideKey; label: string; hit: (n: number) => boolean }[] = [
  { key: 'red', label: 'Red', hit: (n) => colorOf(n) === 'red' },
  { key: 'black', label: 'Black', hit: (n) => colorOf(n) === 'black' },
  { key: 'even', label: 'Even', hit: (n) => n !== 0 && n % 2 === 0 },
  { key: 'odd', label: 'Odd', hit: (n) => n % 2 === 1 },
  { key: 'low', label: '1–18', hit: (n) => n >= 1 && n <= 18 },
  { key: 'high', label: '19–36', hit: (n) => n >= 19 && n <= 36 },
];

export type RoulettePick = { kind: 'outside'; key: OutsideKey } | { kind: 'straight'; n: number };

export const ROULETTE_POCKETS = 37;

export interface RouletteState {
  number: number;
}

export function rouletteMultiplier(pick: RoulettePick): number {
  return pick.kind === 'straight' ? 36 : 2;
}

export class RouletteEngine implements RuntimeGameEngine<unknown, RoulettePick, RouletteState> {
  readonly engineKey = 'roulette';

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest<RoulettePick>;
    config: unknown;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<RouletteState> {
    const { session, bet, rng, fairness } = input;
    const pick = bet.selections[0]!.pick;
    const serverSeed = fairness.serverSeed ?? '';
    const r = rng.nextFloat({ serverSeed, clientSeed: fairness.clientSeed, nonce: fairness.nonce });

    const n = Math.floor(r * ROULETTE_POCKETS); // 0..36
    const won = pick.kind === 'straight' ? pick.n === n : OUTSIDE.find((o) => o.key === pick.key)!.hit(n);
    const multiplier = rouletteMultiplier(pick);

    return {
      roundId: '',
      gameId: session.gameId,
      state: { number: n },
      multiplier: won ? multiplier : 0,
      win: won,
      fairness,
      computedAt: new Date().toISOString(),
      // History strip shows the pocket (e.g. "17 Red"), value = the number.
      display: { label: labelOf(n), value: n },
    };
  }
}
