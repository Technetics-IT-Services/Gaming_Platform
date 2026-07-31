/**
 * Fruit Slots engine (Sprint 2).
 *
 * A PURE single-shot `RuntimeGameEngine`. `createRound` spins the reels (provably-
 * fair), evaluates the 20 paylines with wild substitution + scatter pays, resolves any
 * triggered free-spin round, and returns an `IGameResult` with flexible settlement
 * (payout = round(totalUnits × lineBet)). It never touches the wallet/ledger.
 */
import type { IBetRequest, IFairnessProof, IGameResult, IGameSession, IProvablyFairProvider } from '@gaming-platform/types';
import { SettlementType } from '@gaming-platform/types';

import type { RuntimeGameEngine } from '@/runtime/engine-registry';

import { PAYTABLE, SCATTER } from './paytable';
import { reelStops } from './provably-fair';
import { LINES, STRIP_LENGTH, buildReels, windowFor } from './reels';
import { type LineWin, PAYLINES, type SlotConfig, type SpinResult, Symbol } from './types';

export const FRUIT_SLOTS_ENGINE_KEY = 'fruit-slots';

export function defaultSlotConfig(): SlotConfig {
  return { reels: buildReels(), paytable: PAYTABLE, scatter: SCATTER };
}

/** Build the 3×5 matrix (matrix[row][reel]) from reel stops. */
export function spinMatrix(reels: Symbol[][], stops: number[]): Symbol[][] {
  const windows = reels.map((strip, r) => windowFor(strip, stops[r]!)); // [reel][row]
  return Array.from({ length: 3 }, (_, row) => windows.map((w) => w[row]!));
}

/** Evaluate one payline left-to-right with wild substitution. */
function evalLine(matrix: Symbol[][], line: number[], paytable: SlotConfig['paytable']): LineWin | null {
  const symbols = line.map((row, reel) => matrix[row]![reel]!);
  const first = symbols[0];
  if (first === Symbol.Scatter) return null;

  // The paying symbol is the first non-wild (or wild if the line is all wilds).
  let paySymbol: Symbol = first!;
  if (paySymbol === Symbol.Wild) {
    const nonWild = symbols.find((s) => s !== Symbol.Wild && s !== Symbol.Scatter);
    paySymbol = nonWild ?? Symbol.Wild;
  }
  let count = 0;
  for (const s of symbols) {
    if (s === paySymbol || s === Symbol.Wild) count += 1;
    else break;
  }
  const pay = paytable[paySymbol];
  if (!pay || count < 3) return null;
  const mult = count === 5 ? pay[5] : count === 4 ? pay[4] : pay[3];
  return { line: 0, symbol: paySymbol, count, mult };
}

/** Count scatters anywhere in the window. */
function scatterCount(matrix: Symbol[][]): number {
  let n = 0;
  for (const row of matrix) for (const s of row) if (s === Symbol.Scatter) n += 1;
  return n;
}

/** Evaluate a single spin (line wins + scatter), in line-bet units. */
export function evaluateSpin(reels: Symbol[][], stops: number[], config: SlotConfig, multiplier = 1): { stops: number[]; matrix: Symbol[][]; lineWins: LineWin[]; scatterCount: number; scatterMult: number; units: number } {
  const matrix = spinMatrix(reels, stops);
  const lineWins: LineWin[] = [];
  let units = 0;
  for (let i = 0; i < LINES.length; i += 1) {
    const win = evalLine(matrix, LINES[i]!, config.paytable);
    if (win) {
      const w = { ...win, line: i + 1, mult: win.mult * multiplier };
      lineWins.push(w);
      units += w.mult;
    }
  }
  const sc = scatterCount(matrix);
  let scatterMult = 0;
  if (sc >= 3) {
    scatterMult = (sc >= 5 ? config.scatter.pays[5] : sc >= 4 ? config.scatter.pays[4] : config.scatter.pays[3]) * multiplier;
    units += scatterMult * PAYLINES; // scatter pays × total bet ⇒ × PAYLINES line-bets
  }
  return { stops, matrix, lineWins, scatterCount: sc, scatterMult, units };
}

/** Full round: base spin + resolved free-spin round. */
export function playRound(rng: IProvablyFairProvider, fairness: IFairnessProof, config: SlotConfig): SpinResult {
  const base = evaluateSpin(config.reels, reelStops(rng, fairness, STRIP_LENGTH, 0), config, 1);
  let freeSpinsAwarded = 0;
  if (base.scatterCount >= 3) {
    freeSpinsAwarded = base.scatterCount >= 5 ? config.scatter.freeSpins[5] : base.scatterCount >= 4 ? config.scatter.freeSpins[4] : config.scatter.freeSpins[3];
  }
  let freeUnits = 0;
  for (let s = 1; s <= freeSpinsAwarded; s += 1) {
    const fs = evaluateSpin(config.reels, reelStops(rng, fairness, STRIP_LENGTH, s), config, config.scatter.freeSpinMultiplier);
    freeUnits += fs.units;
  }
  const totalUnits = base.units + freeUnits;
  return { stops: base.stops, matrix: base.matrix, lineWins: base.lineWins, scatterCount: base.scatterCount, scatterMult: base.scatterMult, freeSpinsAwarded, baseUnits: base.units, freeUnits, totalUnits };
}

export class FruitSlotsEngine implements RuntimeGameEngine<SlotConfig, unknown, SpinResult> {
  readonly engineKey = FRUIT_SLOTS_ENGINE_KEY;

  createRound(input: { session: IGameSession; bet: IBetRequest; config: SlotConfig; rng: IProvablyFairProvider; fairness: IFairnessProof }): IGameResult<SpinResult> {
    const { session, bet, config, rng, fairness } = input;
    const stake = Number(bet.stake.amount);
    const lineBet = stake / PAYLINES;
    const spin = playRound(rng, fairness, config);
    const payout = Math.round(spin.totalUnits * lineBet);
    const multiplier = stake > 0 ? payout / stake : 0;
    const label = spin.totalUnits > 0 ? `${multiplier.toFixed(2)}×` : 'No win';

    return {
      roundId: '',
      gameId: session.gameId,
      state: spin,
      multiplier,
      win: payout > stake,
      settlement: { type: SettlementType.Custom, payout: String(payout), multiplier, metadata: { freeSpins: spin.freeSpinsAwarded, scatters: spin.scatterCount, lines: spin.lineWins.length }, display: { label, value: multiplier } },
      fairness,
      computedAt: new Date().toISOString(),
      display: { label, value: multiplier },
    };
  }
}
