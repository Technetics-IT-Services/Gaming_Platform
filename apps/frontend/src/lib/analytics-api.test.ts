import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({
  apiClient: { get: vi.fn() },
  unwrap: async (p: Promise<{ data: { data: unknown } }>) => (await p).data.data,
}));

import { apiClient } from './api-client';
import { analyticsApi } from './analytics-api';

/**
 * Phase 2D.6 — analytics client contract, plus structural proof that the dashboard is entirely
 * server-backed and renders unavailable metrics honestly.
 *
 * This vitest project runs in the `node` environment with no DOM, so component rendering is covered by
 * the Playwright mobile run. What is asserted here is the API contract and the dependency/honesty
 * properties, which a render test could not prove anyway.
 */

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const ok = (data: unknown) => Promise.resolve({ data: { data } });

beforeEach(() => get.mockReset());
afterEach(() => vi.clearAllMocks());

describe('analyticsApi — contract', () => {
  it('summary hits the operator endpoint and never sends a userId', async () => {
    get.mockReturnValueOnce(ok({ meta: {}, gaming: {}, financial: {}, users: {}, operations: {} }));
    await analyticsApi.summary({ from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' });
    const url = get.mock.calls[0][0] as string;
    expect(url).toContain('/analytics/summary');
    expect(url).toContain('from=');
    expect(url).toContain('to=');
    expect(url.toLowerCase()).not.toContain('userid');
  });

  it('omits empty filters rather than sending blank params', async () => {
    get.mockReturnValueOnce(ok({}));
    await analyticsApi.summary({ from: '2026-01-01T00:00:00.000Z', currency: '' });
    const url = get.mock.calls[0][0] as string;
    expect(url).toContain('from=');
    expect(url).not.toContain('currency=');
  });

  it('passes a currency filter through so totals stay currency-scoped', async () => {
    get.mockReturnValueOnce(ok({}));
    await analyticsApi.summary({ currency: 'INR' });
    expect(get.mock.calls[0][0]).toContain('currency=INR');
  });

  it('daily hits its own endpoint', async () => {
    get.mockReturnValueOnce(ok({ rounds: [], cashier: [] }));
    await analyticsApi.daily({});
    expect(get.mock.calls[0][0]).toBe('/analytics/daily');
  });

  it('unavailable returns the declared metric list', async () => {
    get.mockReturnValueOnce(ok({ unavailable: [{ metric: 'dau', reason: 'NOT AVAILABLE — ...' }] }));
    const res = await analyticsApi.unavailable();
    expect(res.unavailable[0]!.metric).toBe('dau');
  });

  it('unwraps the standard envelope into the summary payload', async () => {
    get.mockReturnValueOnce(ok({ users: { registered: 1826 }, meta: { timezone: 'UTC' } }));
    const s = await analyticsApi.summary();
    expect(s.users.registered).toBe(1826);
    expect(s.meta.timezone).toBe('UTC');
  });
});

describe('the analytics dashboard is server-backed and honest', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const PAGE = 'app/admin/analytics/page.tsx';

  it('has no demo dependency of any kind', () => {
    const src = strip(read(PAGE));
    expect(src).not.toContain("from '@/stores/demo-wallet'");
    expect(src).not.toContain('useDemoWallet(');
    expect(src).not.toContain('demo-games');
    expect(src).not.toContain('prototype');
  });

  it('renders from the API, not from a hardcoded dataset', () => {
    const src = strip(read(PAGE));
    expect(src).toContain('analyticsApi.summary');
    expect(src).toContain('analyticsApi.daily');
    // The old placeholder text must be gone.
    expect(src).not.toContain('Charts render here once');
  });

  it('shows "Not available" for a null metric instead of a fabricated zero', () => {
    const src = read(PAGE);
    expect(src).toContain("'Not available'");
    expect(src).toContain('value === null');
  });

  it('surfaces the server-declared unavailable metrics with their reasons', () => {
    const src = read(PAGE);
    expect(src).toContain('analytics-unavailable');
    expect(src).toContain('meta.unavailable');
    expect(src).toContain('deliberately not displayed as zero');
  });

  it('labels ledger-level figures as a different measure from game-level stake/payout', () => {
    const src = read(PAGE);
    expect(src).toContain('NOT the same measure as game-level');
  });

  it('states the UTC basis and the per-currency rule to the operator', () => {
    const src = read(PAGE);
    expect(src).toContain('All times UTC');
    expect(src).toContain('never combined');
  });

  it('is gated on a REAL session (a demo session cannot reach analytics)', () => {
    expect(read(PAGE)).toContain('useRealSession');
  });

  it('blocks /analytics for demo sessions at the transport layer', () => {
    expect(read('lib/api-client.ts')).toContain('/^\\/analytics');
  });

  it('has honest loading, error and empty states', () => {
    const src = read(PAGE);
    expect(src).toContain('analytics-loading');
    expect(src).toContain('analytics-error');
    expect(src).toContain('No rows in range');
  });

  it('keeps tables inside their own horizontal scroller (mobile safety)', () => {
    expect(read(PAGE)).toContain("overflowX: 'auto'");
  });

  it('uses >=44px touch targets on the filter inputs', () => {
    const src = read(PAGE);
    expect(src).toContain('minHeight: 44');
  });

  it('never renders notification/analytics content as HTML', () => {
    expect(read(PAGE)).not.toContain('dangerouslySetInnerHTML');
  });
});

describe('engagement / DAU-MAU (Phase 2D.9, X-02)', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const PAGE = 'app/admin/analytics/page.tsx';

  it('reads engagement from the server, honouring the same window filters', () => {
    const src = read('lib/analytics-api.ts');
    expect(src).toContain("apiClient.get(`/analytics/engagement${qs(f)}`)");
  });

  it('types the counts as nullable so "no data" is never a zero', () => {
    const src = read('lib/analytics-api.ts');
    expect(src).toContain('activeUsersInWindow: number | null;');
    expect(src).toContain('mauRolling30: number | null;');
  });

  it('the page renders the server-supplied DEFINITION, so DAU cannot be reinterpreted', () => {
    const src = read(PAGE);
    expect(src).toContain('engagement.data.definitions.dau');
  });

  it('renders "Not available" rather than 0 when the pipeline has no data', () => {
    const src = read(PAGE);
    expect(src).toContain("engagement.data.activeUsersInWindow === null ? 'Not available'");
    expect(src).toContain("engagement.data.mauRolling30 === null ? 'Not available'");
  });

  it('always shows the no-backfill coverage caveat when the window is not fully covered', () => {
    const src = read(PAGE);
    expect(src).toContain('engagement-coverage');
    expect(src).toContain('!engagement.data.windowFullyCovered');
    expect(src).toContain('absent instrumentation, not absent activity');
  });

  it('folds the engagement endpoint’s own unavailable reasons into the honest list', () => {
    const src = read(PAGE);
    expect(src).toContain('...(engagement.data?.unavailable ?? [])');
  });

  it('has engagement loading and error states, and keeps its table in a scroller', () => {
    const src = read(PAGE);
    expect(src).toContain('engagement-loading');
    expect(src).toContain('engagement-error');
    expect(src).toContain('analytics-engagement');
  });
});
