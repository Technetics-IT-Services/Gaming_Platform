import { describe, expect, it } from 'vitest';

// The FROZEN frontend Plinko math (source of truth for RTP/payout).
import { plinkoTable as feTable, binomialProbs as feProbs, expectedRtp as feRtp } from './math';
// The Phase-2C.6 server-authoritative port used by the real-money bridge.
import {
  plinkoTable as beTable,
  binomialProbs as beProbs,
  expectedRtp as beRtp,
  playPlinko,
  PLINKO_ROWS,
  PLINKO_RISKS,
  type PlinkoRisk,
} from '../../../../backend/src/modules/gaming-money/engines/plinko-engine';

/**
 * Phase 2C.6 — Plinko game-math PARITY. Proves the backend real-money engine reproduces the frozen
 * frontend Plinko math EXACTLY for every supported board, so real-money RTP/payouts are identical to
 * the demo game. (The provably-fair RNG SOURCE differs by design — see the "RNG contract" test — but
 * the game math, tables, probabilities, landing-bin and payout mapping are byte-identical.)
 */
describe('Plinko backend↔frontend math parity', () => {
  for (const rows of PLINKO_ROWS) {
    it(`binomial probabilities identical (rows=${rows})`, () => {
      expect(beProbs(rows)).toEqual(feProbs(rows));
      const sum = beProbs(rows).reduce((s, p) => s + p, 0);
      expect(sum).toBeCloseTo(1, 12);
    });

    for (const risk of PLINKO_RISKS) {
      it(`multiplier table + RTP identical, RTP in 96–97% band (rows=${rows}, risk=${risk})`, () => {
        const fe = feTable(rows, risk as PlinkoRisk);
        const be = beTable(rows, risk);
        // 1) identical multiplier table
        expect(be).toEqual(fe);
        // 2) identical expected RTP (computed from the identical probs + table)
        expect(beRtp(rows, be)).toBeCloseTo(feRtp(rows, fe), 12);
        // 3) RTP calibrated into the target band
        expect(beRtp(rows, be)).toBeGreaterThanOrEqual(0.96);
        expect(beRtp(rows, be)).toBeLessThanOrEqual(0.97);
        // 4) table is symmetric with the minimum at the centre (structural sanity)
        expect(be).toEqual([...be].reverse());
      });
    }
  }

  it('landing-bin + payout mapping is identical (bin = right-steps; payout = stake × table[bin])', () => {
    // For any authoritative result, both sides map the same dirs → bin → multiplier.
    const rows = 16;
    const table = beTable(rows, 'medium');
    for (let seedN = 0; seedN < 200; seedN += 1) {
      const r = playPlinko(rows, 'medium', `seed-${seedN}`);
      const rightSteps = r.dirs.filter((d) => d === 1).length; // frontend bin definition (count of +1)
      expect(r.bin).toBe(rightSteps);
      expect(r.multiplier).toBe(table[r.bin]); // payout multiplier for the bin, from the identical table
      expect(r.bin).toBeGreaterThanOrEqual(0);
      expect(r.bin).toBeLessThanOrEqual(rows);
    }
  });

  it('a given seed is deterministic (same seed → same direction sequence + bin)', () => {
    const a = playPlinko(12, 'high', 'determinism-seed');
    const b = playPlinko(12, 'high', 'determinism-seed');
    expect(a.dirs).toEqual(b.dirs);
    expect(a.bin).toBe(b.bin);
    expect(a.multiplier).toBe(b.multiplier);
  });

  /**
   * RNG CONTRACT (point 5) — documented difference, NOT a game-math discrepancy.
   *
   * The frozen frontend engine derives each row's left/right step from a per-row provably-fair FLOAT
   * (`IProvablyFairProvider.nextFloat({ serverSeed, clientSeed, nonce: nonce*100+row })`). The backend
   * engine derives the SAME step from the platform's STANDARD backend primitive — a single
   * `SeededRng(seed)` float stream (seed = `ProvablyFairService.deriveSeed(serverSeed, clientSeed,
   * nonce)`), exactly as every other backend money game (crash/roulette/card/lottery) does. These are
   * different RNG SOURCES, so the direction sequence for a nominally-identical (serverSeed, clientSeed,
   * nonce) differs — this is by design (server authority uses one platform primitive), and it does NOT
   * affect the game math: both are uniform sources, so both realise the identical multiplier table and
   * ~96.5% RTP. The test below confirms the backend source is uniform (empirical RTP ≈ theoretical).
   */
  it('backend RNG is a valid uniform source → empirical RTP matches the theoretical table RTP', () => {
    const rows = 12;
    const risk: PlinkoRisk = 'medium';
    const theoretical = beRtp(rows, beTable(rows, risk));
    let staked = 0;
    let returned = 0;
    const N = 40000;
    for (let i = 0; i < N; i += 1) {
      const r = playPlinko(rows, risk, `rtp-seed-${i}`);
      staked += 1;
      returned += r.multiplier;
    }
    const empirical = returned / staked;
    expect(Math.abs(empirical - theoretical)).toBeLessThan(0.02); // uniform source realises the table RTP
  });
});
