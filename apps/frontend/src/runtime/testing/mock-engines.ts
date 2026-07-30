'use client';

import type {
  IBetRequest,
  IFairnessProof,
  IGameResult,
  IGameSession,
  IProvablyFairProvider,
  IStepResult,
  ISettlementResult,
  PlayerAction,
} from '@gaming-platform/types';
import { RuntimeState, SettlementType } from '@gaming-platform/types';

import { RuntimeErrorCode, ValidationError } from '../errors';
import type { RuntimeGameEngine } from '../engine-registry';

/**
 * Reference engines (Phase 2.3C) — PROOF ONLY, not real games.
 *
 * They exist solely to demonstrate that the runtime's two new generic capabilities
 * (interactive state machine + flexible settlement) work without the runtime
 * knowing any game's rules. They are NOT registered in the games registry and are
 * imported only by tests + the docs. Do not build real gameplay here.
 */

/* ------------------------- interactive: MockCardEngine ------------------------ */

export interface MockCardState {
  cards: number[];
  total: number;
  done: boolean;
}

/** Deterministic card value (1..10) from the round fairness + draw index. */
function drawCard(rng: IProvablyFairProvider, fairness: IFairnessProof, index: number): number {
  const r = rng.nextFloat({
    serverSeed: fairness.serverSeed ?? '',
    clientSeed: `${fairness.clientSeed}:${index}`,
    nonce: fairness.nonce,
  });
  return 1 + Math.floor(r * 10);
}

/**
 * A minimal "draw toward a target" interactive engine (NOT blackjack). It proves
 * the runtime's start/step/settle orchestration + several settlement types:
 *  - bust (total > 21) → Loss
 *  - stand ≥ 20 → Win (2×)
 *  - stand 17–19 → Push (stake refunded)
 *  - stand < 17 → Loss
 * The engine validates action legality; the runtime knows none of these rules.
 */
export class MockCardEngine
  implements RuntimeGameEngine<unknown, unknown, MockCardState, MockCardState>
{
  readonly engineKey = 'mockcard';

  start(input: { session: IGameSession; bet: IBetRequest; config: unknown; rng: IProvablyFairProvider; fairness: IFairnessProof }): IStepResult<MockCardState> {
    const first = drawCard(input.rng, input.fairness, 0);
    const state: MockCardState = { cards: [first], total: first, done: false };
    return {
      state: RuntimeState.AwaitingPlayer,
      gameState: state,
      availableActions: ['draw', 'stand'],
      display: { label: `Total ${first}`, value: first },
    };
  }

  step(input: {
    session: IGameSession;
    bet: IBetRequest;
    config: unknown;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
    gameState: MockCardState;
    action: PlayerAction;
  }): IStepResult<MockCardState> {
    const { gameState, action, bet, rng, fairness } = input;
    const stake = Number(bet.stake.amount);

    if (action.type === 'draw') {
      const card = drawCard(rng, fairness, gameState.cards.length);
      const cards = [...gameState.cards, card];
      const total = gameState.total + card;
      const state: MockCardState = { cards, total, done: total > 21 };
      if (total > 21) {
        return {
          state: RuntimeState.Completed,
          gameState: state,
          settlement: { type: SettlementType.Loss, payout: '0', reason: 'bust', display: { label: `Bust ${total}`, value: total } },
        };
      }
      return {
        state: RuntimeState.AwaitingPlayer,
        gameState: state,
        availableActions: ['draw', 'stand'],
        display: { label: `Total ${total}`, value: total },
      };
    }

    if (action.type === 'stand') {
      const total = gameState.total;
      const state: MockCardState = { ...gameState, done: true };
      let settlement: ISettlementResult;
      if (total >= 20) {
        settlement = { type: SettlementType.Win, payout: String(stake * 2), multiplier: 2, reason: 'stand win', display: { label: `Win ${total}`, value: total } };
      } else if (total >= 17) {
        settlement = { type: SettlementType.Push, payout: '0', refund: String(stake), reason: 'push', display: { label: `Push ${total}`, value: total } };
      } else {
        settlement = { type: SettlementType.Loss, payout: '0', reason: 'stand low', display: { label: `Loss ${total}`, value: total } };
      }
      return { state: RuntimeState.Completed, gameState: state, settlement };
    }

    // The engine — not the runtime — decides an action is illegal.
    throw new ValidationError(RuntimeErrorCode.INVALID_BET, `Illegal action: ${action.type}`);
  }
}

/* ---------------------- flexible settlement: MockSlotEngine -------------------- */

export interface MockSlotState {
  r: number;
}

/**
 * A single-shot engine that emits a flexible `ISettlementResult` (jackpot / win /
 * loss with absolute payouts + metadata). It proves the runtime settles absolute
 * amounts — not just `stake × multiplier` — through the standard `placeBet` path.
 */
export class MockSlotEngine implements RuntimeGameEngine<unknown, unknown, MockSlotState> {
  readonly engineKey = 'mockslot';

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest;
    config: unknown;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<MockSlotState> {
    const { session, bet, rng, fairness } = input;
    const stake = Number(bet.stake.amount);
    const r = rng.nextFloat({ serverSeed: fairness.serverSeed ?? '', clientSeed: fairness.clientSeed, nonce: fairness.nonce });

    let settlement: ISettlementResult;
    if (r < 0.1) {
      settlement = {
        type: SettlementType.Jackpot,
        payout: String(stake * 10),
        bonus: '5000',
        multiplier: 10,
        metadata: { jackpot: true, symbol: '7️⃣' },
        reason: 'three sevens',
        display: { label: 'Jackpot!', value: stake * 10 + 5000 },
      };
    } else if (r < 0.5) {
      settlement = {
        type: SettlementType.Win,
        payout: String(stake * 3),
        multiplier: 3,
        display: { label: 'Win 3×', value: 3 },
      };
    } else {
      settlement = { type: SettlementType.Loss, payout: '0', display: { label: 'No win', value: 0 } };
    }

    return {
      roundId: '',
      gameId: session.gameId,
      state: { r },
      multiplier: settlement.multiplier ?? 0,
      win: settlement.type !== SettlementType.Loss,
      fairness,
      computedAt: new Date().toISOString(),
      display: settlement.display,
      settlement,
    };
  }
}

/** A scripted provably-fair provider — returns floats in order (test helper). */
export function scriptedProvablyFair(floats: number[]): IProvablyFairProvider {
  let i = 0;
  return {
    commit: () => ({ serverSeed: 'mock-server', serverSeedHash: 'mock-hash' }),
    nextFloat: () => floats[i++ % floats.length] ?? 0.5,
    verify: () => true,
  };
}
