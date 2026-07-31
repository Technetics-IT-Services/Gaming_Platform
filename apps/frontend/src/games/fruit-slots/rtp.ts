/**
 * Fruit Slots RTP estimation (Sprint 2).
 *
 * Deterministic Monte-Carlo over the frozen provably-fair provider: play N rounds with
 * sequential nonces and average the total win in stake-units. RTP = E[totalUnits] /
 * PAYLINES (a full bet covers all 20 lines). Used to calibrate the paytable and to
 * assert the shipped configuration lands in the 96–97% band.
 */
import type { IFairnessProof, IProvablyFairProvider } from '@gaming-platform/types';

import { playRound } from './engine';
import { PAYLINES, type SlotConfig, Symbol } from './types';

/* ------------------------------- exact RTP -------------------------------- */

/** Line units for a raw 5-symbol left-to-right sequence (wild substitution). */
function lineUnits(seq: Symbol[], paytable: SlotConfig['paytable']): number {
  if (seq[0] === Symbol.Scatter) return 0;
  let pay: Symbol = seq[0]!;
  if (pay === Symbol.Wild) pay = seq.find((s) => s !== Symbol.Wild && s !== Symbol.Scatter) ?? Symbol.Wild;
  let count = 0;
  for (const s of seq) {
    if (s === pay || s === Symbol.Wild) count += 1;
    else break;
  }
  const p = paytable[pay];
  if (!p || count < 3) return 0;
  return count === 5 ? p[5] : count === 4 ? p[4] : p[3];
}

/**
 * EXACT RTP (deterministic, no Monte-Carlo variance). A payline draws one symbol per
 * reel with probability weight/stripLength (independent), so E[line units] is computed
 * by enumerating the 8^5 symbol space. Scatter-count distribution is derived exactly by
 * scanning each reel's 3-window and convolving across reels. Free spins add
 * `E[awarded] × freeSpinMultiplier × baseUnits` (no re-trigger).
 */
export function exactRtp(config: SlotConfig): { rtp: number; baseRtp: number; lineUnits: number; efree: number; scatterUnits: number } {
  const strip = config.reels[0]!;
  const L = strip.length;
  const symbols = Object.values(Symbol) as Symbol[];
  const prob = (s: Symbol) => strip.filter((x) => x === s).length / L;

  // E[line units] over the 8^5 symbol space (weighted).
  let Lu = 0;
  const rec = (reel: number, p: number, seq: Symbol[]) => {
    if (reel === 5) {
      if (p > 0) Lu += p * lineUnits(seq, config.paytable);
      return;
    }
    for (const s of symbols) {
      const ps = prob(s);
      if (ps > 0) rec(reel + 1, p * ps, [...seq, s]);
    }
  };
  rec(0, 1, []);

  // Exact scatter-count distribution: per-reel window scatter count, convolved ×5.
  const perReel: number[] = [];
  for (let stop = 0; stop < L; stop += 1) {
    let c = 0;
    for (let r = 0; r < 3; r += 1) if (strip[(stop + r) % L] === Symbol.Scatter) c += 1;
    perReel[c] = (perReel[c] ?? 0) + 1 / L;
  }
  let dist = [1];
  for (let reel = 0; reel < 5; reel += 1) {
    const next: number[] = [];
    for (let a = 0; a < dist.length; a += 1) for (let b = 0; b < perReel.length; b += 1) if (dist[a] && perReel[b]) next[a + b] = (next[a + b] ?? 0) + dist[a]! * perReel[b]!;
    dist = next;
  }
  const scPay = (k: number) => (k >= 5 ? config.scatter.pays[5] : k === 4 ? config.scatter.pays[4] : config.scatter.pays[3]);
  const scFree = (k: number) => (k >= 5 ? config.scatter.freeSpins[5] : k === 4 ? config.scatter.freeSpins[4] : config.scatter.freeSpins[3]);
  let Su = 0;
  let efree = 0;
  for (let k = 3; k < dist.length; k += 1) {
    const pk = dist[k] ?? 0;
    Su += pk * scPay(k) * PAYLINES;
    efree += pk * scFree(k);
  }

  const baseUnits = PAYLINES * Lu + Su;
  const totalUnits = baseUnits * (1 + efree * config.scatter.freeSpinMultiplier);
  return { rtp: totalUnits / PAYLINES, baseRtp: baseUnits / PAYLINES, lineUnits: Lu, efree, scatterUnits: Su };
}

export interface RtpEstimate {
  spins: number;
  rtp: number;
  hitRate: number;
  /** Share of rounds that triggered free spins. */
  freeSpinRate: number;
  maxUnits: number;
}

export function estimateRtp(rng: IProvablyFairProvider, config: SlotConfig, opts: { spins: number; serverSeed?: string; clientSeed?: string; startNonce?: number } = { spins: 100_000 }): RtpEstimate {
  const serverSeed = opts.serverSeed ?? 'rtp-sim-server';
  const clientSeed = opts.clientSeed ?? 'rtp-sim-client';
  let totalUnits = 0;
  let hits = 0;
  let freeTriggers = 0;
  let maxUnits = 0;
  for (let i = 0; i < opts.spins; i += 1) {
    const fairness: IFairnessProof = { serverSeed, serverSeedHash: '', clientSeed, nonce: (opts.startNonce ?? 1) + i };
    const spin = playRound(rng, fairness, config);
    totalUnits += spin.totalUnits;
    if (spin.totalUnits > 0) hits += 1;
    if (spin.freeSpinsAwarded > 0) freeTriggers += 1;
    if (spin.totalUnits > maxUnits) maxUnits = spin.totalUnits;
  }
  return {
    spins: opts.spins,
    rtp: totalUnits / opts.spins / PAYLINES,
    hitRate: hits / opts.spins,
    freeSpinRate: freeTriggers / opts.spins,
    maxUnits,
  };
}
