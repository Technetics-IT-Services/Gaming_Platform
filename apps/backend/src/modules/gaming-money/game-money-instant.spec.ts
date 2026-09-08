import { BadRequestException } from '@nestjs/common';
import { GameRoundStatus } from '@prisma/client';

import { GameMoneyBridgeService } from './game-money-bridge.service';
import { parseInstantSelection, playInstant as computeInstant } from './engines/instant-engine';

/**
 * Phase 2C.7 — Instant games (Limbo · Coin Flip · Wheel) money orchestration. Unit tests use the REAL
 * pure engine (deterministic from a fixed mocked seed) but mock the wallet/prisma to prove: one
 * generic method reserves + settles ONCE with the engine's authoritative multiplier (payout =
 * stake × multiplier), validates the selection BEFORE reserving, and never re-implements wallet/ledger
 * or trusts client-supplied results.
 */

const CURRENCY = { id: 'cur-inr', code: 'INR', decimals: 2, isActive: true };
const SEED = 'fixed-seed-abc';

function makeBridge(over: { user?: unknown; currency?: unknown; existingRound?: unknown; reserve?: jest.Mock } = {}) {
  const round: Record<string, unknown> = { id: 'r1', userId: 'u1', gameKey: '', variant: '', betType: '', currencyId: 'cur-inr', stake: '10', payout: '0', status: GameRoundStatus.CREATED, betTransactionId: null, reservationId: null, actionSeq: 0, result: null, fairness: null };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(over.user === undefined ? { id: 'u1', status: 'ACTIVE', deletedAt: null } : over.user) },
    currency: { findUnique: jest.fn().mockResolvedValue(over.currency === undefined ? CURRENCY : over.currency) },
    gameRound: {
      findUnique: jest.fn().mockResolvedValue(over.existingRound === undefined ? null : over.existingRound),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => { Object.assign(round, data); return Promise.resolve({ ...round }); }),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => { Object.assign(round, data); return Promise.resolve({ ...round }); }),
    },
  };
  const wallet = {
    reserve: over.reserve ?? jest.fn().mockResolvedValue({ reservationId: 'res-1', wallet: {} }),
    commitReservation: jest.fn().mockResolvedValue({ transactionId: 'tx-1', wallet: { available: '100', total: '100' } }),
    releaseReservation: jest.fn().mockResolvedValue({ transactionId: 'tx-r', wallet: { available: '100', total: '100' } }),
    getOrCreateWallet: jest.fn().mockResolvedValue({ available: '100', total: '100' }),
  };
  const noop = { play: jest.fn(), resolve: jest.fn() };
  const fair = { createCommit: jest.fn().mockReturnValue({ serverSeed: 'server-seed', serverSeedHash: 'hash', nonce: 0 }), deriveSeed: jest.fn().mockReturnValue(SEED), hash: jest.fn(), verify: jest.fn() };
  const bridge = new GameMoneyBridgeService(
    prisma as never, wallet as never, noop as never, noop as never,
    noop as never, noop as never, noop as never, noop as never, fair as never,
    noop as never, noop as never,
  );
  return { bridge, prisma, wallet, round };
}

