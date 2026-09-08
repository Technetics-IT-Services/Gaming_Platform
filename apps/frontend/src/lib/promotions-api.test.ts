import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  unwrap: async (p: Promise<{ data: { data: unknown } }>) => (await p).data.data,
}));

import { apiClient } from './api-client';
import { adminPromotionsApi, promotionsApi, PROMOTION_STATUSES, PROMOTION_TYPES } from './promotions-api';

/**
 * AD-08 promotions client contract, plus structural proof that promotions are CONFIGURATION: no
 * award amount is ever sent or displayed, and status is never assumed by the client.
 */

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const post = apiClient.post as unknown as ReturnType<typeof vi.fn>;
const ok = (data: unknown) => Promise.resolve({ data: { data } });

beforeEach(() => { get.mockReset(); post.mockReset(); });
afterEach(() => vi.clearAllMocks());

describe('promotionsApi — player contract', () => {
  it('asks the server which offers are active instead of filtering client-side', async () => {
    get.mockReturnValueOnce(ok({ items: [], unavailable: [] }));
    await promotionsApi.active();
    expect(get.mock.calls[0][0]).toBe('/promotions');
  });

  it('exposes no claim call at all', () => {
    expect(Object.keys(promotionsApi)).toEqual(['active']);
  });
});

describe('adminPromotionsApi — contract', () => {
  it('builds a filtered list query and drops undefined filters', async () => {
    get.mockReturnValueOnce(ok({ items: [], total: 0, page: 1, limit: 20, unavailable: [] }));
    await adminPromotionsApi.list({ status: 'ACTIVE', type: undefined, limit: 100 });
    expect(get.mock.calls[0][0]).toBe('/admin/promotions?status=ACTIVE&limit=100');
  });

  it('omits the query string entirely when unfiltered', async () => {
    get.mockReturnValueOnce(ok({ items: [], total: 0, page: 1, limit: 20, unavailable: [] }));
    await adminPromotionsApi.list();
    expect(get.mock.calls[0][0]).toBe('/admin/promotions');
  });

  it('never sends status, redemption counts or an award amount when creating', async () => {
    post.mockReturnValueOnce(ok({ id: 'p1', code: 'WELCOME25', status: 'DRAFT' }));
    await adminPromotionsApi.create({ code: 'WELCOME25', name: 'Welcome', type: 'DEPOSIT_BONUS' });
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/admin/promotions');
    expect(Object.keys(body).sort()).toEqual(['code', 'name', 'type']);
    // The server rejects unknown fields; the client must not even offer them.
    for (const forbidden of ['status', 'currentRedemptions', 'id', 'amount', 'bonusAmount', 'value', 'percent']) {
      expect(Object.keys(body)).not.toContain(forbidden);
    }
  });

  it('changes status through the dedicated route with only a status', async () => {
    post.mockReturnValueOnce(ok({ id: 'p1', status: 'ACTIVE' }));
    await adminPromotionsApi.setStatus('p1', 'ACTIVE');
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/admin/promotions/p1/status');
    expect(body).toEqual({ status: 'ACTIVE' });
  });

  it('lists exactly the server’s status and type vocabularies', () => {
    expect(PROMOTION_STATUSES).toEqual(['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'ENDED']);
    expect(PROMOTION_TYPES).toContain('DEPOSIT_BONUS');
    expect(PROMOTION_TYPES).toContain('CASHBACK');
  });

  it('declares no award amount anywhere in the client', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'lib', 'promotions-api.ts'), 'utf8');
    for (const forbidden of ['bonusAmount', 'awardAmount', 'rewardValue', 'payout', 'credit(']) {
      expect(src).not.toContain(forbidden);
    }
  });
});

describe('the admin promotions screen is configuration, not money', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const PAGE = 'app/admin/promotions/page.tsx';

  it('renders from the API, not a hardcoded catalogue', () => {
    const src = strip(read(PAGE));
    expect(src).toContain('adminPromotionsApi.list');
    expect(src).toContain('adminPromotionsApi.create');
    expect(src).toContain('adminPromotionsApi.setStatus');
    expect(src).toContain('d.items.map');
  });

  it('offers no money input of any kind', () => {
    const src = strip(read(PAGE));
    // `DEPOSIT_BONUS` is a promotion TYPE name, so a blunt substring scan would be meaningless.
    // What must not exist is a monetary field on the record, or a rendered currency value.
    expect(src).not.toMatch(/\bp\.(amount|value|bonus\w*|reward\w*|credit\w*|balance)\b/);
    expect(src).not.toMatch(/\b(amount|bonusAmount|awardAmount|creditAmount)\s*[:,]/);
    expect(src).not.toContain('₹');
    expect(src).not.toContain('toFixed');
    // The create form posts exactly these three fields — no monetary one among them.
    expect(src).toContain('code: code.trim(), name: name.trim(), type');
  });

  it('hides write controls without settings:write and says the server decides', () => {
    const src = read(PAGE);
    expect(src).toContain("includes('settings:write')");
    expect(src).toContain('isDemoSession');
    expect(src).toContain('The server refuses writes from this account');
  });

  it('tells the operator a refused change was NOT applied', () => {
    expect(read(PAGE)).toContain('was NOT applied');
  });

  it('surfaces the server’s awarding-blocked reason instead of a zero', () => {
    const src = read(PAGE);
    expect(src).toContain('promotions-unavailable');
    expect(src).toContain('d.unavailable.map');
    expect(src).toContain('Awarding is not available');
  });

  it('has loading, error and empty states with >=44px targets', () => {
    const src = read(PAGE);
    expect(src).toContain('promotions-loading');
    expect(src).toContain('promotions-error');
    expect(src).toContain('promotions-empty');
    expect(src).toContain('minHeight: 44');
  });

  it('keeps the wide table inside its own scroller so the page cannot overflow', () => {
    const src = read(PAGE);
    expect(src).toContain("overflowX: 'auto'");
    expect(src).toContain('minWidth: 0');
  });
});

describe('the player offers screen shows only genuinely published offers', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const PAGE = 'app/(dashboard)/offers/page.tsx';

  it('renders the server’s active list, with no demo catalogue and no claim button', () => {
    const src = strip(read(PAGE));
    expect(src).toContain('promotionsApi.active');
    expect(src).not.toContain('useDemoWallet');
    expect(src).not.toContain('claim');
  });

  it('shows no bonus value and no balance', () => {
    const src = strip(read(PAGE));
    expect(src).not.toContain('₹');
    expect(src).not.toContain('toFixed');
    // The page's own prose says nothing is added to your balance — that sentence is the honesty,
    // so the assertion targets a RENDERED monetary field instead of the word.
    expect(src).not.toMatch(/\bp\.(amount|value|bonus\w*|reward\w*|credit\w*|balance)\b/);
    expect(src).not.toContain('useWalletBalance');
  });

  it('says plainly that nothing is credited from the page', () => {
    const src = read(PAGE);
    expect(src).toContain('offers-unavailable');
    expect(src).toContain('not credited bonuses');
  });

  it('has loading, error and empty states and wraps long text', () => {
    const src = read(PAGE);
    expect(src).toContain('offers-loading');
    expect(src).toContain('offers-error');
    expect(src).toContain('offers-empty');
    expect(src).toContain("overflowWrap: 'anywhere'");
  });
});

describe('a demo session cannot reach the referral or promotion endpoints', () => {
  it('both paths are locally blocked for a demo session', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'lib', 'api-client.ts'), 'utf8');
    expect(src).toContain('/^\\/referral(\\/|\\?|$)/');
    expect(src).toContain('/^\\/promotions(\\/|\\?|$)/');
  });
});
