/**
 * Plinko mathematics (Sprint 1, STEP 2).
 *
 * The board is a Galton board: a ball taking `rows` independent left/right steps lands
 * in bin k with a binomial(rows, 0.5) probability. Multiplier tables are DERIVED, not
 * hardcoded: a symmetric "shape" (flat for low risk, edge-heavy for high risk) is
 * calibrated so the **expected RTP lands in the 96–97% target band**. There is no
 * winning logic here — the provably-fair path (elsewhere) decides the bin; this only
 * defines probabilities and payouts.
 */
import { type PlinkoRisk } from './types';

const TARGET_RTP = 0.965; // centre of the 96–97% band

/** C(n, k) via a multiplicative loop (exact for n ≤ 16). */
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i;
  return r;
}

/** Binomial(rows, 0.5) probability of landing in each bin 0..rows. */
export function binomialProbs(rows: number): number[] {
  const total = 2 ** rows;
  return Array.from({ length: rows + 1 }, (_, k) => choose(rows, k) / total);
}

/** Risk shape: edge gain + curvature. Higher risk ⇒ heavier edges, lighter centre. */
const SHAPE: Record<PlinkoRisk, { gain: number; curve: number }> = {
  low: { gain: 5, curve: 2 },
  medium: { gain: 35, curve: 2.5 },
  high: { gain: 400, curve: 3.1 },
};

/** Symmetric relative weights: 1 at the centre, rising toward the edges. */
function shapeWeights(rows: number, risk: PlinkoRisk): number[] {
  const c = rows / 2;
  const { gain, curve } = SHAPE[risk];
  return Array.from({ length: rows + 1 }, (_, k) => {
    const dn = Math.abs(k - c) / c; // 0 centre … 1 edge
    return 1 + gain * dn ** curve;
  });
}

/** Adaptive rounding: cleaner big edges, fine-grained small centres. */
function roundMult(x: number): number {
  if (x >= 100) return Math.round(x);
  if (x >= 10) return Math.round(x * 10) / 10;
  return Math.round(x * 100) / 100;
}

/** Expected RTP for a table = Σ P(bin) × mult(bin). */
export function expectedRtp(rows: number, table: number[]): number {
  const p = binomialProbs(rows);
  return table.reduce((s, m, k) => s + (p[k] ?? 0) * m, 0);
}

/**
 * Build the multiplier table for (rows, risk), calibrated so the rounded table's RTP
 * sits in the 96–97% band. Binary-search the overall scale (RTP is monotonic in it).
 */
export function buildTable(rows: number, risk: PlinkoRisk): number[] {
  const probs = binomialProbs(rows);
  const w = shapeWeights(rows, risk);
  const rtpOf = (scale: number) => {
    const table = w.map((x) => Math.max(0.1, roundMult(x * scale)));
    return { table, rtp: table.reduce((s, m, k) => s + (probs[k] ?? 0) * m, 0) };
  };
  let lo = 0;
  let hi = 100;
  let best = rtpOf(1).table;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    const { table, rtp } = rtpOf(mid);
    best = table;
    if (rtp < TARGET_RTP) lo = mid;
    else hi = mid;
  }
  return best;
}

/** Cached table registry (built once per rows×risk). */
const cache = new Map<string, number[]>();
export function plinkoTable(rows: number, risk: PlinkoRisk): number[] {
  const key = `${rows}:${risk}`;
  let table = cache.get(key);
  if (!table) {
    table = buildTable(rows, risk);
    cache.set(key, table);
  }
  return table;
}

/** House edge (1 − RTP) for a board. */
export function houseEdge(rows: number, risk: PlinkoRisk): number {
  return 1 - expectedRtp(rows, plinkoTable(rows, risk));
}
