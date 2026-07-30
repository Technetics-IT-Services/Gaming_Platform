'use client';

import type {
  IBetRequest,
  IFairnessProof,
  IGameSession,
  IProvablyFairProvider,
  IStepResult,
  PlayerAction,
} from '@gaming-platform/types';
import { RuntimeState, SettlementType } from '@gaming-platform/types';

import { RuntimeErrorCode, ValidationError } from '@/runtime/errors';
import type { RuntimeGameEngine } from '@/runtime/engine-registry';

import { floatAt } from './rng';

/**
 * Tower engine (Phase 4 — instant, interactive).
 *
 * Rules: climb a tower row by row; each row has `tilesPerRow` tiles, `traps` of
 * which are unsafe. Pick a safe tile to climb (the multiplier grows each level);
 * hit a trap and lose; cash out any time. The trap layout is derived from the
 * round fairness per row (provably fair, never sent to the client early). PURE.
 */
export interface TowerConfig {
  rows: number;
  tilesPerRow: number;
  traps: number;
}
export const TOWER_CONFIG: TowerConfig = { rows: 8, tilesPerRow: 3, traps: 1 };

export interface TowerState {
  level: number;
  multiplier: number;
  picks: number[];
  rows: number;
  tilesPerRow: number;
  traps: number;
  /** Revealed trap tile per row — only once the round is over. */
  trapRows?: number[];
}

/** Multiplier after climbing `level` rows (1% house edge). */
export function towerMultiplier(config: TowerConfig, level: number): number {
  const step = config.tilesPerRow / (config.tilesPerRow - config.traps);
  return Math.round(0.99 * step ** level * 100) / 100;
}

/** The (single) trap tile for a given row, derived from fairness. */
function trapForRow(config: TowerConfig, rng: IProvablyFairProvider, fairness: IFairnessProof, row: number): number {
  return Math.floor(floatAt(rng, fairness, 1000 + row) * config.tilesPerRow);
}

export class TowerEngine implements RuntimeGameEngine<TowerConfig, unknown, unknown, TowerState> {
  readonly engineKey = 'tower';

  start(input: {
    session: IGameSession;
    bet: IBetRequest;
    config: TowerConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IStepResult<TowerState> {
    const { config } = input;
    return {
      state: RuntimeState.AwaitingPlayer,
      gameState: {
        level: 0,
        multiplier: 1,
        picks: [],
        rows: config.rows,
        tilesPerRow: config.tilesPerRow,
        traps: config.traps,
      },
      availableActions: ['pick', 'cashout'],
    };
  }

  step(input: {
    session: IGameSession;
    bet: IBetRequest;
    config: TowerConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
    gameState: TowerState;
    action: PlayerAction;
  }): IStepResult<TowerState> {
    const { gameState, action, bet, config, rng, fairness } = input;
    const stake = Number(bet.stake.amount);

    if (action.type === 'cashout') {
      if (gameState.level === 0) {
        throw new ValidationError(RuntimeErrorCode.INVALID_BET, 'Climb a row before cashing out.');
      }
      return this.win(gameState, stake, this.allTraps(config, rng, fairness));
    }

    if (action.type === 'pick') {
      const tile = Number((action.payload as { tile?: number } | undefined)?.tile);
      if (!Number.isInteger(tile) || tile < 0 || tile >= gameState.tilesPerRow) {
        throw new ValidationError(RuntimeErrorCode.INVALID_BET, 'Invalid tile.');
      }
      const trap = trapForRow(config, rng, fairness, gameState.level);
      if (tile === trap) {
        return {
          state: RuntimeState.Completed,
          gameState: { ...gameState, trapRows: this.allTraps(config, rng, fairness) },
          display: { label: 'Trapped', value: 0 },
          settlement: { type: SettlementType.Loss, payout: '0', reason: 'trap', display: { label: 'Trapped', value: 0 } },
        };
      }
      const level = gameState.level + 1;
      const multiplier = towerMultiplier(config, level);
      const next: TowerState = { ...gameState, level, multiplier, picks: [...gameState.picks, tile] };
      if (level >= gameState.rows) {
        return this.win(next, stake, this.allTraps(config, rng, fairness));
      }
      return { state: RuntimeState.AwaitingPlayer, gameState: next, availableActions: ['pick', 'cashout'] };
    }

    throw new ValidationError(RuntimeErrorCode.INVALID_BET, `Illegal action: ${action.type}`);
  }

  private allTraps(config: TowerConfig, rng: IProvablyFairProvider, fairness: IFairnessProof): number[] {
    return Array.from({ length: config.rows }, (_, row) => trapForRow(config, rng, fairness, row));
  }

  private win(state: TowerState, stake: number, trapRows: number[]): IStepResult<TowerState> {
    const display = { label: `${state.multiplier.toFixed(2)}×`, value: state.multiplier };
    return {
      state: RuntimeState.Completed,
      gameState: { ...state, trapRows },
      display,
      settlement: {
        type: SettlementType.Win,
        payout: String(Math.round(stake * state.multiplier)),
        multiplier: state.multiplier,
        reason: 'cashed out',
        display,
      },
    };
  }
}
