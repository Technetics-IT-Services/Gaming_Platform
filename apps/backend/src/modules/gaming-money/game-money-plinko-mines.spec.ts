import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { GameRoundStatus } from '@prisma/client';

import { GameMoneyBridgeService } from './game-money-bridge.service';
import { playPlinko as computeDrop } from './engines/plinko-engine';
import { mineBoard } from './engines/mines-engine';

/**
 * Phase 2C.6 — Plinko + Mines money orchestration. Unit tests use the REAL pure engines (deterministic
 * from a fixed mocked seed) but mock the wallet/prisma to prove: Plinko reserves+settles once with the
 * engine payout; Mines reserves without settling, reveals safe/mine authoritatively, cashes out, and
 * enforces ownership — WITHOUT re-implementing wallet/ledger or trusting client values.
 */

const CURRENCY = { id: 'cur-inr', code: 'INR', decimals: 2, isActive: true };
const SEED = 'fixed-seed-abc';

function makeBridge(over: { user?: unknown; currency?: unknown; existingRound?: unknown; reserve?: jest.Mock; commit?: jest.Mock; minesRound?: Record<string, unknown> } = {}) {
  const round: Record<string, unknown> = { id: 'r1', userId: 'u1', gameKey: '', variant: '', betType: '', currencyId: 'cur-inr', stake: '10', payout: '0', status: GameRoundStatus.CREATED, betTransactionId: null, reservationId: null, actionSeq: 0, result: null, fairness: null };
  const active = over.minesRound;
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(over.user === undefined ? { id: 'u1', status: 'ACTIVE', deletedAt: null } : over.user) },
    currency: { findUnique: jest.fn().mockResolvedValue(over.currency === undefined ? CURRENCY : over.currency) },
    gameRound: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id?: string } }) => Promise.resolve(where.id ? (active ?? (over.existingRound === undefined ? round : over.existingRound)) : (over.existingRound ?? null))),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => { Object.assign(round, data); return Promise.resolve({ ...round }); }),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => { Object.assign(active ?? round, data); return Promise.resolve({ ...(active ?? round) }); }),
      updateMany: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => { Object.assign(active ?? round, data); return Promise.resolve({ count: 1 }); }),
    },
  };
  const wallet = {
    reserve: over.reserve ?? jest.fn().mockResolvedValue({ reservationId: 'res-1', wallet: {} }),
    commitReservation: over.commit ?? jest.fn().mockResolvedValue({ transactionId: 'tx-1', wallet: { available: '100', total: '100' } }),
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

describe('Plinko money — single-shot, engine-authoritative payout', () => {
  it('reserves ONCE and settles ONCE with the engine multiplier (payout = stake × multiplier)', async () => {
    const { bridge, wallet } = makeBridge();
    const expected = computeDrop(16, 'medium', SEED); // real engine, deterministic from the fixed seed
    const res = await bridge.playPlinko({ userId: 'u1', rows: 16, risk: 'medium', stake: '10', currencyCode: 'INR', idempotencyKey: 'idem-plinko-1' });
    expect(wallet.reserve).toHaveBeenCalledTimes(1);
    expect(wallet.commitReservation).toHaveBeenCalledTimes(1);
    expect(res.multiplier).toBe(expected.multiplier);
    expect(res.bin).toBe(expected.bin);
    expect(res.payout).toBe((10 * expected.multiplier).toFixed(2));
    expect(res.status).toBe(GameRoundStatus.SETTLED);
    expect(res.table.length).toBe(17); // rows+1 buckets
  });

  it('rejects unsupported rows/risk before reserving', async () => {
    const { bridge, wallet } = makeBridge();
    await expect(bridge.playPlinko({ userId: 'u1', rows: 9 as never, risk: 'medium', stake: '10', currencyCode: 'INR', idempotencyKey: 'k' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(bridge.playPlinko({ userId: 'u1', rows: 16, risk: 'insane' as never, stake: '10', currencyCode: 'INR', idempotencyKey: 'k' })).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.reserve).not.toHaveBeenCalled();
  });

  it('maps an overdraft on reserve to a clean insufficient-balance error', async () => {
    const reserve = jest.fn().mockRejectedValue(new Error('Insufficient available balance to reserve'));
    const { bridge, wallet } = makeBridge({ reserve });
    await expect(bridge.playPlinko({ userId: 'u1', rows: 8, risk: 'low', stake: '10', currencyCode: 'INR', idempotencyKey: 'k' })).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.commitReservation).not.toHaveBeenCalled();
  });
});

describe('Mines money — interactive, hidden authoritative board', () => {
  it('start reserves the stake WITHOUT settling and hides the board + server seed', async () => {
    const { bridge, wallet } = makeBridge();
    const res = await bridge.startMines({ userId: 'u1', stake: '10', mines: 3, currencyCode: 'INR', idempotencyKey: 'idem-mines-1' });
    expect(wallet.reserve).toHaveBeenCalledTimes(1);
    expect(wallet.commitReservation).not.toHaveBeenCalled();
    expect(res.active).toBe(true);
    expect(res.status).toBe(GameRoundStatus.RESERVED);
    expect(res.board).toBeNull(); // hidden while active
    expect(res.provablyFair.serverSeed).toBe(''); // hidden while active
    expect(res.provablyFair.serverSeedHash).toBe('hash');
    expect(res.mines).toBe(3);
  });

  it('a safe reveal grows the multiplier and keeps the round active', async () => {
    const board = mineBoard(25, 3, SEED); // real board for the fixed seed
    const safe = [...Array(25).keys()].find((i) => !board.includes(i))!;
    const minesRound = { id: 'm1', userId: 'u1', gameKey: 'mines', currencyId: 'cur-inr', stake: '10', payout: '0', status: GameRoundStatus.RESERVED, reservationId: 'res-1', actionSeq: 0, result: { kind: 'mines', seed: SEED, serverSeed: 'server-seed', serverSeedHash: 'hash', clientSeed: 'c', nonce: 0, tiles: 25, mines: 3, stake: '10', revealed: [], multiplier: 1 } };
    const { bridge, wallet } = makeBridge({ minesRound });
    const res = await bridge.minesReveal({ userId: 'u1', roundId: 'm1', index: safe });
    expect(res.active).toBe(true);
    expect(res.revealed).toContain(safe);
    expect(res.multiplier).toBeGreaterThan(1);
    expect(wallet.commitReservation).not.toHaveBeenCalled(); // still active, no settlement
  });

  it('revealing a mine settles the round as a loss (payout 0) and reveals the board', async () => {
    const board = mineBoard(25, 3, SEED);
    const minesRound = { id: 'm2', userId: 'u1', gameKey: 'mines', currencyId: 'cur-inr', stake: '10', payout: '0', status: GameRoundStatus.RESERVED, reservationId: 'res-1', actionSeq: 0, result: { kind: 'mines', seed: SEED, serverSeed: 'server-seed', serverSeedHash: 'hash', clientSeed: 'c', nonce: 0, tiles: 25, mines: 3, stake: '10', revealed: [], multiplier: 1 } };
    const { bridge, wallet } = makeBridge({ minesRound });
    const res = await bridge.minesReveal({ userId: 'u1', roundId: 'm2', index: board[0]! });
    expect(res.status).toBe(GameRoundStatus.SETTLED);
    expect(res.won).toBe(false);
    expect(res.board).toEqual(board); // revealed on settle
    expect(wallet.commitReservation).toHaveBeenCalledWith('res-1', '0', expect.any(String), expect.any(String)); // loss commit
  });

  it('cashout after a safe reveal settles the win at the current multiplier', async () => {
    const board = mineBoard(25, 3, SEED);
    const safe = [...Array(25).keys()].find((i) => !board.includes(i))!;
    const minesRound = { id: 'm3', userId: 'u1', gameKey: 'mines', currencyId: 'cur-inr', stake: '10', payout: '0', status: GameRoundStatus.RESERVED, reservationId: 'res-1', actionSeq: 1, result: { kind: 'mines', seed: SEED, serverSeed: 'server-seed', serverSeedHash: 'hash', clientSeed: 'c', nonce: 0, tiles: 25, mines: 3, stake: '10', revealed: [safe], multiplier: 1.08 } };
    const { bridge, wallet } = makeBridge({ minesRound });
    const res = await bridge.minesCashout({ userId: 'u1', roundId: 'm3' });
    expect(res.status).toBe(GameRoundStatus.SETTLED);
    expect(res.won).toBe(true);
    expect(Number(res.payout)).toBeGreaterThan(0);
    expect(wallet.commitReservation).toHaveBeenCalledTimes(1);
  });

  it('rejects cashout with no reveals, and actions on another user\'s round', async () => {
    const minesRound = { id: 'm4', userId: 'u1', gameKey: 'mines', currencyId: 'cur-inr', stake: '10', payout: '0', status: GameRoundStatus.RESERVED, reservationId: 'res-1', actionSeq: 0, result: { kind: 'mines', seed: SEED, tiles: 25, mines: 3, stake: '10', revealed: [], multiplier: 1 } };
    const { bridge } = makeBridge({ minesRound });
    await expect(bridge.minesCashout({ userId: 'u1', roundId: 'm4' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(bridge.minesReveal({ userId: 'someone-else', roundId: 'm4', index: 0 })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
