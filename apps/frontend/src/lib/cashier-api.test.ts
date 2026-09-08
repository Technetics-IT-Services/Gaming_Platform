import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

import { apiClient } from './api-client';
import { buildCashierRequest, cancelWithdrawal, createDeposit, createWithdrawal, getCashierConfig, getMainWallet, newIdempotencyKey } from './cashier-api';
import { normalizeError } from '@/components/wallet/cashier/use-cashier';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;
afterEach(() => vi.clearAllMocks());

/**
 * Phase 2C.9 — cashier client contract. The client sends ONLY amount/currency/method + idempotencyKey;
 * balance/status/netAmount/transactionId/approval are server-derived. No demo-wallet on money surfaces.
 */

describe('buildCashierRequest', () => {
  it('sends only amount/currency/method + a fresh idempotency key (no server-owned fields)', () => {
    const req = buildCashierRequest('500', 'INR') as Record<string, unknown>;
    expect(req).toMatchObject({ amount: '500', currency: 'INR' });
    expect(req.idempotencyKey).toBeTruthy();
    for (const forbidden of ['balance', 'status', 'netAmount', 'transactionId', 'walletId', 'userId', 'approved', 'completedAmount']) {
      expect(req).not.toHaveProperty(forbidden);
    }
  });
  it('generates a unique idempotency key per request', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('api calls', () => {
  it('createDeposit posts to /cashier/deposits and returns a PENDING request', async () => {
    mockPost.mockResolvedValue({ data: { data: { id: 'd1', kind: 'deposit', reference: 'dep_x', amount: '500', status: 'PENDING', transactionId: null } } });
    const res = await createDeposit(buildCashierRequest('500'));
    expect(mockPost).toHaveBeenCalledWith('/cashier/deposits', expect.objectContaining({ amount: '500', currency: 'INR' }));
    expect(res.status).toBe('PENDING');
  });
  it('createWithdrawal posts to /cashier/withdrawals and returns UNDER_REVIEW with balanceAfter', async () => {
    mockPost.mockResolvedValue({ data: { data: { id: 'w1', kind: 'withdrawal', reference: 'wd_x', amount: '200', status: 'UNDER_REVIEW', transactionId: 'tx', balanceAfter: '800' } } });
    const res = await createWithdrawal(buildCashierRequest('200'));
    expect(mockPost).toHaveBeenCalledWith('/cashier/withdrawals', expect.objectContaining({ amount: '200' }));
    expect(res.status).toBe('UNDER_REVIEW');
    expect(res.balanceAfter).toBe('800');
  });
  it('cancelWithdrawal posts the cancel route', async () => {
    mockPost.mockResolvedValue({ data: { data: { id: 'w1', status: 'CANCELLED' } } });
    const res = await cancelWithdrawal('w1');
    expect(mockPost).toHaveBeenCalledWith('/cashier/withdrawals/w1/cancel', {});
    expect(res.status).toBe('CANCELLED');
  });
  it('getCashierConfig + getMainWallet parse server data', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: { minDeposit: 10, maxDeposit: 100000, minWithdrawal: 100, maxWithdrawal: 50000, currencies: ['INR'], depositFeePct: 0, withdrawalFeePct: 0 } } });
    expect((await getCashierConfig()).minWithdrawal).toBe(100);
    mockGet.mockResolvedValueOnce({ data: { data: [{ type: 'MAIN', available: '900', total: '900', currencyId: 'inr' }] } });
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
  it('the cashier/wallet money surfaces do not import the demo wallet', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      resolve(here, 'cashier-api.ts'),
      resolve(here, '../components/wallet/cashier/use-cashier.ts'),
      resolve(here, '../components/wallet/cashier/CashierForm.tsx'),
      resolve(here, '../app/(dashboard)/deposit/page.tsx'),
      resolve(here, '../app/(dashboard)/withdraw/page.tsx'),
    ];
    // Match the actual dependency (hook / store import), not incidental prose in comments.
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/useDemoWallet|stores\/demo-wallet/);
  });
});
