/**
 * Plinko engine (Sprint 1, STEP 1 & 5).
 *
 * A PURE `RuntimeGameEngine` for the FROZEN GameRuntime. `createRound` derives the
 * ball path from the provably-fair provider, resolves the landing bin + multiplier
 * from the calibrated table, and returns an `IGameResult` whose **flexible settlement**
 * credits `stake × multiplier` for EVERY drop (so a sub-1 bin returns a partial stake
 * and is classified a loss by net). It never touches the wallet/ledger — the frozen
 * settlement provider moves money.
 */
import type { IBetRequest, IFairnessProof, IGameResult, IGameSession, IProvablyFairProvider } from '@gaming-platform/types';
import { SettlementType } from '@gaming-platform/types';

import type { RuntimeGameEngine } from '@/runtime/engine-registry';

import { plinkoTable } from './math';
import { derivePath } from './provably-fair';
import { PLINKO_RISKS, PLINKO_ROWS, type PlinkoConfig, type PlinkoPick, type PlinkoRisk, type PlinkoState } from './types';

export const PLINKO_ENGINE_KEY = 'plinko-pro';

/** Default board when neither the pick nor the config specifies one. */
export const PLINKO_DEFAULT: PlinkoConfig = { rows: 16, risk: 'medium' };

function resolveBoard(config: Partial<PlinkoConfig> | undefined, pick: PlinkoPick | undefined): { rows: number; risk: PlinkoRisk } {
  const rows = pick?.rows ?? config?.rows ?? PLINKO_DEFAULT.rows;
  const risk = pick?.risk ?? config?.risk ?? PLINKO_DEFAULT.risk;
  if (!PLINKO_ROWS.includes(rows)) throw new Error(`plinko: unsupported rows ${rows} (allowed: ${PLINKO_ROWS.join(', ')})`);
  if (!PLINKO_RISKS.includes(risk)) throw new Error(`plinko: unsupported risk ${risk}`);
  return { rows, risk };
}

export class PlinkoEngine implements RuntimeGameEngine<PlinkoConfig, PlinkoPick, PlinkoState> {
  readonly engineKey = PLINKO_ENGINE_KEY;

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest<PlinkoPick>;
    config: PlinkoConfig;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<PlinkoState> {
    const { session, bet, config, rng, fairness } = input;
    const pick = bet.selections?.[0]?.pick;
    const { rows, risk } = resolveBoard(config, pick);
    const table = plinkoTable(rows, risk);

    // Provably-fair path → landing bin → multiplier. No hardcoded winning logic.
    const { dirs, bin } = derivePath(rng, fairness, rows);
    const mult = table[bin] ?? 0;

    // Flexible settlement: every drop credits stake × mult (a sub-1 bin returns part
    // of the stake). The frozen provider classifies the outcome by net profit.
    const stake = Number(bet.stake.amount);
    const payout = Math.round(stake * mult);

    return {
      roundId: '',
      gameId: session.gameId,
      state: { rows, risk, dirs, bin, mult, table },
      multiplier: mult,
      win: mult > 1,
      settlement: {
        type: SettlementType.Custom,
        payout: String(payout),
        multiplier: mult,
        metadata: { rows, risk, bin },
        display: { label: `${mult}×`, value: mult },
      },
      fairness,
      computedAt: new Date().toISOString(),
      display: { label: `${mult}×`, value: mult },
    };
  }
}
