import { BadRequestException } from '@nestjs/common';
import { GameRoundStatus } from '@prisma/client';

import { GameMoneyBridgeService } from './game-money-bridge.service';

/**
 * Phase 2C.7 — Card games (Dragon Tiger · Andar Bahar · Teen Patti) money orchestration. One generic
 * `playCard` method over the authoritative card-engine presets. Unit tests mock the wallet/prisma and
 * the card engine to prove: the total stake is reserved once, the engine's authoritative
 * `settlement.totalWin` is committed once, bet keys are validated against the resolved ruleset BEFORE
 * reserving, and only the approved P0 variants are enabled — WITHOUT re-implementing dealing/settlement.
 */

const CURRENCY = { id: 'cur-inr', code: 'INR', decimals: 2, isActive: true };
const RULESETS: Record<string, { key: string; name: string; betLimits: { min: number; max: number }; bets: Array<{ key: string; label: string; payout: number }>; sides: string[]; tieRule: string }> = {
  'dragon-tiger': { key: 'dragon-tiger', name: 'Dragon Tiger', betLimits: { min: 1, max: 10000 }, sides: ['dragon', 'tiger'], tieRule: 'tie-bet', bets: [{ key: 'dragon', label: 'Dragon', payout: 2 }, { key: 'tiger', label: 'Tiger', payout: 2 }, { key: 'tie', label: 'Tie', payout: 9 }] },
  'andar-bahar': { key: 'andar-bahar', name: 'Andar Bahar', betLimits: { min: 1, max: 10000 }, sides: ['andar', 'bahar'], tieRule: 'push', bets: [{ key: 'andar', label: 'Andar', payout: 1.97 }, { key: 'bahar', label: 'Bahar', payout: 2 }] },
  'teen-patti': { key: 'teen-patti', name: 'Teen Patti', betLimits: { min: 1, max: 10000 }, sides: ['player', 'dealer'], tieRule: 'push', bets: [{ key: 'player', label: 'Player', payout: 2 }, { key: 'dealer', label: 'Dealer', payout: 2 }] },
};

function makeBridge(over: { existingRound?: unknown; reserve?: jest.Mock; deal?: unknown } = {}) {
  const round: Record<string, unknown> = { id: 'r1', userId: 'u1', gameKey: '', variant: '', betType: '', currencyId: 'cur-inr', stake: '0', payout: '0', status: GameRoundStatus.CREATED, betTransactionId: null, reservationId: null, actionSeq: 0, result: null, fairness: null };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', status: 'ACTIVE', deletedAt: null }) },
    currency: { findUnique: jest.fn().mockResolvedValue(CURRENCY) },
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
  const fair = { createCommit: jest.fn().mockReturnValue({ serverSeed: 's', serverSeedHash: 'h', nonce: 0 }), deriveSeed: jest.fn().mockReturnValue('seed'), hash: jest.fn(), verify: jest.fn() };
  const defaultDeal = { result: { hands: { dragon: ['KS'], tiger: ['2H'] }, winners: ['dragon'], winningBets: ['dragon'], isTie: false, settlement: { bets: [], totalBet: '10', totalWin: '20', net: '10' }, details: {} }, fairness: { serverSeed: 's', serverSeedHash: 'h', clientSeed: 'c', nonce: 0, seed: 'seed' } };
  const card = { play: jest.fn().mockResolvedValue(over.deal ?? defaultDeal) };
  const cardVariants = { resolve: jest.fn().mockImplementation((key: string) => Promise.resolve(RULESETS[key])) };
  const bridge = new GameMoneyBridgeService(
    prisma as never, wallet as never, noop as never, noop as never,
    noop as never, noop as never, noop as never, noop as never, fair as never,
    card as never, cardVariants as never,
  );
  return { bridge, prisma, wallet, card, cardVariants, round };
}

