import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

import { apiClient } from './api-client';
import { buildBaccaratRequest, getBaccaratConfig, getMainWallet, newIdempotencyKey, playBaccarat, totalStake } from './baccarat-money-api';
import { normalizeError } from '@/components/games/baccarat-money/use-baccarat-money';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.clearAllMocks());

/**
 * Phase 2C.4 — real-money Baccarat client. Verifies the request contract (server owns all money),
 * one-deal-one-settlement stake totalling, authoritative-balance parsing, error normalization, and
 * that this path has NO demo-wallet dependency.
 */

describe('buildBaccaratRequest', () => {
  it('sends only client-choosable fields + a fresh idempotency key', () => {
    const bets = [{ type: 'player', amount: '50' }, { type: 'banker', amount: '20' }];
    const req = buildBaccaratRequest({ bets, currency: 'INR' });
    expect(req).toMatchObject({ currency: 'INR', bets });
    expect(req.idempotencyKey).toBeTruthy();
    for (const forbidden of ['payout', 'result', 'cards', 'balance', 'walletId', 'userId', 'winningBet']) {
      expect(req).not.toHaveProperty(forbidden);
    }
  });
  it('generates a unique idempotency key per deal', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('totalStake', () => {
  it('sums all placed bets (one reservation covers the whole deal)', () => {
    expect(totalStake([{ type: 'player', amount: '50' }, { type: 'banker', amount: '20' }, { type: 'tie', amount: '10' }])).toBe(80);
  });
});

describe('api calls', () => {
  it('playBaccarat posts all bets in one deal and returns the authoritative payload', async () => {
    const payload = { roundId: 'r1', winners: ['player'], payout: '100', balance: { available: '220', total: '220' }, hands: { player: ['9H', 'KD'], banker: ['7C', '2S'] }, settlement: { bets: [], totalBet: '80', totalWin: '100', net: '20' } };
    mockPost.mockResolvedValue({ data: { data: payload } });
    const req = buildBaccaratRequest({ bets: [{ type: 'player', amount: '80' }], currency: 'INR' });
    const res = await playBaccarat(req);
    expect(mockPost).toHaveBeenCalledWith('/games/baccarat/play', req);
    expect(res.balance.available).toBe('220'); // authoritative from server
    expect(res.payout).toBe('100');
  });

  it('getMainWallet extracts the MAIN wallet balance', async () => {
    mockGet.mockResolvedValue({ data: { data: [{ type: 'MAIN', available: '500', total: '500', currencyId: 'inr' }] } });
    expect(await getMainWallet()).toEqual({ available: '500', total: '500', currencyId: 'inr' });
  });

  it('getBaccaratConfig returns the bet board + limits', async () => {
    mockGet.mockResolvedValue({ data: { data: { variant: 'baccarat', name: 'Baccarat', limits: { min: 1, max: 100000 }, bets: [{ key: 'player', label: 'Player', payout: 2 }] } } });
    const cfg = await getBaccaratConfig();
    expect(cfg.bets[0]!.key).toBe('player');
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
  it('the money-baccarat path does not import the demo wallet', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      resolve(here, 'baccarat-money-api.ts'),
      resolve(here, '../components/games/baccarat-money/use-baccarat-money.ts'),
      resolve(here, '../components/games/baccarat-money/BaccaratMoneyBoard.tsx'),
    ];
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/demo-wallet|useDemoWallet/);
  });
});
