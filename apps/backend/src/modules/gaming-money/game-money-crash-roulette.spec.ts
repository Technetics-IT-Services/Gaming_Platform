import { BadRequestException } from '@nestjs/common';
import { GameRoundStatus } from '@prisma/client';
import { CRASH_VARIANT_PRESETS, RuleResolver as CrashRules } from '@gaming-platform/crash-engine';

import { GameMoneyBridgeService } from './game-money-bridge.service';

/**
 * Phase 2C.2 — Crash + Roulette money orchestration. Unit tests with mocked collaborators
 * prove the reservation/settlement flow, multi-bet single-reservation, validation, idempotency
 * and that the crash "running" response never leaks the crash point — WITHOUT re-implementing
 * wallet/ledger/game math. Live financial invariants are proven separately against Postgres.
 */

const CURRENCY = { id: 'cur-inr', code: 'INR', decimals: 2, isActive: true };
const ROULETTE_RULESET = {
  key: 'european',
  name: 'European',
  betTypes: [
    { key: 'red', label: 'Red', category: 'outside', match: 'red', payout: 2 },
    { key: 'straight', label: 'Straight', category: 'inside', match: 'numbers', payout: 36, selectionSize: 1 },
  ],
  limits: { min: 1, max: 10000, tableMax: 50000 },
  layout: { maxNumber: 36, greenPockets: [0], redNumbers: [7] },
};

function spinResult(totalBet: string, totalWin: string, winningBets: string[]) {
  return {
    result: { roundId: 'r', variant: 'european', mode: 'roulette', pocket: 7, pocketLabel: '7', color: 'red', sequenceIndex: 0, rotation: 0, winningBets, settlement: { bets: [], totalBet, totalWin, net: '0' }, details: {}, verification: { seed: 's' } },
    fairness: { serverSeed: 'ss', serverSeedHash: 'hash', clientSeed: 'cs', nonce: 1 },
  };
}

function makeBridge(over: {
  user?: unknown; currency?: unknown; existingRound?: unknown;
  reserve?: jest.Mock; commit?: jest.Mock; rouletteResolve?: jest.Mock; roulettePlay?: jest.Mock; crashResolve?: jest.Mock;
} = {}) {
  const round: Record<string, unknown> = { id: 'round-1', userId: 'u1', variant: 'european', betType: 'red', currencyId: 'cur-inr', stake: '20.00', payout: '0', status: GameRoundStatus.CREATED, betTransactionId: null, reservationId: null, result: null, fairness: null };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(over.user === undefined ? { id: 'u1', status: 'ACTIVE', deletedAt: null } : over.user) },
    currency: { findUnique: jest.fn().mockResolvedValue(over.currency === undefined ? CURRENCY : over.currency) },
    gameRound: {
      findUnique: jest.fn().mockResolvedValue(over.existingRound ?? null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ ...round }),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => { Object.assign(round, data); return Promise.resolve({ ...round }); }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const wallet = {
    reserve: over.reserve ?? jest.fn().mockResolvedValue({ reservationId: 'res-1', wallet: {} }),
    commitReservation: over.commit ?? jest.fn().mockResolvedValue({ transactionId: 'tx-1', reference: 'round:round-1:bet', wallet: { available: '100', total: '100' } }),
    releaseReservation: jest.fn().mockResolvedValue({ transactionId: 'tx-r', wallet: { available: '100', total: '100' } }),
    getOrCreateWallet: jest.fn().mockResolvedValue({ available: '100', total: '100' }),
  };
  const dice = { play: jest.fn() };
  const variants = { resolve: jest.fn() };
  const crash = { play: jest.fn() };
  const crashVariants = { resolve: over.crashResolve ?? jest.fn().mockResolvedValue(CrashRules.resolve(CRASH_VARIANT_PRESETS['crash']!)) };
  const roulette = { play: over.roulettePlay ?? jest.fn().mockResolvedValue(spinResult('20', '40', ['red'])) };
  const rouletteVariants = { resolve: over.rouletteResolve ?? jest.fn().mockResolvedValue(ROULETTE_RULESET) };
  const fair = { createCommit: jest.fn().mockReturnValue({ serverSeed: 'ss', serverSeedHash: 'hash', nonce: 0 }), deriveSeed: jest.fn().mockReturnValue('seed-fixed'), hash: jest.fn(), verify: jest.fn() };
  const card = { play: jest.fn() };
  const cardVariants = { resolve: jest.fn() };
  const bridge = new GameMoneyBridgeService(
    prisma as never, wallet as never, dice as never, variants as never,
    crash as never, crashVariants as never, roulette as never, rouletteVariants as never, fair as never,
    card as never, cardVariants as never,
  );
  return { bridge, prisma, wallet, roulette };
}

