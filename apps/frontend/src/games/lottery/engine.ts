/**
 * Number Lottery engine (Sprint 4, STEP 1).
 *
 * A PURE interactive `RuntimeGameEngine`. `start` buys the ticket (manual numbers or a
 * provably-fair quick pick) and waits for the scheduled draw. `step('draw')` settles
 * the ticket against the draw's fairness (passed in the action payload) — deriving the
 * winning numbers via the frozen provider so every ticket resolves to the SAME draw and
 * is independently verifiable. Money moves only through the frozen flexible settlement.
 */
import type { IBetRequest, IFairnessProof, IGameSession, IProvablyFairProvider, IStepResult, PlayerAction } from '@gaming-platform/types';
import { RuntimeState, SettlementType } from '@gaming-platform/types';

import type { RuntimeGameEngine } from '@/runtime/engine-registry';

import { countMatches, tierFor } from './probability';
import { DEFAULT_PRIZE_TABLE } from './prizes';
import { deriveDraw, quickPick } from './provably-fair';
import { type LotteryConfig, type LotteryState, PrizeTier, type TicketPick } from './types';

export const LOTTERY_ENGINE_KEY = 'number-lottery';

export const LOTTERY_DEFAULT: LotteryConfig = { pick: 6, range: 49, drawMain: 6, bonus: true, prizeTable: DEFAULT_PRIZE_TABLE };

function validateNumbers(nums: number[], config: LotteryConfig): void {
  if (nums.length !== config.pick) throw new Error(`lottery: pick exactly ${config.pick} numbers`);
  if (new Set(nums).size !== nums.length) throw new Error('lottery: numbers must be distinct');
  if (nums.some((n) => n < 1 || n > config.range)) throw new Error(`lottery: numbers must be 1–${config.range}`);
}

export class NumberLotteryEngine implements RuntimeGameEngine<LotteryConfig, TicketPick, unknown, LotteryState> {
  readonly engineKey = LOTTERY_ENGINE_KEY;

  start(input: { session: IGameSession; bet: IBetRequest<TicketPick>; config: LotteryConfig; rng: IProvablyFairProvider; fairness: IFairnessProof }): IStepResult<LotteryState> {
    const { bet, config, rng, fairness } = input;
    const pick = bet.selections?.[0]?.pick;
    let numbers: number[];
    let isQuick = false;
    if (pick?.numbers && pick.numbers.length) {
      numbers = [...pick.numbers].sort((a, b) => a - b);
      validateNumbers(numbers, config);
    } else {
      numbers = quickPick(rng, fairness, { pick: config.pick, range: config.range });
      isQuick = true;
    }
    const state: LotteryState = { numbers, quickPick: isQuick, drawId: pick?.drawId };
    return { state: RuntimeState.AwaitingSystem, gameState: state, availableActions: ['draw'] };
  }

  step(input: { session: IGameSession; bet: IBetRequest<TicketPick>; config: LotteryConfig; rng: IProvablyFairProvider; fairness: IFairnessProof; gameState: LotteryState; action: PlayerAction }): IStepResult<LotteryState> {
    const { gameState, action, bet, config, rng } = input;
    if (action.type !== 'draw') throw new Error(`lottery: illegal action ${action.type}`);

    // The scheduled draw fires with the DRAW's fairness → derive the winning numbers.
    const payload = (action.payload ?? {}) as { serverSeed?: string; clientSeed?: string; nonce?: number };
    const drawFairness: IFairnessProof = { serverSeed: payload.serverSeed ?? '', serverSeedHash: '', clientSeed: payload.clientSeed ?? '', nonce: payload.nonce ?? 0 };
    const draw = deriveDraw(rng, drawFairness, { drawMain: config.drawMain, range: config.range, bonus: config.bonus });

    const matches = countMatches(gameState.numbers, draw.main);
    const bonusMatch = config.bonus && gameState.numbers.includes(draw.bonus);
    const tier = tierFor(matches, bonusMatch, config.pick);
    const prizeMultiplier = tier ? config.prizeTable[tier] : 0;
    const stake = Number(bet.stake.amount);
    const payout = Math.round(stake * prizeMultiplier);

    const finalState: LotteryState = { ...gameState, draw, matches, bonusMatch, tier, prizeMultiplier };
    const label = tier ? `${tierLabel(tier)} · ${prizeMultiplier}×` : 'No prize';
    return {
      state: RuntimeState.Completed,
      gameState: finalState,
      display: { label, value: prizeMultiplier },
      settlement: { type: tier ? SettlementType.Win : SettlementType.Loss, payout: String(payout), multiplier: prizeMultiplier, reason: tier ? `tier ${tier}` : 'no match', metadata: { drawId: gameState.drawId, tier, matches, bonusMatch }, display: { label, value: prizeMultiplier } },
    };
  }
}

function tierLabel(tier: PrizeTier): string {
  switch (tier) {
    case PrizeTier.Jackpot:
      return 'JACKPOT (6)';
    case PrizeTier.FivePlusBonus:
      return '5 + Bonus';
    default:
      return `${tier} matches`;
  }
}
