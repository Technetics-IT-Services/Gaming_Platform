/**
 * Sic Bo provably-fair dice (Sprint 3, STEP 4).
 *
 * Each die is derived from an independent provably-fair float keyed by
 * `(serverSeed, clientSeed, nonce*100 + dieIndex)` — reproducible and verifiable. All
 * randomness lives only in the frozen `IProvablyFairProvider`.
 */
import type { IFairnessProof, IProvablyFairProvider } from '@gaming-platform/types';

import { type Dice } from './types';

export function dieNonce(nonce: number, die: number): number {
  return nonce * 100 + die;
}

/** Roll the three dice from the fairness proof. Deterministic. */
export function rollDice(rng: IProvablyFairProvider, fairness: IFairnessProof): Dice {
  const roll = (i: number) => Math.min(6, Math.floor(rng.nextFloat({ serverSeed: fairness.serverSeed ?? '', clientSeed: fairness.clientSeed, nonce: dieNonce(fairness.nonce, i) }) * 6) + 1);
  return [roll(0), roll(1), roll(2)];
}

export interface DiceVerification {
  valid: boolean;
  dice: Dice;
  reason?: string;
}

/** Verify a round: re-roll from the revealed seeds and compare to the recorded dice. */
export function verifyRoll(rng: IProvablyFairProvider, input: { serverSeed: string; clientSeed: string; nonce: number; expected: Dice }): DiceVerification {
  const dice = rollDice(rng, { serverSeed: input.serverSeed, serverSeedHash: '', clientSeed: input.clientSeed, nonce: input.nonce });
  const valid = dice[0] === input.expected[0] && dice[1] === input.expected[1] && dice[2] === input.expected[2];
  return { valid, dice, reason: valid ? undefined : 'dice mismatch' };
}
