import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

import { apiClient } from './api-client';
import { buildInstantRequest, getInstantConfig, getMainWallet, newIdempotencyKey, playInstant } from './instant-money-api';
import { normalizeError } from '@/components/games/instant-money/use-instant-money';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.clearAllMocks());

/**
 * Phase 2C.7 — real-money instant-games client (Limbo · Coin Flip · Wheel). Verifies the request
 * contract (server owns outcome/multiplier/payout/balance), authoritative-balance parsing, error
 * normalization, and that this path has NO demo-wallet dependency.
 */

describe('buildInstantRequest', () => {
  it('limbo sends only target + stake/currency + a fresh idempotency key', () => {
    const req = buildInstantRequest({ game: 'limbo', target: 2 }, '10', 'INR') as Record<string, unknown>;
    expect(req).toMatchObject({ target: 2, stake: '10', currency: 'INR' });
    expect(req.idempotencyKey).toBeTruthy();
    for (const forbidden of ['payout', 'balance', 'result', 'multiplier', 'win', 'walletId', 'userId', 'serverSeed', 'side', 'risk']) {
      expect(req).not.toHaveProperty(forbidden);
    }
  });
  it('coin-flip sends only side; wheel sends only risk', () => {
    const coin = buildInstantRequest({ game: 'coin-flip', side: 'heads' }, '10', 'INR') as Record<string, unknown>;
    expect(coin).toMatchObject({ side: 'heads' });
    expect(coin).not.toHaveProperty('target');
    const wheel = buildInstantRequest({ game: 'wheel', risk: 'medium' }, '10', 'INR') as Record<string, unknown>;
    expect(wheel).toMatchObject({ risk: 'medium' });
    expect(wheel).not.toHaveProperty('side');
  });
  it('generates a unique idempotency key per play', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('api calls', () => {
  it('playInstant posts to the correct per-game money bridge route and returns the authoritative result', async () => {
    const payload = { roundId: 'i1', game: 'limbo', betType: 'limbo:2.00', multiplier: 2, win: true, result: { generated: 3.1, target: 2 }, stake: '10', payout: '20', balance: { available: '110', total: '110' }, replayed: false };
    mockPost.mockResolvedValue({ data: { data: payload } });
    const res = await playInstant('limbo', buildInstantRequest({ game: 'limbo', target: 2 }, '10', 'INR'));
    expect(mockPost).toHaveBeenCalledWith('/games/limbo/play', expect.objectContaining({ target: 2 }));
    expect(res.win).toBe(true);
    expect(res.payout).toBe('20');
    expect(res.balance.available).toBe('110');
  });

  it('getInstantConfig reads each game config route', async () => {
    mockGet.mockResolvedValue({ data: { data: { game: 'wheel', limits: { min: 1, max: 10000 }, risks: ['low', 'medium', 'high'], segments: { low: [1.2], medium: [3], high: [10] } } } });
    const cfg = await getInstantConfig('wheel');
    expect(mockGet).toHaveBeenCalledWith('/games/wheel/config');
    expect((cfg as { risks: string[] }).risks).toContain('high');
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
  it('the money-instant path does not import the demo wallet', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      resolve(here, 'instant-money-api.ts'),
      resolve(here, '../components/games/instant-money/use-instant-money.ts'),
      resolve(here, '../components/games/instant-money/LimboMoneyBoard.tsx'),
      resolve(here, '../components/games/instant-money/CoinFlipMoneyBoard.tsx'),
      resolve(here, '../components/games/instant-money/WheelMoneyBoard.tsx'),
    ];
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/demo-wallet|useDemoWallet/);
  });
});
