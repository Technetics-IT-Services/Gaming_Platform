'use client';

import type { IFairnessProof, IProvablyFairProvider } from '@gaming-platform/types';

import { RuntimeError, RuntimeErrorCode } from '../errors';

/**
 * Provably-fair providers (Phase 2.2).
 *
 * `DemoProvablyFairProvider` — a synchronous, fully REPRODUCIBLE hash mix
 * (xmur3). Given `serverSeed:clientSeed:nonce` it always yields the same float,
 * so `verify()` reproduces any outcome. It is intentionally NOT cryptographic
 * SHA-256 (kept dependency-free + sync for the contract's sync `nextFloat`);
 * the real provider uses the backend HMAC-SHA256 engine.
 */

/** Deterministic 32-bit hash of a string (xmur3). */
function hash32(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function randomHex(bytes = 16): string {
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Non-crypto fallback (never used in the browser). Not for production RNG.
  let out = '';
  for (let i = 0; i < bytes * 2; i += 1) out += ((hash32(`${i}:${out}`) & 0xf).toString(16));
  return out;
}

export class DemoProvablyFairProvider implements IProvablyFairProvider {
  commit(): { serverSeed: string; serverSeedHash: string } {
    const serverSeed = randomHex(16);
    // Demo "hash": a reproducible digest of the server seed (not SHA-256).
    const serverSeedHash = hash32(`commit:${serverSeed}`).toString(16).padStart(8, '0');
    return { serverSeed, serverSeedHash };
  }

  nextFloat(input: { serverSeed: string; clientSeed: string; nonce: number }): number {
    const h = hash32(`${input.serverSeed}:${input.clientSeed}:${input.nonce}`);
    return h / 0x1_0000_0000; // [0, 1)
  }

  verify(proof: IFairnessProof, expected: number): boolean {
    if (!proof.serverSeed) return false;
    const value = this.nextFloat({
      serverSeed: proof.serverSeed,
      clientSeed: proof.clientSeed,
      nonce: proof.nonce,
    });
    return Math.abs(value - expected) < 1e-9;
  }
}

/**
 * Real provably-fair provider — delegates to the backend HMAC-SHA256 engine
 * (`modules/runtime/provably-fair.service`). Inactive in Phase 2.2.
 */
export class RealProvablyFairProvider implements IProvablyFairProvider {
  private notActive(): never {
    throw new RuntimeError(
      RuntimeErrorCode.FEATURE_DISABLED,
      'Real provably-fair provider is not active in Phase 2.2 (demo mode).',
    );
  }
  commit(): { serverSeed: string; serverSeedHash: string } {
    return this.notActive();
  }
  nextFloat(): number {
    return this.notActive();
  }
  verify(): boolean {
    return this.notActive();
  }
}
