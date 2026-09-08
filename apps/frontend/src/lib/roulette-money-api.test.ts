import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

import { apiClient } from './api-client';
import { buildSpinRequest, getMainWallet, getRouletteConfig, newIdempotencyKey, playRoulette, totalStake } from './roulette-money-api';
import { normalizeError } from '@/components/games/roulette-money/use-roulette-money';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.clearAllMocks());

/**
 * Phase 2C.2 — real-money Roulette client. Verifies the request contract (server owns all money),
 * one-spin-one-settlement stake totalling, authoritative-balance parsing, error normalization, and
 * that this path has NO demo-wallet dependency.
 */

describe('buildSpinRequest', () => {
  it('sends only client-choosable fields + a fresh idempotency key', () => {
    const bets = [{ type: 'red', amount: '10' }, { type: 'straight', amount: '5', selection: [7] }];
    const req = buildSpinRequest({ variant: 'european', bets, currency: 'INR' });
    expect(req).toMatchObject({ variant: 'european', currency: 'INR', bets });
    expect(req.idempotencyKey).toBeTruthy();
    for (const forbidden of ['payout', 'result', 'pocket', 'balance', 'walletId', 'userId']) {
      expect(req).not.toHaveProperty(forbidden);
    }
  });
  it('generates a unique idempotency key per spin', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('totalStake', () => {
  it('sums all placed bets (one reservation covers the whole spin)', () => {
    expect(totalStake([{ type: 'red', amount: '10' }, { type: 'straight', amount: '5', selection: [7] }, { type: 'even', amount: '2.5' }])).toBe(17.5);
  });
});

describe('api calls', () => {
  it('playRoulette posts all bets in one spin and returns the authoritative payload', async () => {
    const payload = { roundId: 'r1', pocket: 7, color: 'red', payout: '20', winningBets: ['red'], balance: { available: '120', total: '120' }, settlement: { bets: [], totalBet: '10', totalWin: '20', net: '10' } };
    mockPost.mockResolvedValue({ data: { data: payload } });
    const req = buildSpinRequest({ variant: 'european', bets: [{ type: 'red', amount: '10' }], currency: 'INR' });
    const res = await playRoulette(req);
    expect(mockPost).toHaveBeenCalledWith('/games/roulette/play', req);
    expect(res.balance.available).toBe('120'); // authoritative from server
    expect(res.payout).toBe('20');
  });

  it('getMainWallet extracts the MAIN wallet balance', async () => {
    mockGet.mockResolvedValue({ data: { data: [{ type: 'MAIN', available: '500', total: '500', currencyId: 'inr' }] } });
    expect(await getMainWallet()).toEqual({ available: '500', total: '500', currencyId: 'inr' });
  });

  it('getRouletteConfig returns the bet board + limits', async () => {
    mockGet.mockResolvedValue({ data: { data: { variant: 'european', name: 'European', limits: { min: 1, max: 10000, tableMax: 50000 }, maxNumber: 36, greenPockets: [0], redNumbers: [1, 3], betTypes: [{ key: 'red', label: 'Red', category: 'outside', payout: 2, selectionSize: null }] } } });
    const cfg = await getRouletteConfig();
    expect(cfg.maxNumber).toBe(36);
    expect(cfg.betTypes[0]!.key).toBe('red');
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
  it('the money-roulette path does not import the demo wallet', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      resolve(here, 'roulette-money-api.ts'),
      resolve(here, '../components/games/roulette-money/use-roulette-money.ts'),
      resolve(here, '../components/games/roulette-money/RouletteMoneyBoard.tsx'),
    ];
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/demo-wallet|useDemoWallet/);
  });
});
