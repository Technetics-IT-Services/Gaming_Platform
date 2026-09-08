import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

import { apiClient } from './api-client';
import { buildBuyRequest, buyTicket, getCurrentDraw, getLotteryConfig, getMainWallet, getMyTickets, newIdempotencyKey, quickPick } from './lottery-money-api';
import { normalizeError } from '@/components/games/lottery-money/use-lottery-money';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.clearAllMocks());

/**
 * Phase 2C.3 — real-money Number-Lottery client. Verifies the request contract (server owns all
 * money + the draw + winning numbers), quick-pick generation, authoritative-balance parsing, error
 * normalization, and that this path has NO demo-wallet dependency.
 */

describe('buildBuyRequest', () => {
  it('sends only client-choosable fields + a fresh idempotency key', () => {
    const req = buildBuyRequest({ picks: [1, 2, 3, 4, 5, 6], currency: 'INR', drawId: 'd1' });
    expect(req).toMatchObject({ picks: [1, 2, 3, 4, 5, 6], currency: 'INR', drawId: 'd1' });
    expect(req.idempotencyKey).toBeTruthy();
    for (const forbidden of ['payout', 'prize', 'winningNumbers', 'balance', 'walletId', 'userId', 'ticketPrice']) {
      expect(req).not.toHaveProperty(forbidden);
    }
  });
  it('generates a unique idempotency key per purchase', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('quickPick', () => {
  it('generates the required count of distinct in-range numbers', () => {
    const qp = quickPick(49, 6);
    expect(qp).toHaveLength(6);
    expect(new Set(qp).size).toBe(6);
    expect(qp.every((n) => n >= 1 && n <= 49)).toBe(true);
    expect(qp).toEqual([...qp].sort((a, b) => a - b)); // sorted
  });
});

describe('api calls', () => {
  it('buyTicket posts the picks and returns the authoritative pending ticket', async () => {
    const payload = { ticketId: 't1', status: 'RESERVED', settled: false, picks: [1, 2, 3, 4, 5, 6], payout: '0', drawNumber: 5 };
    mockPost.mockResolvedValue({ data: { data: payload } });
    const req = buildBuyRequest({ picks: [1, 2, 3, 4, 5, 6], currency: 'INR' });
    const res = await buyTicket(req);
    expect(mockPost).toHaveBeenCalledWith('/games/lottery/buy', req);
    expect(res.status).toBe('RESERVED');
    expect(res.settled).toBe(false);
  });

  it('getCurrentDraw + getLotteryConfig + getMyTickets read the draw/config/history', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: { drawId: 'd1', drawNumber: 5, ticketPrice: '10', drawAt: '2026-08-20T00:00:00Z', serverSeedHash: 'h' } } });
    expect((await getCurrentDraw()).drawNumber).toBe(5);
    mockGet.mockResolvedValueOnce({ data: { data: { pool: 49, pick: 6, ticketPrice: '10', currency: 'INR', prizeTiers: { '6': 50000 } } } });
    expect((await getLotteryConfig()).pool).toBe(49);
    mockGet.mockResolvedValueOnce({ data: { data: [{ ticketId: 't1', status: 'SETTLED', settled: true, won: true, payout: '500' }] } });
    expect((await getMyTickets())[0]!.won).toBe(true);
  });

  it('getMainWallet extracts the MAIN wallet balance', async () => {
    mockGet.mockResolvedValue({ data: { data: [{ type: 'MAIN', available: '990', total: '990', currencyId: 'inr' }] } });
    expect(await getMainWallet()).toEqual({ available: '990', total: '990', currencyId: 'inr' });
  });
});

describe('normalizeError', () => {
  it('maps common failures to actionable messages', () => {
    expect(normalizeError({ response: { status: 401 } })).toMatch(/log in/i);
    expect(normalizeError({ response: { status: 400, data: { message: 'Insufficient balance' } } })).toMatch(/insufficient/i);
  });
});

describe('no demo-wallet dependency', () => {
  it('the money-lottery path does not import the demo wallet', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      resolve(here, 'lottery-money-api.ts'),
      resolve(here, '../components/games/lottery-money/use-lottery-money.ts'),
      resolve(here, '../components/games/lottery-money/LotteryMoneyBoard.tsx'),
    ];
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/demo-wallet|useDemoWallet/);
  });
});