describe('Instant money — generic single-shot, engine-authoritative payout', () => {
  it('LIMBO: reserves + settles ONCE; payout = stake × multiplier from the real engine', async () => {
    const expected = computeInstant(parseInstantSelection('limbo', { target: 2 }), SEED);
    const { bridge, wallet } = makeBridge();
    const res = await bridge.playInstant({ userId: 'u1', gameKey: 'limbo', selection: { target: 2 }, stake: '10', currencyCode: 'INR', idempotencyKey: 'k-limbo' });
    expect(wallet.reserve).toHaveBeenCalledTimes(1);
    expect(wallet.commitReservation).toHaveBeenCalledTimes(1);
    expect(res.multiplier).toBe(expected.multiplier);
    expect(res.payout).toBe((10 * expected.multiplier).toFixed(2));
    expect(res.status).toBe(GameRoundStatus.SETTLED);
    expect(res.win).toBe(expected.win);
  });

  it('COIN-FLIP: reserves + settles ONCE; outcome + payout are the engine values', async () => {
    const expected = computeInstant(parseInstantSelection('coin-flip', { side: 'heads' }), SEED);
    const { bridge, wallet } = makeBridge();
    const res = await bridge.playInstant({ userId: 'u1', gameKey: 'coin-flip', selection: { side: 'heads' }, stake: '10', currencyCode: 'INR', idempotencyKey: 'k-coin' });
    expect(wallet.reserve).toHaveBeenCalledTimes(1);
    expect(wallet.commitReservation).toHaveBeenCalledTimes(1);
    expect(res.win).toBe(expected.win);
    expect(res.multiplier).toBe(expected.multiplier);
    expect(res.payout).toBe((10 * expected.multiplier).toFixed(2));
  });

  it('WHEEL: reserves + settles ONCE for each risk with the engine segment multiplier', async () => {
    for (const risk of ['low', 'medium', 'high'] as const) {
      const expected = computeInstant(parseInstantSelection('wheel', { risk }), SEED);
      const { bridge, wallet } = makeBridge();
      const res = await bridge.playInstant({ userId: 'u1', gameKey: 'wheel', selection: { risk }, stake: '10', currencyCode: 'INR', idempotencyKey: `k-wheel-${risk}` });
      expect(wallet.reserve).toHaveBeenCalledTimes(1);
      expect(wallet.commitReservation).toHaveBeenCalledTimes(1);
      expect(res.multiplier).toBe(expected.multiplier);
      expect(res.payout).toBe((10 * expected.multiplier).toFixed(2));
    }
  });

  it('rejects an unsupported game before reserving', async () => {
    const { bridge, wallet } = makeBridge();
    await expect(bridge.playInstant({ userId: 'u1', gameKey: 'roulette' as never, selection: {}, stake: '10', currencyCode: 'INR', idempotencyKey: 'k' })).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.reserve).not.toHaveBeenCalled();
  });

  it('rejects an invalid selection for every game BEFORE reserving', async () => {
    const bad: Array<[string, Record<string, unknown>]> = [
      ['limbo', { target: 1 }], // below min target
      ['limbo', { target: 'x' }],
      ['coin-flip', { side: 'edge' }],
      ['wheel', { risk: 'insane' }],
    ];
    for (const [gameKey, selection] of bad) {
      const { bridge, wallet } = makeBridge();
      await expect(bridge.playInstant({ userId: 'u1', gameKey: gameKey as never, selection, stake: '10', currencyCode: 'INR', idempotencyKey: 'k' })).rejects.toBeInstanceOf(BadRequestException);
      expect(wallet.reserve).not.toHaveBeenCalled();
    }
  });

  it('maps an overdraft on reserve to a clean insufficient-balance error (no settlement)', async () => {
    const reserve = jest.fn().mockRejectedValue(new Error('Insufficient available balance to reserve'));
    const { bridge, wallet } = makeBridge({ reserve });
    await expect(bridge.playInstant({ userId: 'u1', gameKey: 'limbo', selection: { target: 2 }, stake: '10', currencyCode: 'INR', idempotencyKey: 'k' })).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.commitReservation).not.toHaveBeenCalled();
  });

  it('is idempotent — an existing round returns without a second reserve', async () => {
    const existing = { id: 'r1', userId: 'u1', variant: 'limbo', betType: 'limbo:2.00', currencyId: 'cur-inr', stake: '10', payout: '4', status: GameRoundStatus.SETTLED, betTransactionId: 'tx-1', reservationId: 'res-1', result: { kind: 'limbo', multiplier: 2, win: true }, fairness: {} };
    const { bridge, wallet } = makeBridge({ existingRound: existing });
    const res = await bridge.playInstant({ userId: 'u1', gameKey: 'limbo', selection: { target: 2 }, stake: '10', currencyCode: 'INR', idempotencyKey: 'dup' });
    expect(wallet.reserve).not.toHaveBeenCalled();
    expect(res.replayed).toBe(true);
    expect(res.roundId).toBe('r1');
  });
});
