import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  unwrap: async (p: Promise<{ data: { data: unknown } }>) => (await p).data.data,
}));

import { apiClient } from './api-client';
import { bonusAdminApi } from './bonus-admin-api';
import { financeOpsApi } from './finance-ops-api';

/**
 * Phase 2D.10 client contracts: finance operations (F-01/F-06/F-07) and operator bonus
 * administration (AD-07), plus structural proof that neither surface fabricates money.
 */

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const post = apiClient.post as unknown as ReturnType<typeof vi.fn>;
const ok = (data: unknown) => Promise.resolve({ data: { data } });

beforeEach(() => { get.mockReset(); post.mockReset(); });
afterEach(() => vi.clearAllMocks());

describe('financeOpsApi — contract', () => {
  it('is READ-ONLY: it exposes no mutation at all', () => {
    // Reviewing money is not the authority to move it. `cashierQueue` (Phase 2D.12) is a READ of
    // the work queue; the actions that move money live in `cashierAdminApi` behind `wallets:adjust`.
    expect(Object.keys(financeOpsApi).sort())
      .toEqual(['cashFlow', 'cashierQueue', 'failures', 'queues', 'transactions']);

    // Stronger than a key list: the client must issue no write verb at all.
    const src = readFileSync(join(process.cwd(), 'src', 'lib', 'finance-ops-api.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const verb of ['apiClient.post', 'apiClient.put', 'apiClient.patch', 'apiClient.delete']) {
      expect(`${verb}:${src.includes(verb)}`).toBe(`${verb}:false`);
    }
  });

  it('reads the review queues from the finance route', async () => {
    get.mockReturnValueOnce(ok({ pendingDeposits: 0 }));
    await financeOpsApi.queues();
    expect(get.mock.calls[0][0]).toBe('/admin/finance/queues');
  });

  it('passes the window through to cash flow', async () => {
    get.mockReturnValueOnce(ok({ byCurrency: [], unavailable: [] }));
    await financeOpsApi.cashFlow({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-07T00:00:00.000Z' });
    expect(String(get.mock.calls[0][0])).toContain('/admin/finance/cash-flow?from=');
    expect(String(get.mock.calls[0][0])).toContain('to=');
  });

  it('drops empty and undefined filters instead of sending blanks', async () => {
    get.mockReturnValueOnce(ok({ items: [], total: 0, page: 1, limit: 25, unavailable: [] }));
    await financeOpsApi.transactions({ typeCode: 'GAME_BET', reference: '', userId: undefined, limit: 10 });
    const url = String(get.mock.calls[0][0]);
    expect(url).toBe('/admin/finance/transactions?typeCode=GAME_BET&limit=10');
    expect(url).not.toContain('reference=');
    expect(url).not.toContain('userId=');
  });

  it('omits the query string entirely when unfiltered', async () => {
    get.mockReturnValueOnce(ok({ failedDeposits: [], failedWithdrawals: [], failedRounds: [] }));
    await financeOpsApi.failures();
    expect(get.mock.calls[0][0]).toBe('/admin/finance/failures');
  });

  it('declares no consolidated total, revenue or profit field', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'lib', 'finance-ops-api.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['consolidatedTotal', 'grandTotal', 'revenue:', 'profit:', 'ggr']) {
      expect(src.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    // Movement is always per currency.
    expect(src).toContain('byCurrency: CurrencyMovement[]');
  });
});

describe('bonusAdminApi — contract', () => {
  it('always names the recipient — there is no self-service grant', async () => {
    post.mockReturnValueOnce(ok({ id: 'b1', username: 'bob' }));
    await bonusAdminApi.grant({
      userId: 'u1', currencyCode: 'INR', amount: '250', reference: 'ref-123456', reason: 'goodwill',
    });
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/admin/bonuses');
    expect(body.userId).toBe('u1');
    // Server-owned state must never be client-supplied.
    for (const forbidden of ['status', 'balance', 'wageringProgress', 'id']) {
      expect(Object.keys(body)).not.toContain(forbidden);
    }
  });

  it('sends the reference so a replay cannot double-grant', async () => {
    post.mockReturnValueOnce(ok({ id: 'b1' }));
    await bonusAdminApi.grant({
      userId: 'u1', currencyCode: 'INR', amount: '10', reference: 'idem-abc123', reason: 'x',
    });
    expect((post.mock.calls[0][1] as Record<string, unknown>).reference).toBe('idem-abc123');
  });

  it('expiring sends only a reason', async () => {
    post.mockReturnValueOnce(ok({ id: 'b1', status: 'CLOSED' }));
    await bonusAdminApi.expire('b1', 'no longer applicable');
    expect(post.mock.calls[0][0]).toBe('/admin/bonuses/b1/expire');
    expect(post.mock.calls[0][1]).toEqual({ reason: 'no longer applicable' });
  });

  it('suggests no amount and computes no eligibility', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'lib', 'bonus-admin-api.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['DEFAULT_AMOUNT', 'suggested', 'eligible', 'autoAward', 'calculate']) {
      expect(src).not.toContain(forbidden);
    }
  });
});

describe('the finance console is read-only and never implies revenue', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const PAGE = 'app/admin/finance/page.tsx';

  it('renders from the API with no mutation call', () => {
    const src = strip(read(PAGE));
    expect(src).toContain('financeOpsApi.queues');
    expect(src).toContain('financeOpsApi.cashFlow');
    expect(src).toContain('financeOpsApi.transactions');
    expect(src).toContain('financeOpsApi.failures');
    // A read-only console must not even import the mutation primitive.
    expect(src).not.toContain('useMutation');
  });

  it('prints the server’s own definition rather than paraphrasing it', () => {
    expect(read(PAGE)).toContain('cash.data.definition');
  });

  it('shows the blocked revenue/profit reasons instead of a number', () => {
    const src = read(PAGE);
    expect(src).toContain('cashflow-unavailable');
    expect(src).toContain('cash.data.unavailable.map');
  });

  it('explains why the failure view does not read the ledger', () => {
    expect(read(PAGE)).toContain('failures.data.ledgerNote');
  });

  it('renders every amount inside a per-currency row, never a total row', () => {
    const src = strip(read(PAGE));
    expect(src).toContain('cash.data.byCurrency.map');
    expect(src).not.toMatch(/\bgrandTotal\b|\bconsolidated\b/i);
  });

  it('has loading, error and empty states and keeps tables in their own scroller', () => {
    const src = read(PAGE);
    for (const id of ['queues-loading', 'queues-error', 'cashflow-loading', 'cashflow-error',
      'cashflow-empty', 'search-loading', 'search-error', 'search-empty',
      'failures-loading', 'failures-error', 'failures-empty']) {
      expect(src).toContain(id);
    }
    expect(src).toContain("overflowX: 'auto'");
    expect(src).toContain('minHeight: 44');
  });
});

