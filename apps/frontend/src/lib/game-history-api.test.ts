import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', async () => {
  const actual = await vi.importActual<typeof import('./api-client')>('./api-client');
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn() } };
});

import { apiClient } from './api-client';
import { gameHistoryApi } from './game-history-api';
import { normalizeError } from '@/components/history/use-game-history';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.clearAllMocks());

/**
 * Phase 2C.4 — server-authoritative game-history + traceability client. Verifies the request
 * contract (no userId sent; filters map to the query string), the round-detail bundle shape,
 * error normalization (403/404), and that the path has NO demo-wallet dependency.
 */

describe('gameHistoryApi.list', () => {
  it('GETs /games/history with filters + pagination (no userId sent)', async () => {
    const page = { items: [{ roundId: 'r1', gameKey: 'dice', betType: 'big', stake: '10', payout: '20', netResult: '10', status: 'SETTLED', createdAt: '2026-08-20T00:00:00Z', settledAt: '2026-08-20T00:00:01Z', reference: 'tx1' }], total: 1, page: 1, limit: 20, pages: 1 };
    mockGet.mockResolvedValue({ data: { data: page } });
    const res = await gameHistoryApi.list({ page: 1, gameKey: 'dice', status: 'SETTLED', from: '2026-08-01T00:00:00.000Z' });
    const url = mockGet.mock.calls[0][0] as string;
    expect(url).toContain('/games/history?');
    expect(url).toContain('gameKey=dice');
    expect(url).toContain('status=SETTLED');
    expect(url).not.toContain('userId');
    expect(res.items[0]!.netResult).toBe('10'); // server-computed
  });
});

describe('gameHistoryApi.round', () => {
  it('GETs /games/history/:roundId and returns the traceability bundle', async () => {
    const details = {
      round: { id: 'r1', gameKey: 'dice', variant: 'sic-bo', betType: 'big', stake: '10', payout: '20', netResult: '10', status: 'SETTLED', idempotencyKey: 'k', result: {}, fairness: { serverSeedHash: 'h' }, createdAt: 'x', settledAt: 'y', reference: 'tx1' },
      reservation: { id: 'res1', amount: '10', status: 'CONSUMED', reason: 'round:r1', createdAt: 'x', releasedAt: null },
      settlement: { id: 'tx1', type: 'BET', status: 'COMPLETED', amount: '10', fee: '0', balanceBefore: '100', balanceAfter: '110', currency: 'INR', reference: 'round:r1:bet', description: null, createdAt: 'x' },
      walletTransactions: [], ledger: [{ id: 'l1', reference: 'round:r1', status: 'POSTED', postedAt: 'x', entries: [{ id: 'e1', direction: 'DEBIT', amount: '10', balanceAfter: '90', status: 'POSTED' }] }],
    };
    mockGet.mockResolvedValue({ data: { data: details } });
    const res = await gameHistoryApi.round('r1');
    expect(mockGet).toHaveBeenCalledWith('/games/history/r1');
    expect(res.round.netResult).toBe('10');
    expect(res.reservation!.id).toBe('res1');
    expect(res.ledger[0]!.entries[0]!.direction).toBe('DEBIT');
  });
});

describe('normalizeError', () => {
  it('maps ownership/not-found failures to actionable messages', () => {
    expect(normalizeError({ response: { status: 403 } })).toMatch(/access/i);
    expect(normalizeError({ response: { status: 404 } })).toMatch(/not found/i);
  });
});

describe('no demo-wallet dependency', () => {
  it('the game-history path does not import the demo wallet', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      resolve(here, 'game-history-api.ts'),
      resolve(here, '../components/history/use-game-history.ts'),
      resolve(here, '../components/history/GameHistoryList.tsx'),
      resolve(here, '../components/history/RoundDetail.tsx'),
      resolve(here, '../app/(dashboard)/game-history/page.tsx'),
    ];
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/demo-wallet|useDemoWallet|demoWallet/);
  });
});