const rbase = { userId: 'u1', variant: 'european', currencyCode: 'INR', idempotencyKey: 'idem-roulette-1' };
const cbase = { userId: 'u1', variant: 'crash', stake: '10.00', currencyCode: 'INR', idempotencyKey: 'idem-crash-1' };

describe('Roulette money — single reservation, engine-authoritative payout', () => {
  it('reserves the TOTAL stake ONCE and settles ONCE with the engine payout', async () => {
    const { bridge, wallet } = makeBridge();
    const res = await bridge.playRoulette({ ...rbase, bets: [{ type: 'red', amount: '10' }, { type: 'straight', amount: '10', selection: [7] }] });
    expect(wallet.reserve).toHaveBeenCalledTimes(1);
    expect(wallet.reserve.mock.calls[0][2]).toBe('20.00'); // total stake, one reservation
    expect(wallet.commitReservation).toHaveBeenCalledTimes(1);
    expect(wallet.commitReservation.mock.calls[0][1]).toBe('40'); // payout from engine
    expect(res.payout).toBe('40');
    expect(res.status).toBe(GameRoundStatus.SETTLED);
  });

  it('rejects an unknown bet type BEFORE reserving any money', async () => {
    const { bridge, wallet } = makeBridge();
    await expect(bridge.playRoulette({ ...rbase, bets: [{ type: 'nonsense', amount: '10' }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.reserve).not.toHaveBeenCalled();
  });

  it('rejects a straight bet missing its selection before reserving', async () => {
    const { bridge, wallet } = makeBridge();
    await expect(bridge.playRoulette({ ...rbase, bets: [{ type: 'straight', amount: '10' }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.reserve).not.toHaveBeenCalled();
  });

  it('maps an overdraft on reserve to a clean insufficient-balance error', async () => {
    const reserve = jest.fn().mockRejectedValue(new Error('Insufficient available balance to reserve'));
    const { bridge, wallet } = makeBridge({ reserve });
    await expect(bridge.playRoulette({ ...rbase, bets: [{ type: 'red', amount: '10' }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.commitReservation).not.toHaveBeenCalled();
  });

  it('is idempotent — an existing round replays without a second reservation', async () => {
    const existing = { id: 'round-1', userId: 'u1', variant: 'european', betType: 'red', currencyId: 'cur-inr', stake: '20.00', payout: '40', status: GameRoundStatus.SETTLED, betTransactionId: 'tx-1', reservationId: 'res-1', result: { pocket: 7, color: 'red', winningBets: ['red'], settlement: { bets: [], totalBet: '20', totalWin: '40', net: '20' } }, fairness: {} };
    const { bridge, wallet } = makeBridge({ existingRound: existing });
    const res = await bridge.playRoulette({ ...rbase, bets: [{ type: 'red', amount: '10' }] });
    expect(wallet.reserve).not.toHaveBeenCalled();
    expect(res.replayed).toBe(true);
    expect(res.payout).toBe('40');
  });
});

describe('Crash money — reserve + hidden crash point', () => {
  it('reserves the stake and returns a RUNNING round WITHOUT revealing the crash point', async () => {
    const { bridge, wallet } = makeBridge();
    const res = await bridge.playCrash(cbase);
    expect(wallet.reserve).toHaveBeenCalledTimes(1);
    expect(wallet.commitReservation).not.toHaveBeenCalled(); // no settlement at play
    expect(res.running).toBe(true);
    expect(res.status).toBe(GameRoundStatus.RESERVED);
    expect(res.crashPoint).toBeNull(); // hidden while running
    expect(res.provablyFair.serverSeed).toBe(''); // server seed not revealed
    expect(res.serverSeedHash).toBe('hash'); // commitment IS revealed
  });

  it('rejects an auto cash-out at or below the floor before reserving', async () => {
    const { bridge, wallet } = makeBridge();
    await expect(bridge.playCrash({ ...cbase, autoCashout: 0.5 })).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.reserve).not.toHaveBeenCalled();
  });
});
