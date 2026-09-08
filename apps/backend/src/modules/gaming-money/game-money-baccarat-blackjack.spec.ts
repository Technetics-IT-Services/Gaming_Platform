import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { GameRoundStatus } from '@prisma/client';
import { CARD_VARIANT_PRESETS, RuleResolver as CardRules } from '@gaming-platform/card-engine';

import { GameMoneyBridgeService } from './game-money-bridge.service';

/**
 * Phase 2C.4 — Baccarat + Blackjack money orchestration. Unit tests with mocked wallet/prisma but
 * the REAL frozen Card engine (deterministic from a fixed seed) prove: Baccarat multi-bet single
 * reservation + engine payout; Blackjack start reserves + deals with the hole card hidden; STAND
 * settles exactly once; wrong-user rejected; action-after-settlement is idempotent. Live financial
 * invariants (hit/double/win/loss/push, concurrency, recovery) are proven against Postgres.
 */

const CURRENCY = { id: 'cur-inr', code: 'INR', decimals: 2, isActive: true };
const BACCARAT_RULESET = CardRules.resolve(CARD_VARIANT_PRESETS['baccarat']!);
const BLACKJACK_RULESET = CardRules.resolve(CARD_VARIANT_PRESETS['blackjack']!);

function baccaratDeal(totalBet: string, totalWin: string, winningBets: string[]) {
  return {
    result: { roundId: 'r', variant: 'baccarat', mode: 'point-total', hands: { player: ['9H', 'KD'], banker: ['7C', '2S'] }, community: [], winners: ['player'], isTie: false, winningBets, pushBets: [], settlement: { bets: [], totalBet, totalWin, net: '0' }, details: {}, verification: { seed: 's' } },
    fairness: { serverSeed: 'ss', serverSeedHash: 'hash', clientSeed: 'cs', nonce: 1 },
  };
}

function makeBridge(over: { user?: unknown; currency?: unknown; existingRound?: unknown; reserve?: jest.Mock; commit?: jest.Mock; cardPlay?: jest.Mock; cardResolve?: jest.Mock } = {}) {
  const round: Record<string, unknown> = { id: 'round-1', userId: 'u1', gameKey: '', variant: '', betType: '', currencyId: 'cur-inr', stake: '10', payout: '0', status: GameRoundStatus.CREATED, betTransactionId: null, reservationId: null, actionSeq: 0, result: null, fairness: null };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(over.user === undefined ? { id: 'u1', status: 'ACTIVE', deletedAt: null } : over.user) },
    currency: { findUnique: jest.fn().mockResolvedValue(over.currency === undefined ? CURRENCY : over.currency) },
    gameRound: {
      findUnique: jest.fn().mockImplementation(({ where }: { where: { id?: string } }) => Promise.resolve(where.id ? (over.existingRound === undefined ? round : over.existingRound) : (over.existingRound ?? null))),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => { Object.assign(round, data); return Promise.resolve({ ...round }); }),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => { Object.assign(round, data); return Promise.resolve({ ...round }); }),
      updateMany: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => { Object.assign(round, data); return Promise.resolve({ count: 1 }); }),
    },
  };
  const wallet = {
    reserve: over.reserve ?? jest.fn().mockResolvedValue({ reservationId: 'res-1', wallet: {} }),
    commitReservation: over.commit ?? jest.fn().mockResolvedValue({ transactionId: 'tx-1', wallet: { available: '100', total: '100' } }),
    releaseReservation: jest.fn().mockResolvedValue({ transactionId: 'tx-r', wallet: { available: '100', total: '100' } }),
    getOrCreateWallet: jest.fn().mockResolvedValue({ available: '100', total: '100' }),
  };
  const noop = { play: jest.fn(), resolve: jest.fn() };
  const card = { play: over.cardPlay ?? jest.fn().mockResolvedValue(baccaratDeal('80', '100', ['player'])) };
  const cardVariants = { resolve: over.cardResolve ?? jest.fn().mockImplementation((k: string) => Promise.resolve(k === 'blackjack' ? BLACKJACK_RULESET : BACCARAT_RULESET)) };
  const fair = { createCommit: jest.fn().mockReturnValue({ serverSeed: 'server-seed-abc', serverSeedHash: 'hash-abc', nonce: 0 }), deriveSeed: jest.fn().mockReturnValue('deadbeefdeadbeefdeadbeefdeadbeef'), hash: jest.fn(), verify: jest.fn() };
  const bridge = new GameMoneyBridgeService(
    prisma as never, wallet as never, noop as never, noop as never,
    noop as never, noop as never, noop as never, noop as never, fair as never,
    card as never, cardVariants as never,
  );
  return { bridge, prisma, wallet, round };
}

