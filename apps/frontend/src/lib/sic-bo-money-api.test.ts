import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

import { apiClient } from './api-client';
import { buildRollRequest, getSicBoConfig, getMainWallet, newIdempotencyKey, playSicBo, totalStake } from './sic-bo-money-api';
import { normalizeError } from '@/components/games/sic-bo-money/use-sic-bo-money';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.clearAllMocks());

/**
 * Phase 2C.3 — real-money Sic Bo client. Verifies the request contract (server owns all money),
 * one-roll-one-settlement stake totalling, authoritative-balance parsing, error normalization, and
 * that this path has NO demo-wallet dependency.
 */

describe('buildRollRequest', () => {
  it('sends only client-choosable fields + a fresh idempotency key', () => {
    const bets = [{ type: 'big', amount: '20' }, { type: 'total-10', amount: '10' }];
    const req = buildRollRequest({ variant: 'sic-bo', bets, currency: 'INR' });
    expect(req).toMatchObject({ variant: 'sic-bo', currency: 'INR', bets });
    expect(req.idempotencyKey).toBeTruthy();
    for (const forbidden of ['payout', 'dice', 'result', 'balance', 'walletId', 'userId']) {
      expect(req).not.toHaveProperty(forbidden);
    }
  });
  it('generates a unique idempotency key per roll', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('totalStake', () => {
  it('sums all placed bets (one reservation covers the whole roll)', () => {
    expect(totalStake([{ type: 'big', amount: '20' }, { type: 'small', amount: '20' }, { type: 'odd', amount: '10' }])).toBe(50);
  });
});

describe('api calls', () => {
  it('playSicBo posts all bets in one roll and returns the authoritative payload', async () => {
    const payload = { roundId: 'r1', dice: [3, 3, 4], total: 10, payout: '120', winningBets: ['big'], balance: { available: '160', total: '160' }, settlement: { bets: [], totalBet: '60', totalWin: '120', net: '60' } };
    mockPost.mockResolvedValue({ data: { data: payload } });
    const req = buildRollRequest({ variant: 'sic-bo', bets: [{ type: 'big', amount: '60' }], currency: 'INR' });
    const res = await playSicBo(req);
    expect(mockPost).toHaveBeenCalledWith('/games/sic-bo/play', req);
    expect(res.balance.available).toBe('160'); // authoritative from server
    expect(res.payout).toBe('120');
  });

  it('getMainWallet extracts the MAIN wallet balance', async () => {
    mockGet.mockResolvedValue({ data: { data: [{ type: 'MAIN', available: '500', total: '500', currencyId: 'inr' }] } });
    expect(await getMainWallet()).toEqual({ available: '500', total: '500', currencyId: 'inr' });
  });

  it('getSicBoConfig returns the full bet board + limits', async () => {
    mockGet.mockResolvedValue({ data: { data: { variant: 'sic-bo', name: 'Sic Bo', limits: { min: 1, max: 10000, tableMax: 50000 }, diceCount: 3, faces: 6, bets: [{ key: 'big', label: 'Big', category: 'range', payout: 2 }] } } });
    const cfg = await getSicBoConfig();
    expect(cfg.diceCount).toBe(3);
    expect(cfg.bets[0]!.key).toBe('big');
  });
});

describe('normalizeError', () => {
  it('maps common failures to actionable messages', () => {
    expect(normalizeError({ response: { status: 401 } })).toMatch(/log in/i);
    expect(normalizeError({ response: { status: 409 } })).toMatch(/in progress/i);
    expect(normalizeError({ response: { status: 400, data: { message: 'Insufficient balance' } } })).toMatch(/insufficient/i);
  });
});

describe('no demo-wallet dependency', () => {
  it('the money-sic-bo path does not import the demo wallet', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      resolve(here, 'sic-bo-money-api.ts'),
      resolve(here, '../components/games/sic-bo-money/use-sic-bo-money.ts'),
      resolve(here, '../components/games/sic-bo-money/SicBoMoneyBoard.tsx'),
    ];
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/demo-wallet|useDemoWallet/);
  });
});
