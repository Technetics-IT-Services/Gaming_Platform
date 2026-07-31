/**
 * Hi-Lo engine (Sprint 2).
 *
 * A PURE interactive `RuntimeGameEngine` for the FROZEN GameRuntime. `start` deals the
 * first card; `step` handles a prediction (higher/lower/equal) or cash-out. A correct
 * prediction grows the multiplier and awaits the next; a wrong one busts; cash-out
 * settles at the running multiplier. Money moves only through the frozen flexible
 * settlement — the engine never touches the wallet/ledger.
 */
import type { IBetRequest, IFairnessProof, IGameSession, IProvablyFairProvider, IStepResult, PlayerAction } from '@gaming-platform/types';
import { RuntimeState, SettlementType } from '@gaming-platform/types';

import type { RuntimeGameEngine } from '@/runtime/engine-registry';

import { fullDeck, isCorrect, oddsFor } from './math';
import { drawCard } from './provably-fair';
import { HILO_DEFAULT, type HiLoConfig, type HiLoDirection, type HiLoState } from './types';

export const HILO_ENGINE_KEY = 'hi-lo';
const DIRECTIONS: HiLoDirection[] = ['higher', 'lower', 'equal'];

export class HiLoEngine implements RuntimeGameEngine<HiLoConfig, unknown, unknown, HiLoState> {
  readonly engineKey = HILO_ENGINE_KEY;

  start(input: { session: IGameSession; bet: IBetRequest; config: HiLoConfig; rng: IProvablyFairProvider; fairness: IFairnessProof }): IStepResult<HiLoState> {
    const { config, rng, fairness } = input;
    const edge = config.houseEdge ?? HILO_DEFAULT.houseEdge;
    const allowEqual = config.allowEqual ?? HILO_DEFAULT.allowEqual;
    const { card, remaining } = drawCard(rng, fairness, 0, fullDeck());
    const state: HiLoState = {
      current: card,
      multiplier: 1,
      remaining,
      revealed: [card],
      draws: 1,
      allowEqual,
      edge,
      odds: oddsFor(card.rank, remaining, edge, allowEqual),
    };
    return { state: RuntimeState.AwaitingPlayer, gameState: state, availableActions: this.actions(state) };
  }

  step(input: { session: IGameSession; bet: IBetRequest; config: HiLoConfig; rng: IProvablyFairProvider; fairness: IFairnessProof; gameState: HiLoState; action: PlayerAction }): IStepResult<HiLoState> {
    const { gameState, action, bet, rng, fairness } = input;
    const stake = Number(bet.stake.amount);

    if (action.type === 'cashout') {
      if (gameState.multiplier <= 1) throw new Error('Hi-Lo: make at least one prediction before cashing out.');
      return this.win({ ...gameState, cashed: true }, stake);
    }

    if (DIRECTIONS.includes(action.type as HiLoDirection)) {
      const direction = action.type as HiLoDirection;
      if (direction === 'equal' && !gameState.allowEqual) throw new Error('Hi-Lo: "equal" is disabled.');
      const stepMult = gameState.odds[direction] ?? 0;

      const { card: next, remaining } = drawCard(rng, fairness, gameState.draws, gameState.remaining);
      const correct = stepMult > 0 && isCorrect(direction, gameState.current.rank, next.rank);
      const revealed = [...gameState.revealed, next];

      if (!correct) {
        return {
          state: RuntimeState.Completed,
          gameState: { ...gameState, current: next, remaining, revealed, draws: gameState.draws + 1, busted: true, lastPrediction: direction, lastCorrect: false },
          display: { label: 'Busted', value: 0 },
          settlement: { type: SettlementType.Loss, payout: '0', reason: 'wrong prediction', display: { label: 'Busted', value: 0 } },
        };
      }

      const multiplier = Math.round(gameState.multiplier * stepMult * 100) / 100;
      const nextState: HiLoState = {
        ...gameState,
        current: next,
        remaining,
        revealed,
        draws: gameState.draws + 1,
        multiplier,
        odds: oddsFor(next.rank, remaining, gameState.edge, gameState.allowEqual),
        lastPrediction: direction,
        lastCorrect: true,
      };
      // Deck exhausted → auto cash-out at the achieved multiplier.
      if (remaining.length === 0) return this.win({ ...nextState, cashed: true }, stake);
      return { state: RuntimeState.AwaitingPlayer, gameState: nextState, availableActions: this.actions(nextState) };
    }

    throw new Error(`Hi-Lo: illegal action ${action.type}`);
  }

  private actions(state: HiLoState): string[] {
    const acts: string[] = ['higher', 'lower'];
    if (state.allowEqual && (state.odds.equal ?? 0) > 0) acts.push('equal');
    if (state.multiplier > 1) acts.push('cashout');
    return acts;
  }

  private win(state: HiLoState, stake: number): IStepResult<HiLoState> {
    const display = { label: `${state.multiplier.toFixed(2)}×`, value: state.multiplier };
    return {
      state: RuntimeState.Completed,
      gameState: state,
      display,
      settlement: { type: SettlementType.Win, payout: String(Math.round(stake * state.multiplier)), multiplier: state.multiplier, reason: 'cashed out', display },
    };
  }
}
