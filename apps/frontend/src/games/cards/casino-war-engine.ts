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

import { createDeck, rankValue, shuffle, type Card } from '@/lib/deck';
import { RuntimeErrorCode, ValidationError } from '@/runtime/errors';
import type { RuntimeGameEngine } from '@/runtime/engine-registry';

/**
 * Casino War engine (Phase 3 migration, interactive).
 *
 * PURE rules only — the runtime owns the state machine, wallet (incl. the "go to
 * war" doubling via `raiseStake`), settlement and history. The single-deck deal,
 * high-card compare, tie → war/surrender flow and even-money payout are
 * byte-for-byte the previous logic; only the RNG seed moves to provably-fair.
 */
export type CWOutcome = 'player' | 'dealer' | 'tie';

export interface CWRound {
  player: Card;
  dealer: Card;
  warPlayer: Card;
  warDealer: Card;
}

export interface CasinoWarState {
  round: CWRound;
  outcome: CWOutcome;
  war: boolean;
}

export function compareWar(p: Card, d: Card): CWOutcome {
  const pv = rankValue(p);
  const dv = rankValue(d);
  if (pv > dv) return 'player';
  if (dv > pv) return 'dealer';
  return 'tie';
}

/** Terminal settlement from the resolved outcome + committed stake. */
function resolveWar(round: CWRound, outcome: CWOutcome, war: boolean, stake: number): IStepResult<CasinoWarState> {
  const win = outcome === 'player';
  const label = win ? (war ? 'War won' : 'Battle won') : outcome === 'tie' ? 'Push→loss' : 'Dealer wins';
  const display = { label, value: win ? 2 : 0 };
  return {
    state: RuntimeState.Completed,
    gameState: { round, outcome, war },
    display,
    settlement: win
      ? { type: SettlementType.Win, payout: String(Math.round(stake * 2)), multiplier: 2, reason: label, display }
      : { type: SettlementType.Loss, payout: '0', reason: label, display },
  };
}

function buildRound(seed: number): CWRound {
  const deck = shuffle(createDeck(), seed);
  return {
    player: deck[0] ?? 'AS',
    dealer: deck[1] ?? 'KS',
    warPlayer: deck[2] ?? 'QS',
    warDealer: deck[3] ?? 'JS',
  };
}

export class CasinoWarEngine implements RuntimeGameEngine<unknown, unknown, unknown, CasinoWarState> {
  readonly engineKey = 'casino-war';

  start(input: {
    session: IGameSession;
    bet: IBetRequest;
    config: unknown;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IStepResult<CasinoWarState> {
    const { rng, fairness } = input;
    const r = rng.nextFloat({ serverSeed: fairness.serverSeed ?? '', clientSeed: fairness.clientSeed, nonce: fairness.nonce });
    const round = buildRound(Math.floor(r * 2 ** 31));
    const outcome = compareWar(round.player, round.dealer);

    if (outcome === 'tie') {
      // Blocked on the player: go to war (double) or surrender.
      return {
        state: RuntimeState.AwaitingPlayer,
        gameState: { round, outcome: 'tie', war: false },
        availableActions: ['war', 'surrender'],
      };
    }
    // Non-tie: reveal, then resolve.
    return { state: RuntimeState.AwaitingSystem, gameState: { round, outcome, war: false } };
  }

  step(input: {
    session: IGameSession;
    bet: IBetRequest;
    config: unknown;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
    gameState: CasinoWarState;
    action: PlayerAction;
  }): IStepResult<CasinoWarState> {
    const { gameState, action, bet } = input;
    const stake = Number(bet.stake.amount);
    const { round } = gameState;

    if (action.type === 'war') {
      // Stake already raised by the runtime. Second pair decides; a second tie
      // goes to the dealer (standard casino-war rule).
      const second = compareWar(round.warPlayer, round.warDealer);
      const outcome: CWOutcome = second === 'player' ? 'player' : 'dealer';
      return { state: RuntimeState.AwaitingSystem, gameState: { round, outcome, war: true } };
    }
    if (action.type === 'surrender') {
      return resolveWar(round, 'dealer', false, stake);
    }
    if (action.type === 'resolve') {
      return resolveWar(round, gameState.outcome, gameState.war, stake);
    }
    throw new ValidationError(RuntimeErrorCode.INVALID_BET, `Illegal action: ${action.type}`);
  }
}
