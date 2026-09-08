import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

import { apiClient } from './api-client';
import { buildPlinkoRequest, getMainWallet, getPlinkoConfig, newIdempotencyKey, playPlinko } from './plinko-money-api';
import { normalizeError } from '@/components/games/plinko-money/use-plinko-money';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.clearAllMocks());

/**
 * Phase 2C.6 — real-money Plinko client. Verifies the request contract (server owns bin/multiplier/
 * payout/balance), authoritative-balance parsing, error normalization, and that this path has NO
 * demo-wallet dependency.
 */

describe('buildPlinkoRequest', () => {
  it('sends only client-choosable fields + a fresh idempotency key', () => {
    const req = buildPlinkoRequest({ rows: 16, risk: 'medium', stake: '10', currency: 'INR' });
    expect(req).toMatchObject({ rows: 16, risk: 'medium', stake: '10', currency: 'INR' });
    expect(req.idempotencyKey).toBeTruthy();
    for (const forbidden of ['payout', 'balance', 'result', 'bin', 'multiplier', 'walletId', 'userId', 'serverSeed']) {
      expect(req).not.toHaveProperty(forbidden);
    }
  });
  it('generates a unique idempotency key per drop', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('api calls', () => {
  it('playPlinko posts to the money bridge and returns the authoritative result', async () => {
    const payload = { roundId: 'p1', rows: 16, risk: 'medium', bin: 8, multiplier: 1.4, stake: '10', payout: '14', balance: { available: '104', total: '104' }, replayed: false };
    mockPost.mockResolvedValue({ data: { data: payload } });
    const res = await playPlinko(buildPlinkoRequest({ rows: 16, risk: 'medium', stake: '10', currency: 'INR' }));
    expect(mockPost).toHaveBeenCalledWith('/games/plinko/play', expect.objectContaining({ rows: 16, risk: 'medium' }));
    expect(res.bin).toBe(8);
    expect(res.payout).toBe('14');
    expect(res.balance.available).toBe('104');
  });

  it('getMainWallet extracts the MAIN wallet balance', async () => {
    mockGet.mockResolvedValue({ data: { data: [{ type: 'BONUS', available: '5', total: '5', currencyId: 'c' }, { type: 'MAIN', available: '900', total: '900', currencyId: 'inr' }] } });
    expect(await getMainWallet()).toEqual({ available: '900', total: '900', currencyId: 'inr' });
  });

  it('getPlinkoConfig returns rows/risks/limits + multiplier boards', async () => {
    mockGet.mockResolvedValue({ data: { data: { rows: [8, 10, 12, 14, 16], risks: ['low', 'medium', 'high'], limits: { min: 1, max: 10000 }, boards: [{ rows: 16, risk: 'medium', multipliers: [110, 0.2, 1.4] }] } } });
    const cfg = await getPlinkoConfig();
    expect(cfg.rows).toContain(16);
    expect(cfg.boards[0].multipliers.length).toBe(3);
  });
});

describe('normalizeError', () => {
  it('maps common failures to actionable messages', () => {
    expect(normalizeError({ response: { status: 401 } })).toMatch(/log in/i);
    expect(normalizeError({ response: { status: 400, data: { message: 'Insufficient balance' } } })).toMatch(/insufficient/i);
  });
});

describe('no demo-wallet dependency', () => {
  it('the money-plinko path does not import the demo wallet', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      resolve(here, 'plinko-money-api.ts'),
      resolve(here, '../components/games/plinko-money/use-plinko-money.ts'),
      resolve(here, '../components/games/plinko-money/PlinkoMoneyBoard.tsx'),
    ];
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/demo-wallet|useDemoWallet/);
  });
});
