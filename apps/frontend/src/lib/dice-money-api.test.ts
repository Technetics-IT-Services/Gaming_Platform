import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

import { apiClient } from './api-client';
import { buildPlayRequest, getDiceConfig, getMainWallet, newIdempotencyKey, playDice } from './dice-money-api';
import { normalizeError } from '@/components/games/dice-money/use-dice-money';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.clearAllMocks());

/**
 * Phase 2B — real-money Dice client. Verifies the request contract (server owns all money),
 * authoritative-balance parsing, error normalization, and that this path has NO demo-wallet
 * dependency.
 */

describe('buildPlayRequest', () => {
  it('sends only client-choosable fields + a fresh idempotency key', () => {
    const req = buildPlayRequest({ variant: 'sic-bo', betType: 'big', stake: '10', currency: 'INR' });
    expect(req).toMatchObject({ variant: 'sic-bo', betType: 'big', stake: '10', currency: 'INR' });
    expect(req.idempotencyKey).toBeTruthy();
    // The client must NEVER send these — the server derives them.
    for (const forbidden of ['payout', 'balance', 'result', 'walletId', 'ledgerId', 'userId']) {
      expect(req).not.toHaveProperty(forbidden);
    }
  });
  it('generates a unique idempotency key per play (safe repeated taps)', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('api calls', () => {
  it('playDice posts to the money bridge and returns the authoritative payload', async () => {
    const payload = { roundId: 'r1', payout: '20', balance: { available: '110', total: '110' }, result: { won: true, values: [4, 5, 6] } };
    mockPost.mockResolvedValue({ data: { data: payload } });
    const req = buildPlayRequest({ variant: 'sic-bo', betType: 'big', stake: '10', currency: 'INR' });
    const res = await playDice(req);
    expect(mockPost).toHaveBeenCalledWith('/games/dice/play', req);
    expect(res.balance.available).toBe('110'); // authoritative from server
    expect(res.payout).toBe('20');
  });

  it('getMainWallet extracts the MAIN wallet balance', async () => {
    mockGet.mockResolvedValue({ data: { data: [{ type: 'BONUS', available: '5', total: '5', currencyId: 'c' }, { type: 'MAIN', available: '910', total: '910', currencyId: 'inr' }] } });
    const w = await getMainWallet();
    expect(w).toEqual({ available: '910', total: '910', currencyId: 'inr' });
  });

  it('getDiceConfig returns limits + bets', async () => {
    mockGet.mockResolvedValue({ data: { data: { variant: 'sic-bo', name: 'Sic Bo', limits: { min: 1, max: 10000 }, bets: [{ key: 'big', label: 'Big', payout: 2 }] } } });
    const cfg = await getDiceConfig();
    expect(cfg.limits.max).toBe(10000);
    expect(cfg.bets[0]!.key).toBe('big');
  });
});

describe('normalizeError', () => {
  it('maps common failures to actionable messages', () => {
    expect(normalizeError({ response: { status: 401 } })).toMatch(/log in/i);
    expect(normalizeError({ response: { status: 400, data: { message: 'Insufficient balance' } } })).toMatch(/insufficient/i);
    expect(normalizeError({ code: 'ECONNABORTED' })).toMatch(/timeout/i);
    expect(normalizeError({ response: { status: 409 } })).toMatch(/in progress/i);
  });
});

describe('no demo-wallet dependency', () => {
  it('the money-dice path does not import the demo wallet', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      resolve(here, 'dice-money-api.ts'),
      resolve(here, '../components/games/dice-money/use-dice-money.ts'),
      resolve(here, '../components/games/dice-money/DiceMoneyBoard.tsx'),
    ];
    for (const f of files) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/demo-wallet|useDemoWallet/);
    }
  });
});
