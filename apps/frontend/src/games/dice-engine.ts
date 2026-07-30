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
 * Dice engine (Phase 2.3B migration).
 *
 * PURE game rules only — the runtime owns bet/RNG/settlement/history. The
 * distribution formula is byte-for-byte the previous in-component logic
 * (`floor(r * 10000) / 100`, ~1% house edge), so play is identical; only the RNG
 * source moves from the local `mulberry32` to the provably-fair provider.
 */
export type DiceDirection = 'over' | 'under';
export interface DicePick {
  target: number;
  dir: DiceDirection;
}
export interface DiceConfig {
  /** House edge as a percentage (1 → 0.99 factor), preserved from the original. */
  houseEdgePct: number;
}
export const DICE_CONFIG: DiceConfig = { houseEdgePct: 1 };

export interface DiceState {
  roll: number;
  target: number;
  dir: DiceDirection;
}

/** Win chance (%) for a target + direction. */
export function diceChance(target: number, dir: DiceDirection): number {
  return dir === 'over' ? 100 - target : target;
}

/** Fair-ish multiplier with the configured house edge (0 when impossible). */
export function diceMultiplier(target: number, dir: DiceDirection, houseEdgePct = DICE_CONFIG.houseEdgePct): number {
  const chance = diceChance(target, dir);
  if (chance <= 0) return 0;
  return ((1 - houseEdgePct / 100) * 100) / chance;
}

export class DiceEngine implements RuntimeGameEngine<DiceConfig, DicePick, DiceState> {
  readonly engineKey = 'dice';

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest<DicePick>;
    config: DiceConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<DiceState> {
    const { session, bet, config, rng, fairness } = input;
    const pick = bet.selections[0]!.pick;
    const serverSeed = fairness.serverSeed ?? '';
    const r = rng.nextFloat({ serverSeed, clientSeed: fairness.clientSeed, nonce: fairness.nonce });

    const roll = Math.floor(r * 10000) / 100; // [0, 99.99]
    const win = pick.dir === 'over' ? roll > pick.target : roll < pick.target;
    const multiplier = win ? diceMultiplier(pick.target, pick.dir, config.houseEdgePct) : 0;

    return {
      roundId: '',
      gameId: session.gameId,
      state: { roll, target: pick.target, dir: pick.dir },
      multiplier,
      win,
      fairness,
      computedAt: new Date().toISOString(),
      // History strip shows the roll (not a multiplier), exactly as before.
      display: { label: roll.toFixed(2), value: roll },
    };
  }
}
