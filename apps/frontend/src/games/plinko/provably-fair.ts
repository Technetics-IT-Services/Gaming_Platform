/**
 * Plinko provably-fair path (Sprint 1, STEP 3).
 *
 * The ball's path is derived ONLY from the frozen `IProvablyFairProvider`: each row's
 * left/right step comes from an independent provably-fair float keyed by
 * `(serverSeed, clientSeed, rowNonce)`, where `rowNonce = nonce*100 + rowIndex` (rows
 * ≤ 16, so sub-nonces never collide across rounds). Every drop is reproducible and
 * independently verifiable. No randomness lives outside the frozen provider.
 */
import type { IFairnessProof, IProvablyFairProvider } from '@gaming-platform/types';

import { type PlinkoRisk, type PlinkoDropRecord } from './types';

/** Per-row provider nonce for a round nonce + row index. */
export function rowNonce(nonce: number, row: number): number {
  return nonce * 100 + row;
}

export interface DerivedPath {
  /** Per-row step: -1 (left) / +1 (right). */
  dirs: number[];
  /** Landing bin (count of right steps), 0..rows. */
  bin: number;
  /** The raw provably-fair float per row (verification aid). */
  floats: number[];
}

/** Derive the ball path for a board from the fairness proof. Deterministic. */
export function derivePath(rng: IProvablyFairProvider, fairness: IFairnessProof, rows: number): DerivedPath {
  const serverSeed = fairness.serverSeed ?? '';
  const dirs: number[] = [];
  const floats: number[] = [];
  let right = 0;
  for (let i = 0; i < rows; i += 1) {
    const f = rng.nextFloat({ serverSeed, clientSeed: fairness.clientSeed, nonce: rowNonce(fairness.nonce, i) });
    floats.push(f);
    const step = f >= 0.5 ? 1 : 0;
    right += step;
    dirs.push(step ? 1 : -1);
  }
  return { dirs, bin: right, floats };
}

export interface VerificationResult {
  valid: boolean;
  bin: number;
  dirs: number[];
  reason?: string;
}

/**
 * Verify a drop: recompute the path from the revealed seeds and compare it to the
 * recorded landing bin (and dirs, if provided). A player runs this to confirm fairness.
 */
export function verifyDrop(
  rng: IProvablyFairProvider,
  input: { serverSeed: string; clientSeed: string; nonce: number; rows: number; expectedBin: number; expectedDirs?: number[] },
): VerificationResult {
  const proof: IFairnessProof = { serverSeed: input.serverSeed, serverSeedHash: '', clientSeed: input.clientSeed, nonce: input.nonce };
  const { dirs, bin } = derivePath(rng, proof, input.rows);
  if (bin !== input.expectedBin) return { valid: false, bin, dirs, reason: `bin mismatch: got ${bin}, expected ${input.expectedBin}` };
  if (input.expectedDirs && input.expectedDirs.join(',') !== dirs.join(',')) return { valid: false, bin, dirs, reason: 'path mismatch' };
  return { valid: true, bin, dirs };
}

/** The provably-fair panel summary for a drop (what the UI exposes to players). */
export interface FairnessSummary {
  serverSeed?: string;
  serverSeedHash?: string;
  clientSeed: string;
  nonce: number;
  path: number[];
  landingBin: number;
  multiplier: number;
  verified: boolean;
}

export function fairnessSummary(rng: IProvablyFairProvider, record: PlinkoDropRecord & { risk: PlinkoRisk }): FairnessSummary {
  const verified =
    record.serverSeed !== undefined
      ? verifyDrop(rng, { serverSeed: record.serverSeed, clientSeed: record.clientSeed, nonce: record.nonce, rows: record.rows, expectedBin: record.bin, expectedDirs: record.dirs }).valid
      : false;
  return {
    serverSeed: record.serverSeed,
    serverSeedHash: record.serverSeedHash,
    clientSeed: record.clientSeed,
    nonce: record.nonce,
    path: record.dirs,
    landingBin: record.bin,
    multiplier: record.mult,
    verified,
  };
}