describe('Baccarat money — single reservation, engine-authoritative payout', () => {
  it('reserves the TOTAL stake ONCE and settles ONCE with the engine payout', async () => {
    const { bridge, wallet } = makeBridge();
    const res = await bridge.playBaccarat({ userId: 'u1', currencyCode: 'INR', idempotencyKey: 'idem-bacc-1', bets: [{ type: 'player', amount: '50' }, { type: 'banker', amount: '20' }, { type: 'tie', amount: '10' }] });
    expect(wallet.reserve).toHaveBeenCalledTimes(1);
    expect(wallet.reserve.mock.calls[0][2]).toBe('80.00'); // one reservation of the total
    expect(wallet.commitReservation).toHaveBeenCalledTimes(1);
    expect(wallet.commitReservation.mock.calls[0][1]).toBe('100'); // payout from engine
    expect(res.payout).toBe('100');
    expect(res.status).toBe(GameRoundStatus.SETTLED);
  });

  it('rejects an unknown bet type before reserving', async () => {
    const { bridge, wallet } = makeBridge();
    await expect(bridge.playBaccarat({ userId: 'u1', currencyCode: 'INR', idempotencyKey: 'k', bets: [{ type: 'nonsense', amount: '10' }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.reserve).not.toHaveBeenCalled();
  });

  it('maps an overdraft on reserve to a clean insufficient-balance error', async () => {
    const reserve = jest.fn().mockRejectedValue(new Error('Insufficient available balance to reserve'));
    const { bridge, wallet } = makeBridge({ reserve });
    await expect(bridge.playBaccarat({ userId: 'u1', currencyCode: 'INR', idempotencyKey: 'k', bets: [{ type: 'player', amount: '10' }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.commitReservation).not.toHaveBeenCalled();
  });
});

describe('Blackjack money — interactive, one reservation per hand', () => {
  it('start reserves the stake and deals with the hole card + server seed hidden', async () => {
    const { bridge, wallet } = makeBridge();
    const res = await bridge.startBlackjack({ userId: 'u1', stake: '10', currencyCode: 'INR', idempotencyKey: 'idem-bj-1' });
    expect(wallet.reserve).toHaveBeenCalledTimes(1);
    expect(wallet.commitReservation).not.toHaveBeenCalled(); // no settlement at start
    expect(res.active).toBe(true);
    expect(res.status).toBe(GameRoundStatus.RESERVED);
    expect(res.player.length).toBe(2); // opening two cards
    expect(res.dealer.length).toBe(1); // only the dealer up-card
    expect(res.dealerUpOnly).toBe(true);
    expect(res.legalActions).toContain('HIT');
    expect(res.legalActions).toContain('DOUBLE');
    expect(res.provablyFair.serverSeed).toBe(''); // hidden while active
    expect(res.provablyFair.serverSeedHash).toBe('hash-abc'); // commitment revealed
  });

  it('STAND resolves the dealer and settles exactly once (dealer + seed revealed)', async () => {
    const { bridge, wallet } = makeBridge();
    const start = await bridge.startBlackjack({ userId: 'u1', stake: '10', currencyCode: 'INR', idempotencyKey: 'idem-bj-2' });
    const res = await bridge.blackjackAction({ userId: 'u1', roundId: start.roundId, action: 'STAND' });
    expect(wallet.commitReservation).toHaveBeenCalledTimes(1); // settled once
    expect(res.active).toBe(false);
    expect(res.status).toBe(GameRoundStatus.SETTLED);
    expect(res.dealer.length).toBeGreaterThanOrEqual(2); // full dealer hand revealed
    expect(res.provablyFair.serverSeed).toBe('server-seed-abc'); // revealed at settlement
    expect(['player', 'dealer', 'push']).toContain(res.winner);
  });

  it("rejects an action on another user's hand", async () => {
    const { bridge } = makeBridge();
    const start = await bridge.startBlackjack({ userId: 'u1', stake: '10', currencyCode: 'INR', idempotencyKey: 'idem-bj-3' });
    await expect(bridge.blackjackAction({ userId: 'someone-else', roundId: start.roundId, action: 'HIT' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an action after settlement returns the final state without a second settlement', async () => {
    const { bridge, wallet } = makeBridge();
    const start = await bridge.startBlackjack({ userId: 'u1', stake: '10', currencyCode: 'INR', idempotencyKey: 'idem-bj-4' });
    await bridge.blackjackAction({ userId: 'u1', roundId: start.roundId, action: 'STAND' });
    const commitsAfterStand = wallet.commitReservation.mock.calls.length;
    const again = await bridge.blackjackAction({ userId: 'u1', roundId: start.roundId, action: 'HIT' });
    expect(again.status).toBe(GameRoundStatus.SETTLED);
    expect(wallet.commitReservation.mock.calls.length).toBe(commitsAfterStand); // no new settlement
  });
});