describe('the bonus console never fabricates an award', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const PAGE = 'app/admin/bonuses/page.tsx';

  it('renders from the API, not a hardcoded list', () => {
    const src = strip(read(PAGE));
    expect(src).toContain('bonusAdminApi.list');
    expect(src).toContain('bonusAdminApi.grant');
    expect(src).toContain('d.items.map');
  });

  it('pre-fills NO amount and offers no automatic-award control', () => {
    const src = strip(read(PAGE));
    // The amount starts empty; the operator types every figure.
    expect(src).toContain("amount: '', wageringRequirement: ''");
    expect(src).not.toMatch(/auto[- ]?award|awardAll|grantAll/i);
  });

  it('requires a reference and a reason before it will submit', () => {
    const src = strip(read(PAGE));
    expect(src).toContain('form.reference.trim().length >= 6');
    expect(src).toContain('form.reason.trim().length >= 3');
  });

  it('hides grant controls without wallets:adjust and says the server decides', () => {
    const src = read(PAGE);
    expect(src).toContain("includes('wallets:adjust')");
    expect(src).toContain('isDemoSession');
    expect(src).toContain('The server refuses writes from this account');
  });

  it('tells the operator a refused grant was NOT applied', () => {
    expect(read(PAGE)).toContain('was NOT applied');
  });

  it('surfaces the server’s automatic-award-blocked reason', () => {
    const src = read(PAGE);
    expect(src).toContain('bonuses-unavailable');
    expect(src).toContain('Nothing is awarded automatically');
  });

  it('has loading, error and empty states with >=44px targets', () => {
    const src = read(PAGE);
    for (const id of ['bonuses-loading', 'bonuses-error', 'bonuses-empty']) expect(src).toContain(id);
    expect(src).toContain('minHeight: 44');
    expect(src).toContain("overflowX: 'auto'");
  });
});
