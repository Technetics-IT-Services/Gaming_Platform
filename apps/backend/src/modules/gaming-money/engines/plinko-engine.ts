import { SeededRng } from '@gaming-platform/game-sdk';

/**
 * Server-authoritative Plinko engine (Phase 2C.6).
 *
 * A FAITHFUL PORT of the existing frontend Plinko math (`apps/frontend/src/games/plinko/{math,
 * provably-fair}.ts`) — identical binomial probabilities, identical RTP-calibrated multiplier tables
 * (~96.5%, derived not hardcoded), identical landing-bin logic — moved server-side so the real-money
 * outcome is authoritative (the client can never determine the bin/multiplier/payout). Determinism
 * comes from the platform's standard provably-fair primitive: a per-round seed (ProvablyFairService)
 * feeds a `SeededRng` whose float stream picks each row's left/right step. No engine math is changed.
 */

export type PlinkoRisk = 'low' | 'medium' | 'high';
export const PLINKO_RISKS: readonly PlinkoRisk[] = ['low', 'medium', 'high'] as const;
export const PLINKO_ROWS: readonly number[] = [8, 10, 12, 14, 16] as const;

const TARGET_RTP = 0.965;

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

const SHAPE: Record<PlinkoRisk, { gain: number; curve: number }> = {
  low: { gain: 5, curve: 2 },
  medium: { gain: 35, curve: 2.5 },
  high: { gain: 400, curve: 3.1 },
};

function shapeWeights(rows: number, risk: PlinkoRisk): number[] {
  const c = rows / 2;
  const { gain, curve } = SHAPE[risk];
  return Array.from({ length: rows + 1 }, (_, k) => {
    const dn = Math.abs(k - c) / c;
    return 1 + gain * dn ** curve;
  });
}

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

/** Build the (rows, risk) multiplier table, calibrated so the RTP sits in the 96–97% band. */
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

export interface PlinkoResult {
  rows: number;
  risk: PlinkoRisk;
  /** Per-row step: -1 (left) / +1 (right). */
  dirs: number[];
  /** Landing bin (count of right steps), 0..rows. */
  bin: number;
  /** Landed multiplier for the bin (may be < 1). */
  multiplier: number;
  /** The full multiplier row for this board (client renders slots from this — authoritative). */
  table: number[];
}

/**
 * Authoritatively drop one ball. `seed` is the round's provably-fair seed (derived server-side).
 * Deterministic + verifiable: re-derive the seed → replay the float stream → same bin.
 */
export function playPlinko(rows: number, risk: PlinkoRisk, seed: string): PlinkoResult {
  if (!PLINKO_ROWS.includes(rows)) throw new Error(`plinko: unsupported rows ${rows}`);
  if (!PLINKO_RISKS.includes(risk)) throw new Error(`plinko: unsupported risk ${risk}`);
  const rng = new SeededRng(seed);
  const dirs: number[] = [];
  let right = 0;
  for (let i = 0; i < rows; i += 1) {
    const step = rng.next() >= 0.5 ? 1 : 0;
    right += step;
    dirs.push(step ? 1 : -1);
  }
  const table = plinkoTable(rows, risk);
  return { rows, risk, dirs, bin: right, multiplier: table[right] ?? 0, table };
}
