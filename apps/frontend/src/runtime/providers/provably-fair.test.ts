import type { IFairnessProof } from '@gaming-platform/types';
import { describe, expect, it } from 'vitest';

import { RuntimeErrorCode, RuntimeError } from '../errors';
import { DemoProvablyFairProvider, RealProvablyFairProvider } from './provably-fair';

/**
 * Provably-fair provider (STEP 7).
 *
 * The demo provider is a synchronous, fully reproducible hash mix: identical
 * seeds+nonce always yield the same float, so any outcome can be re-verified.
 * Tests cover determinism, commit generation, the [0,1) range, verification
 * (positive + negative), distribution over a large sample, and the inactive real
 * stub.
 */

const provider = new DemoProvablyFairProvider();

describe('provably-fair (demo) — determinism', () => {
  it('yields the same float for identical seeds + nonce', () => {
    const input = { serverSeed: 'srv', clientSeed: 'cli', nonce: 1 };
    expect(provider.nextFloat(input)).toBe(provider.nextFloat(input));
  });

  it('yields different floats as the nonce advances', () => {
    const a = provider.nextFloat({ serverSeed: 'srv', clientSeed: 'cli', nonce: 1 });
    const b = provider.nextFloat({ serverSeed: 'srv', clientSeed: 'cli', nonce: 2 });
    expect(a).not.toBe(b);
  });

  it('is sensitive to both server and client seed', () => {
    const base = provider.nextFloat({ serverSeed: 'srv', clientSeed: 'cli', nonce: 1 });
    expect(provider.nextFloat({ serverSeed: 'SRV', clientSeed: 'cli', nonce: 1 })).not.toBe(base);
    expect(provider.nextFloat({ serverSeed: 'srv', clientSeed: 'CLI', nonce: 1 })).not.toBe(base);
  });
});

describe('provably-fair (demo) — commit', () => {
  it('produces a server seed and its published hash', () => {
    const commit = provider.commit();
    expect(commit.serverSeed).toMatch(/^[0-9a-f]{32}$/); // 16 bytes hex
    expect(commit.serverSeedHash).toMatch(/^[0-9a-f]+$/);
    expect(commit.serverSeedHash).not.toBe(commit.serverSeed);
  });

  it('commits are unique across calls (fresh entropy each round)', () => {
    const seeds = new Set(Array.from({ length: 100 }, () => provider.commit().serverSeed));
    expect(seeds.size).toBe(100);
  });
});

describe('provably-fair (demo) — range', () => {
  it('every derived float lies in [0, 1)', () => {
    for (let nonce = 0; nonce < 5000; nonce += 1) {
      const v = provider.nextFloat({ serverSeed: 'srv', clientSeed: 'cli', nonce });
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('the large sample is reasonably spread across the unit interval', () => {
    const buckets = new Array(10).fill(0);
    const N = 10_000;
    for (let nonce = 0; nonce < N; nonce += 1) {
      const v = provider.nextFloat({ serverSeed: 'dist', clientSeed: 'cli', nonce });
      buckets[Math.min(9, Math.floor(v * 10))] += 1;
    }
    // No decile should be empty or dominate — a coarse uniformity sanity check.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(N * 0.03);
      expect(count).toBeLessThan(N * 0.25);
    }
  });
});

describe('provably-fair (demo) — verify', () => {
  it('confirms a proof against its own recomputed value', () => {
    const proof: IFairnessProof = { serverSeed: 'srv', serverSeedHash: 'h', clientSeed: 'cli', nonce: 3 };
    const expected = provider.nextFloat({ serverSeed: 'srv', clientSeed: 'cli', nonce: 3 });
    expect(provider.verify(proof, expected)).toBe(true);
  });

  it('rejects a proof whose expected value is wrong', () => {
    const proof: IFairnessProof = { serverSeed: 'srv', serverSeedHash: 'h', clientSeed: 'cli', nonce: 3 };
    expect(provider.verify(proof, 0.123456)).toBe(false);
  });

  it('rejects a proof missing the revealed server seed', () => {
    const proof: IFairnessProof = { serverSeedHash: 'h', clientSeed: 'cli', nonce: 3 };
    expect(provider.verify(proof, 0.5)).toBe(false);
  });
});

describe('provably-fair (real) — inactive stub', () => {
  it('throws FEATURE_DISABLED for every method in Phase 2.2', () => {
    const real = new RealProvablyFairProvider();
    for (const call of [() => real.commit(), () => real.nextFloat(), () => real.verify()]) {
      expect(call).toThrow(RuntimeError);
      try {
        call();
      } catch (err) {
        expect((err as RuntimeError).code).toBe(RuntimeErrorCode.FEATURE_DISABLED);
      }
    }
  });
});
