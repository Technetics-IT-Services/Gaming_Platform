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

import { blackjackHand, createDeck, shuffle, type Card } from '@/lib/deck';
import { RuntimeErrorCode, ValidationError } from '@/runtime/errors';
import type { RuntimeGameEngine } from '@/runtime/engine-registry';

/**
 * Blackjack engine (Phase 3 migration, interactive).
 *
 * PURE rules only — the runtime owns the state machine, wallet (incl. the double
 * via `raiseStake`), settlement and history. The 6-deck shoe, hit/stand/double
 * flow, dealer-stands-on-17 and payout table are byte-for-byte the previous logic;
 * only the RNG seed moves to the provably-fair provider. `stand`/`double` compute
 * the final dealer hand and pause in `AwaitingSystem` so the UI can animate the
 * reveal before `resolve` settles (preserving the original timing).
 */
export interface BlackjackState {
  deck: Card[];
  player: Card[];
  dealer: Card[];
  doubled: boolean;
  phase: 'player' | 'reveal' | 'done';
}

/** Compute the terminal settlement from the final hands + committed stake. */
function resolveResult(player: Card[], dealer: Card[], stake: number): IStepResult<BlackjackState> {
  const p = blackjackHand(player);
  const d = blackjackHand(dealer);
  let tone: 'win' | 'lose' | 'push';
  let text: string;
  if (p.total > 21) {
    tone = 'lose';
    text = 'Bust!';
  } else if (d.total > 21) {
    tone = 'win';
    text = 'Dealer busts — you win!';
  } else if (p.blackjack && !d.blackjack) {
    tone = 'win';
    text = 'Blackjack!';
  } else if (p.total > d.total) {
    tone = 'win';
    text = `You win ${p.total} vs ${d.total}`;
  } else if (p.total < d.total) {
    tone = 'lose';
    text = `Dealer wins ${d.total} vs ${p.total}`;
  } else {
    tone = 'push';
    text = `Push — ${p.total} each`;
  }

  const gameState: BlackjackState = { deck: [], player, dealer, doubled: false, phase: 'done' };
  if (tone === 'win') {
    const mult = p.blackjack ? 2.5 : 2;
    return {
      state: RuntimeState.Completed,
      gameState,
      display: { label: p.blackjack ? 'Blackjack!' : `Win ${p.total}`, value: p.total },
      settlement: {
        type: SettlementType.Win,
        payout: String(Math.round(stake * mult)),
        multiplier: mult,
        reason: text,
        display: { label: p.blackjack ? 'Blackjack!' : `Win ${p.total}`, value: p.total },
      },
    };
  }
  if (tone === 'push') {
    return {
      state: RuntimeState.Completed,
      gameState,
      display: { label: 'Push', value: p.total },
      settlement: {
        type: SettlementType.Push,
        payout: '0',
        refund: String(stake),
        reason: text,
        display: { label: 'Push', value: p.total },
      },
    };
  }
  return {
    state: RuntimeState.Completed,
    gameState,
    display: { label: `Loss ${p.total}`, value: p.total },
    settlement: {
      type: SettlementType.Loss,
      payout: '0',
      reason: text,
      display: { label: `Loss ${p.total}`, value: p.total },
    },
  };
}

/** Dealer draws to 17+ (mutates the passed deck), returning the final hand. */
function playDealer(dealer: Card[], deck: Card[]): Card[] {
  const hand = [...dealer];
  while (blackjackHand(hand).total < 17) {
    const next = deck.pop();
    if (!next) break;
    hand.push(next);
  }
  return hand;
}

export class BlackjackEngine implements RuntimeGameEngine<unknown, unknown, unknown, BlackjackState> {
  readonly engineKey = 'blackjack';

  start(input: {
    session: IGameSession;
    bet: IBetRequest;
    config: unknown;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IStepResult<BlackjackState> {
    const { bet, rng, fairness } = input;
    const stake = Number(bet.stake.amount);
    const r = rng.nextFloat({ serverSeed: fairness.serverSeed ?? '', clientSeed: fairness.clientSeed, nonce: fairness.nonce });
    const deck = shuffle(createDeck(6), Math.floor(r * 2 ** 31));

    // Deal order matches the previous logic exactly: p1, d1, p2, d2 popped in turn.
    const p1 = deck.pop()!;
    const d1 = deck.pop()!;
    const p2 = deck.pop()!;
    const d2 = deck.pop()!;
    const player = [p1, p2];
    const dealer = [d1, d2];

    const p = blackjackHand(player);
    const d = blackjackHand(dealer);
    if (p.blackjack || d.blackjack) {
      return resolveResult(player, dealer, stake);
    }
    return {
      state: RuntimeState.AwaitingPlayer,
      gameState: { deck, player, dealer, doubled: false, phase: 'player' },
      availableActions: ['hit', 'stand', 'double'],
    };
  }

  step(input: {
    session: IGameSession;
    bet: IBetRequest;
    config: unknown;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
    gameState: BlackjackState;
    action: PlayerAction;
  }): IStepResult<BlackjackState> {
    const { gameState, action, bet } = input;
    const stake = Number(bet.stake.amount);
    const deck = [...gameState.deck];
    const player = [...gameState.player];

    if (action.type === 'hit') {
      const next = deck.pop();
      if (next) player.push(next);
      if (blackjackHand(player).total > 21) return resolveResult(player, gameState.dealer, stake);
      return {
        state: RuntimeState.AwaitingPlayer,
        gameState: { ...gameState, deck, player },
        availableActions: ['hit', 'stand'],
      };
    }

    if (action.type === 'stand') {
      const dealer = playDealer(gameState.dealer, deck);
      return {
        state: RuntimeState.AwaitingSystem,
        gameState: { ...gameState, deck, dealer, phase: 'reveal' },
      };
    }

    if (action.type === 'double') {
      // The stake was already raised by the runtime before this action.
      const next = deck.pop();
      if (next) player.push(next);
      if (blackjackHand(player).total > 21) {
        return resolveResult(player, gameState.dealer, stake);
      }
      const dealer = playDealer(gameState.dealer, deck);
      return {
        state: RuntimeState.AwaitingSystem,
        gameState: { ...gameState, deck, player, dealer, doubled: true, phase: 'reveal' },
      };
    }

    if (action.type === 'resolve') {
      return resolveResult(gameState.player, gameState.dealer, stake);
    }

    throw new ValidationError(RuntimeErrorCode.INVALID_BET, `Illegal action: ${action.type}`);
  }
}
