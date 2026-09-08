import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

import { apiClient } from './api-client';
import { buildCrashPlayRequest, cashoutCrash, getCrashConfig, getMainWallet, multiplierAt, newIdempotencyKey, playCrash } from './crash-money-api';
import { normalizeError } from '@/components/games/crash-money/use-crash-money';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.clearAllMocks());

/**
 * Phase 2C.2 — real-money Crash client. Verifies the request contract (server owns all money),
 * authoritative-balance parsing, the display-only multiplier curve, error normalization, and that
 * this path has NO demo-wallet dependency.
 */

describe('buildCrashPlayRequest', () => {
  it('sends only client-choosable fields + a fresh idempotency key', () => {
    const req = buildCrashPlayRequest({ variant: 'crash', stake: '10', currency: 'INR', autoCashout: 2 });
    expect(req).toMatchObject({ variant: 'crash', stake: '10', currency: 'INR', autoCashout: 2 });
    expect(req.idempotencyKey).toBeTruthy();
    for (const forbidden of ['payout', 'balance', 'result', 'crashPoint', 'walletId', 'userId']) {
      expect(req).not.toHaveProperty(forbidden);
    }
  });
  it('generates a unique idempotency key per play', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('multiplierAt (display-only curve)', () => {
  it('starts at the floor and rises monotonically with elapsed time', () => {
    expect(multiplierAt(0, 0.07, 1, 1000)).toBe(1);
    expect(multiplierAt(2000, 0.07, 1, 1000)).toBeGreaterThan(1);
    expect(multiplierAt(4000, 0.07, 1, 1000)).toBeGreaterThan(multiplierAt(2000, 0.07, 1, 1000));
  });
});

describe('api calls', () => {
  it('playCrash posts to the money bridge and returns the running round (no crash point)', async () => {
    const payload = { roundId: 'c1', running: true, status: 'RESERVED', crashPoint: null, payout: '0', balance: { available: '90', total: '90' }, provablyFair: { serverSeed: '' } };
    mockPost.mockResolvedValue({ data: { data: payload } });
    const res = await playCrash(buildCrashPlayRequest({ variant: 'crash', stake: '10', currency: 'INR' }));
    expect(mockPost).toHaveBeenCalledWith('/games/crash/play', expect.objectContaining({ variant: 'crash' }));
    expect(res.crashPoint).toBeNull();
    expect(res.balance.available).toBe('90');
  });

  it('cashoutCrash posts the roundId and returns the authoritative settled result', async () => {
    const payload = { roundId: 'c1', running: false, status: 'SETTLED', won: true, cashoutMultiplier: 1.8, crashPoint: 3.2, payout: '18', balance: { available: '108', total: '108' } };
    mockPost.mockResolvedValue({ data: { data: payload } });
    const res = await cashoutCrash('c1');
    expect(mockPost).toHaveBeenCalledWith('/games/crash/cashout', expect.objectContaining({ roundId: 'c1' }));
    expect(res.payout).toBe('18');
    expect(res.balance.available).toBe('108');
  });

  it('getMainWallet extracts the MAIN wallet balance', async () => {
    mockGet.mockResolvedValue({ data: { data: [{ type: 'BONUS', available: '5', total: '5', currencyId: 'c' }, { type: 'MAIN', available: '900', total: '900', currencyId: 'inr' }] } });
    expect(await getMainWallet()).toEqual({ available: '900', total: '900', currencyId: 'inr' });
  });

  it('getCrashConfig returns limits + curve params', async () => {
    mockGet.mockResolvedValue({ data: { data: { variant: 'crash', name: 'Crash', limits: { min: 1, max: 10000, tableMax: 50000 }, minMultiplier: 1, maxMultiplier: 1000, growthRatePerSecond: 0.07 } } });
    const cfg = await getCrashConfig();
    expect(cfg.growthRatePerSecond).toBe(0.07);
  });
});

describe('normalizeError', () => {
  it('maps common failures to actionable messages', () => {
    expect(normalizeError({ response: { status: 401 } })).toMatch(/log in/i);
    expect(normalizeError({ response: { status: 404 } })).toMatch(/cash out/i);
    expect(normalizeError({ response: { status: 400, data: { message: 'Insufficient balance' } } })).toMatch(/insufficient/i);
  });
});

describe('no demo-wallet dependency', () => {
  it('the money-crash path does not import the demo wallet', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      resolve(here, 'crash-money-api.ts'),
      resolve(here, '../components/games/crash-money/use-crash-money.ts'),
      resolve(here, '../components/games/crash-money/CrashMoneyBoard.tsx'),
    ];
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/demo-wallet|useDemoWallet/);
  });
});
