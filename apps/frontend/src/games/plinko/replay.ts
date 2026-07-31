/**
 * Plinko replay, fast mode & auto-play (Sprint 1, STEP 5).
 *
 * Deterministic replay of any past drop from its recorded seeds, and a pure auto-play
 * controller (rounds, on-win/on-loss stake adjustment, stop-on-profit/loss). These are
 * client-side conveniences; every bet still runs through the frozen Runtime + ledger.
 */
import type { IProvablyFairProvider } from '@gaming-platform/types';

import { buildTimeline, type Frame } from './animation';
import { verifyDrop } from './provably-fair';
import { type PlinkoDropRecord } from './types';

/** Reconstruct a past drop's path + timeline + verification from its record. */
export function replayDrop(rng: IProvablyFairProvider, record: PlinkoDropRecord, opts?: { fast?: boolean }): { dirs: number[]; frames: Frame[]; verified: boolean } {
  const verification =
    record.serverSeed !== undefined
      ? verifyDrop(rng, { serverSeed: record.serverSeed, clientSeed: record.clientSeed, nonce: record.nonce, rows: record.rows, expectedBin: record.bin, expectedDirs: record.dirs })
      : { valid: false, dirs: record.dirs };
  return { dirs: verification.dirs, frames: buildTimeline(verification.dirs, { fast: opts?.fast }), verified: 'valid' in verification ? verification.valid : false };
}

/* -------------------------------- auto-play ------------------------------- */

export interface AutoPlayConfig {
  rounds: number;
  baseStake: number;
  /** On a win, multiply the stake by this (1 = keep base). */
  onWin?: number;
  /** On a loss, multiply the stake by this (1 = keep base). */
  onLoss?: number;
  /** Stop if cumulative net profit ≥ this. */
  stopOnProfit?: number;
  /** Stop if cumulative net loss ≥ this (positive number). */
  stopOnLoss?: number;
}

export interface AutoPlayDecision {
  proceed: boolean;
  stake: number;
  roundsLeft: number;
  reason?: string;
}

/**
 * A pure auto-play state machine. Call `next(netProfit)` after each settled drop
 * (netProfit = payout − stake); it returns whether to proceed and the next stake.
 */
export class AutoPlayController {
  private stake: number;
  private roundsLeft: number;
  private cumulative = 0;

  constructor(private readonly cfg: AutoPlayConfig) {
    this.stake = cfg.baseStake;
    this.roundsLeft = cfg.rounds;
  }

  /** The first decision (before any drop). */
  first(): AutoPlayDecision {
    return this.roundsLeft > 0 ? { proceed: true, stake: this.stake, roundsLeft: this.roundsLeft } : { proceed: false, stake: 0, roundsLeft: 0, reason: 'no rounds' };
  }

  /** Feed the last drop's net profit; get the next decision. */
  next(netProfit: number): AutoPlayDecision {
    this.cumulative += netProfit;
    this.roundsLeft -= 1;
    // Adjust the next stake from the outcome.
    if (netProfit >= 0) this.stake = Math.max(1, Math.round(this.stake * (this.cfg.onWin ?? 1)));
    else this.stake = Math.max(1, Math.round(this.stake * (this.cfg.onLoss ?? 1)));

    if (this.roundsLeft <= 0) return { proceed: false, stake: this.stake, roundsLeft: 0, reason: 'rounds complete' };
    if (this.cfg.stopOnProfit !== undefined && this.cumulative >= this.cfg.stopOnProfit) return { proceed: false, stake: this.stake, roundsLeft: this.roundsLeft, reason: 'stop-on-profit' };
    if (this.cfg.stopOnLoss !== undefined && this.cumulative <= -this.cfg.stopOnLoss) return { proceed: false, stake: this.stake, roundsLeft: this.roundsLeft, reason: 'stop-on-loss' };
    return { proceed: true, stake: this.stake, roundsLeft: this.roundsLeft };
  }

  cumulativeNet(): number {
    return this.cumulative;
  }
}
