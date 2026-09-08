import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', async () => {
  const actual = await vi.importActual<typeof import('./api-client')>('./api-client');
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn() } };
});

import { apiClient } from './api-client';
import { walletApi } from './wallet-api';
import { normalizeError } from '@/components/history/use-wallet-history';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.clearAllMocks());

/**
 * Phase 2C.4 — server-authoritative wallet history client. Verifies the request contract (userId is
 * never sent; filters + pagination map to the query string), authoritative (stored) balance parsing,
 * error normalization, and that the new wallet-history path has NO demo-wallet dependency.
 */

describe('walletApi.history', () => {
  it('GETs /wallet/history with the filters + pagination as query params (no userId sent)', async () => {
    const page = { items: [{ id: 't1', type: 'BET', status: 'COMPLETED', amount: '10', fee: '0', balanceBefore: '100', balanceAfter: '90', currency: 'INR', reference: 'round:r1:bet', description: null, metadata: null, createdAt: '2026-08-20T00:00:00Z' }], total: 1, page: 1, limit: 20, pages: 1 };
    mockGet.mockResolvedValue({ data: { data: page } });
    const res = await walletApi.history({ page: 2, limit: 20, type: 'BET', currency: 'INR', from: '2026-08-01T00:00:00.000Z', to: '2026-08-20T23:59:59.999Z' });
    const url = mockGet.mock.calls[0][0] as string;
    expect(url).toContain('/wallet/history?');
    expect(url).toContain('page=2');
    expect(url).toContain('type=BET');
    expect(url).toContain('currency=INR');
    expect(url).toContain('from=');
    expect(url).not.toContain('userId'); // identity is server-derived
    expect(res.items[0]!.balanceBefore).toBe('100'); // stored, authoritative
    expect(res.items[0]!.balanceAfter).toBe('90');
  });

  it('omits empty filters from the query string', async () => {
    mockGet.mockResolvedValue({ data: { data: { items: [], total: 0, page: 1, limit: 20, pages: 0 } } });
    await walletApi.history({ page: 1 });
    const url = mockGet.mock.calls[0][0] as string;
    expect(url).not.toContain('type=');
    expect(url).not.toContain('currency=');
  });
});

describe('normalizeError', () => {
  it('maps common failures to actionable messages', () => {
    expect(normalizeError({ response: { status: 401 } })).toMatch(/log in/i);
    expect(normalizeError({ code: 'ECONNABORTED' })).toMatch(/timeout/i);
  });
});

describe('no demo-wallet dependency', () => {
  it('the wallet-history path does not import the demo wallet', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      resolve(here, '../components/history/use-wallet-history.ts'),
      resolve(here, '../components/history/WalletHistoryList.tsx'),
      resolve(here, '../app/(dashboard)/wallet/history/page.tsx'),
    ];
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/demo-wallet|useDemoWallet|demoWallet/);
  });
});
