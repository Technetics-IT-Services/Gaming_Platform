import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

import { apiClient } from './api-client';
import { buildCardRequest, getCardConfig, getMainWallet, newIdempotencyKey, playCard } from './card-money-api';
import { normalizeError } from '@/components/games/card-money/use-card-money';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.clearAllMocks());

/**
 * Phase 2C.7 — real-money card-games client (Dragon Tiger · Andar Bahar · Teen Patti). Verifies the
 * request contract (server owns hands/winner/payout/balance), authoritative-balance parsing, error
 * normalization, and that this path has NO demo-wallet dependency.
 */

describe('buildCardRequest', () => {
  it('sends only bets + currency + a fresh idempotency key', () => {
    const req = buildCardRequest([{ type: 'dragon', amount: '10' }], 'INR') as Record<string, unknown>;
    expect(req).toMatchObject({ bets: [{ type: 'dragon', amount: '10' }], currency: 'INR' });
    expect(req.idempotencyKey).toBeTruthy();
    for (const forbidden of ['payout', 'balance', 'result', 'hands', 'winners', 'winningBets', 'walletId', 'userId', 'serverSeed', 'variant']) {
      expect(req).not.toHaveProperty(forbidden);
    }
  });
  it('generates a unique idempotency key per play', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('api calls', () => {
  it('playCard posts to the correct per-variant money bridge route and returns the authoritative result', async () => {
    const payload = { roundId: 'c1', game: 'dragon-tiger', variant: 'dragon-tiger', stake: '10', hands: { dragon: ['KS'], tiger: ['2H'] }, winners: ['dragon'], winningBets: ['dragon'], isTie: false, bets: [{ type: 'dragon', amount: '10' }], settlement: { bets: [], totalBet: '10', totalWin: '20', net: '10' }, payout: '20', balance: { available: '110', total: '110' }, replayed: false };
    mockPost.mockResolvedValue({ data: { data: payload } });
    const res = await playCard('dragon-tiger', buildCardRequest([{ type: 'dragon', amount: '10' }], 'INR'));
    expect(mockPost).toHaveBeenCalledWith('/games/dragon-tiger/play', expect.objectContaining({ bets: [{ type: 'dragon', amount: '10' }] }));
    expect(res.winningBets).toEqual(['dragon']);
    expect(res.payout).toBe('20');
    expect(res.balance.available).toBe('110');
  });

  it('getCardConfig reads each variant config route and returns the bet menu', async () => {
    mockGet.mockResolvedValue({ data: { data: { variant: 'dragon-tiger', name: 'Dragon Tiger', limits: { min: 1, max: 10000 }, sides: ['dragon', 'tiger'], tieRule: 'tie-bet', bets: [{ key: 'dragon', label: 'Dragon', payout: 2 }, { key: 'tie', label: 'Tie', payout: 9 }] } } });
    const cfg = await getCardConfig('dragon-tiger');
    expect(mockGet).toHaveBeenCalledWith('/games/dragon-tiger/config');
    expect(cfg.bets.map((b) => b.key)).toEqual(['dragon', 'tie']);
  });

  it('getMainWallet extracts the MAIN wallet balance', async () => {
    mockGet.mockResolvedValue({ data: { data: [{ type: 'BONUS', available: '5', total: '5', currencyId: 'c' }, { type: 'MAIN', available: '900', total: '900', currencyId: 'inr' }] } });
    expect(await getMainWallet()).toEqual({ available: '900', total: '900', currencyId: 'inr' });
  });
});

describe('normalizeError', () => {
  it('maps common failures to actionable messages', () => {
    expect(normalizeError({ response: { status: 401 } })).toMatch(/log in/i);
    expect(normalizeError({ response: { status: 400, data: { message: 'Insufficient balance' } } })).toMatch(/insufficient/i);
  });
});

describe('no demo-wallet dependency', () => {
  it('the money-card path does not import the demo wallet', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      resolve(here, 'card-money-api.ts'),
      resolve(here, '../components/games/card-money/use-card-money.ts'),
      resolve(here, '../components/games/card-money/CardMoneyBoard.tsx'),
    ];
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/demo-wallet|useDemoWallet/);
  });
});
