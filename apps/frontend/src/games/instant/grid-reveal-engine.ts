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

import { shuffleFair } from './rng';

/**
 * Grid-reveal engine (Phase 4 — instant, interactive). Powers **Mines** (5×5) and
 * **Bomb Hunt** (4×4) — one engine, two games via `config.tiles` + the player's
 * mine count. Reveal safe tiles to grow the multiplier; hit a mine and lose; cash
 * out any time. The mine board is derived from the round fairness on every step
 * (never sent to the client until the round ends), so it is provably fair and
 * tamper-evident. PURE: no wallet/history/session.
 */
export interface GridRevealConfig {
  tiles: number;
  /** Default mine count when the player doesn't choose one. */
  mines: number;
}

export interface GridRevealPick {
  /** Number of mines the player selected (difficulty). */
  mines: number;
}

export interface GridRevealState {
  revealed: number[];
  multiplier: number;
  mines: number;
  tiles: number;
  /** The full mine board — only populated once the round is over. */
  board?: number[];
  /** The tile that ended the round on a loss. */
  hit?: number;
}

/** Fair multiplier after `k` safe reveals (1% house edge). */
export function gridMultiplier(tiles: number, mines: number, k: number): number {
  let m = 0.99;
  for (let i = 0; i < k; i += 1) m *= (tiles - i) / (tiles - mines - i);
  return Math.round(m * 100) / 100;
}

export class GridRevealEngine implements RuntimeGameEngine<GridRevealConfig, GridRevealPick, unknown, GridRevealState> {
  readonly engineKey = 'grid-reveal';

  private mineSet(config: GridRevealConfig, mines: number, rng: IProvablyFairProvider, fairness: IFairnessProof): Set<number> {
    return new Set(shuffleFair(config.tiles, rng, fairness).slice(0, mines));
  }

  start(input: {
    session: IGameSession;
    bet: IBetRequest<GridRevealPick>;
    config: GridRevealConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IStepResult<GridRevealState> {
    const { bet, config } = input;
    const picked = bet.selections[0]?.pick?.mines ?? config.mines;
    const mines = Math.max(1, Math.min(config.tiles - 1, Math.floor(picked)));
    return {
      state: RuntimeState.AwaitingPlayer,
      gameState: { revealed: [], multiplier: 1, mines, tiles: config.tiles },
      availableActions: ['reveal', 'cashout'],
    };
  }

  step(input: {
    session: IGameSession;
    bet: IBetRequest<GridRevealPick>;
    config: GridRevealConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
    gameState: GridRevealState;
    action: PlayerAction;
  }): IStepResult<GridRevealState> {
    const { gameState, action, bet, config, rng, fairness } = input;
    const { tiles, mines } = gameState;
    const stake = Number(bet.stake.amount);

    if (action.type === 'cashout') {
      if (gameState.revealed.length === 0) {
        throw new ValidationError(RuntimeErrorCode.INVALID_BET, 'Reveal a tile before cashing out.');
      }
      const board = Array.from(this.mineSet(config, mines, rng, fairness));
      return this.win(gameState, stake, board);
    }

    if (action.type === 'reveal') {
      const index = Number((action.payload as { index?: number } | undefined)?.index);
      if (!Number.isInteger(index) || index < 0 || index >= tiles || gameState.revealed.includes(index)) {
        throw new ValidationError(RuntimeErrorCode.INVALID_BET, 'Invalid tile.');
      }
      const board = this.mineSet(config, mines, rng, fairness);
      if (board.has(index)) {
        return {
          state: RuntimeState.Completed,
          gameState: { ...gameState, board: Array.from(board), hit: index },
          display: { label: 'Boom', value: 0 },
          settlement: { type: SettlementType.Loss, payout: '0', reason: 'mine', display: { label: 'Boom', value: 0 } },
        };
      }
      const revealed = [...gameState.revealed, index];
      const multiplier = gridMultiplier(tiles, mines, revealed.length);
      const next: GridRevealState = { ...gameState, revealed, multiplier };
      if (revealed.length >= tiles - mines) {
        // All safe tiles found → auto cash-out.
        return this.win(next, stake, Array.from(board));
      }
      return { state: RuntimeState.AwaitingPlayer, gameState: next, availableActions: ['reveal', 'cashout'] };
    }

    throw new ValidationError(RuntimeErrorCode.INVALID_BET, `Illegal action: ${action.type}`);
  }

  private win(state: GridRevealState, stake: number, board: number[]): IStepResult<GridRevealState> {
    const display = { label: `${state.multiplier.toFixed(2)}×`, value: state.multiplier };
    return {
      state: RuntimeState.Completed,
      gameState: { ...state, board },
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