describe('Card money — generic single-shot over the authoritative card engine', () => {
  it('reserves the TOTAL stake once and commits the engine settlement.totalWin once', async () => {
    const { bridge, wallet, card } = makeBridge();
    const res = await bridge.playCard({ userId: 'u1', variant: 'dragon-tiger', bets: [{ type: 'dragon', amount: '10' }], currencyCode: 'INR', idempotencyKey: 'k1' });
    expect(card.play).toHaveBeenCalledWith('dragon-tiger', [{ key: 'dragon', amount: '10' }], undefined);
    expect(wallet.reserve).toHaveBeenCalledTimes(1);
    expect(wallet.reserve).toHaveBeenCalledWith('u1', 'cur-inr', '10.00', expect.any(String), expect.any(String));
    expect(wallet.commitReservation).toHaveBeenCalledWith('res-1', '20', expect.any(String), expect.any(String));
    expect(res.status).toBe(GameRoundStatus.SETTLED);
    expect(res.payout).toBe('20');
    expect(res.winningBets).toEqual(['dragon']);
  });

  it('sums multiple bets into the total reserved stake', async () => {
    const { bridge, wallet } = makeBridge();
    await bridge.playCard({ userId: 'u1', variant: 'dragon-tiger', bets: [{ type: 'dragon', amount: '10' }, { type: 'tie', amount: '5' }], currencyCode: 'INR', idempotencyKey: 'k2' });
    expect(wallet.reserve).toHaveBeenCalledWith('u1', 'cur-inr', '15.00', expect.any(String), expect.any(String));
  });

  it('works for every approved variant (andar-bahar, teen-patti)', async () => {
    for (const [variant, bet] of [['andar-bahar', 'andar'], ['teen-patti', 'player']] as const) {
      const { bridge, card } = makeBridge();
      await bridge.playCard({ userId: 'u1', variant, bets: [{ type: bet, amount: '10' }], currencyCode: 'INR', idempotencyKey: `k-${variant}` });
      expect(card.play).toHaveBeenCalledWith(variant, [{ key: bet, amount: '10' }], undefined);
    }
  });

  it('rejects an unsupported/out-of-scope variant before reserving', async () => {
    const { bridge, wallet } = makeBridge();
    for (const variant of ['baccarat', 'poker', 'texas-holdem', 'lucky-7']) {
      await expect(bridge.playCard({ userId: 'u1', variant, bets: [{ type: 'player', amount: '10' }], currencyCode: 'INR', idempotencyKey: 'k' })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(wallet.reserve).not.toHaveBeenCalled();
  });

  it('rejects an unknown bet key for the variant before reserving', async () => {
    const { bridge, wallet } = makeBridge();
    await expect(bridge.playCard({ userId: 'u1', variant: 'dragon-tiger', bets: [{ type: 'banker', amount: '10' }], currencyCode: 'INR', idempotencyKey: 'k' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(bridge.playCard({ userId: 'u1', variant: 'andar-bahar', bets: [{ type: 'tie', amount: '10' }], currencyCode: 'INR', idempotencyKey: 'k' })).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.reserve).not.toHaveBeenCalled();
  });

  it('rejects empty bets and maps an overdraft to insufficient balance', async () => {
    const { bridge } = makeBridge();
    await expect(bridge.playCard({ userId: 'u1', variant: 'dragon-tiger', bets: [], currencyCode: 'INR', idempotencyKey: 'k' })).rejects.toBeInstanceOf(BadRequestException);
    const reserve = jest.fn().mockRejectedValue(new Error('Insufficient available balance to reserve'));
    const { bridge: b2, wallet } = makeBridge({ reserve });
    await expect(b2.playCard({ userId: 'u1', variant: 'dragon-tiger', bets: [{ type: 'dragon', amount: '10' }], currencyCode: 'INR', idempotencyKey: 'k' })).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.commitReservation).not.toHaveBeenCalled();
  });

  it('is idempotent — an existing round returns without a second reserve', async () => {
    const existing = { id: 'r1', userId: 'u1', variant: 'dragon-tiger', betType: 'dragon', currencyId: 'cur-inr', stake: '10', payout: '20', status: GameRoundStatus.SETTLED, betTransactionId: 'tx-1', reservationId: 'res-1', result: { winningBets: ['dragon'] }, fairness: {} };
    const { bridge, wallet } = makeBridge({ existingRound: existing });
    const res = await bridge.playCard({ userId: 'u1', variant: 'dragon-tiger', bets: [{ type: 'dragon', amount: '10' }], currencyCode: 'INR', idempotencyKey: 'dup' });
    expect(wallet.reserve).not.toHaveBeenCalled();
    expect(res.replayed).toBe(true);
    expect(res.roundId).toBe('r1');
  });
});
