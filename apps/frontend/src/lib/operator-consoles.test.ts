import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  unwrap: async (p: Promise<{ data: { data: unknown } }>) => (await p).data.data,
}));

import { adminUsersApi } from './admin-users-api';
import { apiClient } from './api-client';
import { cashierAdminApi } from './cashier-admin-api';
import { expensesApi } from './expenses-api';
import { financeOpsApi } from './finance-ops-api';
import { adminKycApi } from './kyc-api';

/**
 * Phase 2D.12 — the four operator consoles that closed the "guarded backend, no UI" gap.
 *
 * The audit found 11 operator surfaces (48 guarded routes) with no frontend at all. These tests
 * lock in the contracts AND the structural honesty of the screens built to reach them.
 */

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const post = apiClient.post as unknown as ReturnType<typeof vi.fn>;
const del = apiClient.delete as unknown as ReturnType<typeof vi.fn>;
const ok = (data: unknown) => Promise.resolve({ data: { data } });

beforeEach(() => { get.mockReset(); post.mockReset(); del.mockReset(); });
afterEach(() => vi.clearAllMocks());

const SRC = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ========================================================== CASHIER (P0) */

describe('cashier console — the operator deposit rail', () => {
  const PAGE = 'app/admin/cashier/page.tsx';

  it('reads the queue and acts through two SEPARATELY permissioned surfaces', async () => {
    get.mockReturnValueOnce(ok({ kind: 'deposits', statuses: [], items: [], note: '' }));
    await financeOpsApi.cashierQueue({ kind: 'deposits', limit: 100 });
    // Reading the queue is a finance read...
    expect(String(get.mock.calls[0][0])).toContain('/admin/finance/cashier/queue');

    post.mockReturnValueOnce(ok({}));
    await cashierAdminApi.completeDeposit('dep-1');
    // ...but acting on it is a wallet adjustment on a different controller.
    expect(post.mock.calls[0][0]).toBe('/admin/cashier/deposits/dep-1/complete');
  });

  it('NEVER sends an amount — the operator decides yes/no, not how much', async () => {
    post.mockReturnValue(ok({}));
    await cashierAdminApi.completeDeposit('d1');
    await cashierAdminApi.approveWithdrawal('w1');
    await cashierAdminApi.completeWithdrawal('w2');
    for (const call of post.mock.calls) {
      const body = (call[1] ?? {}) as Record<string, unknown>;
      for (const forbidden of ['amount', 'netAmount', 'currency', 'userId', 'status']) {
        expect(Object.keys(body)).not.toContain(forbidden);
      }
    }
  });

  it('a rejection carries only a reason', async () => {
    post.mockReturnValue(ok({}));
    await cashierAdminApi.rejectDeposit('d1', 'duplicate request');
    await cashierAdminApi.rejectWithdrawal('w1', 'failed checks');
    expect(post.mock.calls[0][1]).toEqual({ reason: 'duplicate request' });
    expect(post.mock.calls[1][1]).toEqual({ reason: 'failed checks' });
  });

  it('the page renders no amount INPUT anywhere', () => {
    const src = strip(read(PAGE));
    // The amount is displayed from the request; an editable amount would let an operator
    // credit a figure the player never asked for.
    expect(src).toContain('{item.amount}');
    expect(src).not.toMatch(/data-testid="cashier-amount(-input)?"/);
    expect(src).not.toMatch(/setForm\(\{[^}]*amount/);
  });

  it('gates actions on wallets:adjust and says the server decides', () => {
    const src = read(PAGE);
    expect(src).toContain("includes('wallets:adjust')");
    expect(src).toContain('isDemoSession');
    expect(src).toContain('The server refuses these actions from this account');
  });

  it('requires a reason before a rejection can be confirmed', () => {
    const src = read(PAGE);
    expect(src).toContain('rejecting.reason.trim().length < 3');
  });

  it('prints the server’s own description of what the action does', () => {
    expect(read(PAGE)).toContain('{d.note}');
  });

  it('has loading, error and empty states and a horizontal scroller', () => {
    const src = read(PAGE);
    for (const id of ['cashier-loading', 'cashier-error', 'cashier-empty', 'cashier-action-error']) {
      expect(src).toContain(id);
    }
    expect(src).toContain("overflowX: 'auto'");
    expect(src).toContain('minHeight: 44');
  });
});

/* ============================================================ KYC (AD-11) */

describe('KYC review console', () => {
  const PAGE = 'app/admin/kyc/page.tsx';

  it('lists and reviews through the guarded admin routes', async () => {
    get.mockReturnValueOnce(ok({ items: [], total: 0, page: 1, limit: 20 }));
    await adminKycApi.list({ status: 'PENDING', limit: 50 });
    expect(String(get.mock.calls[0][0])).toBe('/admin/kyc?status=PENDING&limit=50');

    post.mockReturnValueOnce(ok({}));
    await adminKycApi.review('k1', 'APPROVED');
    expect(post.mock.calls[0][0]).toBe('/admin/kyc/k1/review');
    // An approval carries no reason; the body must not invent one.
    expect(post.mock.calls[0][1]).toEqual({ decision: 'APPROVED' });
  });

  it('a rejection carries a reason', async () => {
    post.mockReturnValueOnce(ok({}));
    await adminKycApi.review('k1', 'REJECTED', 'document unreadable');
    expect(post.mock.calls[0][1]).toEqual({ decision: 'REJECTED', reason: 'document unreadable' });
  });

  it('states the document-storage gap instead of implying a reviewer saw an image', () => {
    const src = read(PAGE);
    expect(src).toContain('kyc-upload-unavailable');
    expect(src).toContain('Document images are not stored');
    expect(src).toContain('No document storage is configured');
  });

  it('invents no score, threshold or automatic decision', () => {
    const src = strip(read(PAGE));
    for (const forbidden of ['riskScore', 'autoApprove', 'threshold', 'confidence']) {
      expect(src).not.toContain(forbidden);
    }
  });

  it('gates on users:verify and has full states', () => {
    const src = read(PAGE);
    expect(src).toContain("includes('users:verify')");
    for (const id of ['kyc-loading', 'kyc-error', 'kyc-empty', 'kyc-action-error']) {
      expect(src).toContain(id);
    }
    expect(src).toContain('minHeight: 44');
  });
});

/* ========================================================== USERS (AD-02) */

describe('user administration console', () => {
  const PAGE = 'app/admin/users/page.tsx';

  it('addresses a role by ID, never by a client-supplied name', async () => {
    post.mockReturnValueOnce(ok({}));
    await adminUsersApi.assignRole('u1', 'role-uuid');
    expect(post.mock.calls[0][0]).toBe('/admin/users/u1/roles');
    expect(post.mock.calls[0][1]).toEqual({ roleId: 'role-uuid' });
  });

  it('lock / unlock / verify are DISTINCT endpoints, not a client-supplied status', async () => {
    post.mockReturnValue(ok({}));
    await adminUsersApi.lock('u1', 'abuse');
    await adminUsersApi.unlock('u1');
    await adminUsersApi.verifyEmail('u1');
    expect(post.mock.calls.map((c) => c[0])).toEqual([
      '/admin/users/u1/lock', '/admin/users/u1/unlock', '/admin/users/u1/verify',
    ]);
    for (const call of post.mock.calls) {
      expect(Object.keys((call[1] ?? {}) as object)).not.toContain('status');
    }
  });

  it('revoking sessions is a DELETE on the session collection', async () => {
    del.mockReturnValueOnce(ok({}));
    await adminUsersApi.revokeSessions('u1');
    expect(del.mock.calls[0][0]).toBe('/admin/users/u1/sessions');
  });

  it('honours each permission separately rather than one blanket admin level', () => {
    const src = read(PAGE);
    expect(src).toContain("has('users:lock')");
    expect(src).toContain("has('users:verify')");
  });

  it('explains why manual verification exists right now', () => {
    expect(read(PAGE)).toContain('No email provider is configured');
  });

  it('has full states and a scroller', () => {
    const src = read(PAGE);
    for (const id of ['users-loading', 'users-error', 'users-empty', 'users-action-error']) {
      expect(src).toContain(id);
    }
    expect(src).toContain("overflowX: 'auto'");
    expect(src).toContain('minHeight: 44');
  });
});

/* ======================================================== EXPENSES (F-03) */

describe('expenses console', () => {
  const PAGE = 'app/admin/expenses/page.tsx';

  it('sends the amount as a decimal STRING', async () => {
    post.mockReturnValueOnce(ok({ amount: '1250.00', currency: 'INR', status: 'DRAFT' }));
    await expensesApi.create({
      categoryId: 'c1', description: 'Ads', amount: '1250.00', currency: 'INR', incurredOn: '2026-09-07',
    });
    const body = post.mock.calls[0][1] as Record<string, unknown>;
    expect(typeof body.amount).toBe('string');
    expect(body.amount).toBe('1250.00');
  });

  it('confirm and void are distinct endpoints; voiding needs a reason', async () => {
    post.mockReturnValue(ok({}));
    await expensesApi.confirm('e1');
    await expensesApi.void('e1', 'entered in error');
    expect(post.mock.calls[0][0]).toBe('/admin/finance/expenses/e1/confirm');
    expect(post.mock.calls[1][0]).toBe('/admin/finance/expenses/e1/void');
    expect(post.mock.calls[1][1]).toEqual({ reason: 'entered in error' });
  });

  it('the page shows NO profit and NO revenue figure', () => {
    const src = strip(read(PAGE));
    // Profit needs the revenue definition that is a client decision; the page prints the reason.
    expect(src).not.toMatch(/\bprofit\b\s*[:=]/i);
    expect(src).not.toMatch(/\brevenue\b\s*[:=]/i);
    expect(src).toContain('expenses-unavailable');
  });

  it('seeds no category — the chart of accounts is the client’s', () => {
    const src = strip(read(PAGE));
    expect(src).toContain('expensesApi.categories');
    // No hardcoded category list anywhere.
    expect(src).not.toMatch(/const CATEGORIES\s*=/);
    expect(read(PAGE)).toContain('Nothing is pre-seeded');
  });

  it('totals are per currency and never combined', () => {
    const src = strip(read(PAGE));
    expect(src).toContain('totals.data.byCurrency.map');
    expect(src).not.toMatch(/grandTotal|combinedTotal/i);
  });

  it('gates writes on expenses:write and has full states', () => {
    const src = read(PAGE);
    expect(src).toContain("includes('expenses:write')");
    for (const id of ['expenses-loading', 'expenses-error', 'expenses-empty', 'expenses-action-error']) {
      expect(src).toContain(id);
    }
    expect(src).toContain('minHeight: 44');
  });
});

/* ============================================== the gap itself, guarded */

describe('every operator console reaches a REAL backend surface', () => {
  it('all four pages are wired into the admin navigation', () => {
    const nav = read('components/shared/navigation.ts');
    for (const href of ['/admin/cashier', '/admin/kyc', '/admin/users', '/admin/expenses']) {
      expect(`${href}:${nav.includes(`'${href}'`)}`).toBe(`${href}:true`);
    }
  });

  it('none of them are marked demoOnly — these are real production surfaces', () => {
    const nav = read('components/shared/navigation.ts');
    for (const href of ['/admin/cashier', '/admin/kyc', '/admin/users', '/admin/expenses']) {
      const entry = nav.slice(nav.indexOf(`'${href}'`), nav.indexOf(`'${href}'`) + 120);
      expect(`${href}:${entry.includes('demoOnly')}`).toBe(`${href}:false`);
    }
  });

  it('no console fabricates data when the API fails — each has an error state', () => {
    for (const page of ['app/admin/cashier/page.tsx', 'app/admin/kyc/page.tsx',
      'app/admin/users/page.tsx', 'app/admin/expenses/page.tsx']) {
      const src = read(page);
      expect(`${page}:${src.includes('isError')}`).toBe(`${page}:true`);
      expect(`${page}:${src.includes('useDemoWallet')}`).toBe(`${page}:false`);
    }
  });
});
