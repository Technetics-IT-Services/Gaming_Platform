import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  unwrap: async (p: Promise<{ data: { data: unknown } }>) => (await p).data.data,
}));

import { adminAuditApi, adminReferralsApi, adminResponsibleGamingApi } from './admin-oversight-api';
import { apiClient } from './api-client';
import { gameCatalogApi } from './game-catalog-api';

/**
 * Phase 2D.13 — the last four operator surfaces that had no frontend.
 *
 * AD-03 game catalogue · AD-12 audit trail · P-10 responsible-gaming operator view ·
 * P-17 referral oversight. After these, no permission-guarded operator route requires curl.
 */

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const post = apiClient.post as unknown as ReturnType<typeof vi.fn>;
const patch = apiClient.patch as unknown as ReturnType<typeof vi.fn>;
const del = apiClient.delete as unknown as ReturnType<typeof vi.fn>;
const ok = (data: unknown) => Promise.resolve({ data: { data } });

beforeEach(() => { get.mockReset(); post.mockReset(); patch.mockReset(); del.mockReset(); });
afterEach(() => vi.clearAllMocks());

const SRC = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ===================================================== AD-03 game catalogue */

describe('game catalogue console (AD-03)', () => {
  const PAGE = 'app/admin/catalog/page.tsx';

  it('reaches all four guarded surfaces', async () => {
    get.mockReturnValue(ok([]));
    await gameCatalogApi.categories();
    await gameCatalogApi.providers();
    await gameCatalogApi.collections();
    await gameCatalogApi.launchers();
    expect(get.mock.calls.map((c) => c[0])).toEqual([
      '/admin/game-categories', '/admin/game-providers',
      '/admin/game-collections', '/admin/game-launchers',
    ]);
  });

  it('tolerates a bare array OR a paginated envelope', async () => {
    get.mockReturnValueOnce(ok({ items: [{ id: 'c1', name: 'Slots' }] }));
    const wrapped = await gameCatalogApi.categories();
    get.mockReturnValueOnce(ok([{ id: 'c2', name: 'Live' }]));
    const bare = await gameCatalogApi.providers();
    expect(wrapped).toHaveLength(1);
    expect(bare).toHaveLength(1);
  });

  it('NEVER touches money-affecting game configuration', () => {
    const src = strip(read('lib/game-catalog-api.ts'));
    // A catalogue is presentation metadata. Odds, RTP, stake limits and payouts live elsewhere.
    for (const forbidden of ['rtp', 'odds', 'payout', 'stake', 'minBet', 'maxBet', 'houseEdge', 'variant']) {
      expect(`${forbidden}:${src.toLowerCase().includes(forbidden.toLowerCase())}`).toBe(`${forbidden}:false`);
    }
  });

  it('the page states that it changes no odds or payouts', () => {
    expect(read(PAGE)).toContain('Nothing here changes odds, payouts or stake limits');
  });

  it('does not offer to create a launcher — the platform registers those', () => {
    const src = strip(read('lib/game-catalog-api.ts'));
    expect(src).not.toContain('createLauncher');
    expect(read(PAGE)).toContain('catalog-launchers-note');
  });

  it('gates writes on games:write and has full states', () => {
    const src = read(PAGE);
    expect(src).toContain("includes('games:write')");
    expect(src).toContain('isDemoSession');
    for (const id of ['catalog-loading', 'catalog-error', 'catalog-empty', 'catalog-action-error']) {
      expect(src).toContain(id);
    }
    expect(src).toContain('minHeight: 44');
    expect(src).toContain("overflowX: 'auto'");
  });
});

/* ========================================================= AD-12 audit trail */

describe('audit trail viewer (AD-12)', () => {
  const PAGE = 'app/admin/audit/page.tsx';

  it('reads the guarded audit route with its filters', async () => {
    get.mockReturnValueOnce(ok({ items: [] }));
    await adminAuditApi.list({ entityType: 'partner', page: 2, limit: 25 });
    // Order-independent: what matters is the route and that every filter reached the wire.
    const url = String(get.mock.calls[0][0]);
    expect(url.startsWith('/admin/audit?')).toBe(true);
    for (const param of ['page=2', 'limit=25', 'entityType=partner']) {
      expect(`${param}:${url.includes(param)}`).toBe(`${param}:true`);
    }
  });

  it('is READ-ONLY — an audit trail an operator can edit is not an audit trail', () => {
    const src = strip(read('lib/admin-oversight-api.ts'));
    // Slice precisely between the two exported clients — the file's header comment also mentions
    // P-10, so searching for that string would have cut the block in the wrong place.
    const start = src.indexOf('export const adminAuditApi');
    const end = src.indexOf('export interface RgLimit');
    const auditBlock = src.slice(start, end > start ? end : undefined);
    expect(auditBlock).toContain('apiClient.get');
    for (const verb of ['post', 'patch', 'delete', 'put']) {
      expect(`${verb}:${auditBlock.includes(`apiClient.${verb}`)}`).toBe(`${verb}:false`);
    }
    expect(strip(read(PAGE))).not.toContain('useMutation');
  });

  it('renders the change set as TEXT, never as markup', () => {
    const src = read(PAGE);
    // Audit records carry operator-supplied reasons; injecting them as HTML would make the log an
    // attack surface.
    expect(src).not.toContain('dangerouslySetInnerHTML');
    expect(src).toContain('function summarise');
  });

  it('pages rather than silently truncating', () => {
    const src = read(PAGE);
    expect(src).toContain('audit-paging');
    expect(src).toContain('totalPages');
  });

  it('has loading, error and empty states', () => {
    const src = read(PAGE);
    for (const id of ['audit-loading', 'audit-error', 'audit-empty']) expect(src).toContain(id);
    expect(src).toContain('minHeight: 44');
  });
});

/* ============================================= P-10 responsible gaming (ops) */

describe('responsible-gaming operator view (P-10)', () => {
  const PAGE = 'app/admin/users/page.tsx';

  it('reads one player’s limits from the guarded route', async () => {
    get.mockReturnValueOnce(ok({ limits: [], restrictions: [] }));
    await adminResponsibleGamingApi.forUser('u1');
    expect(get.mock.calls[0][0]).toBe('/admin/responsible-gaming/users/u1');
  });

  it('offers ONLY lifting a restriction — never creating or raising a limit', () => {
    expect(Object.keys(adminResponsibleGamingApi).sort()).toEqual(['forUser', 'liftRestriction']);
    const src = strip(read('lib/admin-oversight-api.ts'));
    for (const forbidden of ['setLimit', 'createLimit', 'raiseLimit', 'removeLimit', 'addRestriction']) {
      expect(src).not.toContain(forbidden);
    }
  });

  it('a lift carries a reason and is audited server-side', async () => {
    post.mockReturnValueOnce(ok({}));
    await adminResponsibleGamingApi.liftRestriction('r1', 'appeal upheld');
    expect(post.mock.calls[0][0]).toBe('/admin/responsible-gaming/restrictions/r1/lift');
    expect(post.mock.calls[0][1]).toEqual({ reason: 'appeal upheld' });
  });

  it('the panel says limits belong to the player', () => {
    const src = read(PAGE);
    expect(src).toContain('user-rg-panel');
    expect(src).toContain('Limits are set by the player');
    expect(src).toContain('never add one or raise a limit');
  });

  it('has loading, error and empty states', () => {
    const src = read(PAGE);
    for (const id of ['user-rg-loading', 'user-rg-error', 'user-rg-no-limits', 'user-rg-no-restrictions']) {
      expect(src).toContain(id);
    }
  });
});

/* ==================================================== P-17 referral oversight */

describe('referral oversight (P-17)', () => {
  const PAGE = 'app/admin/referrals/page.tsx';

  it('reads the guarded referral route', async () => {
    get.mockReturnValueOnce(ok({ items: [], total: 0, page: 1, limit: 25 }));
    await adminReferralsApi.list({ status: 'PENDING', page: 1, limit: 25 });
    expect(String(get.mock.calls[0][0])).toBe('/admin/referrals?status=PENDING&page=1&limit=25');
  });

  it('is READ-ONLY — no route awards, adjusts or reverses a referral', () => {
    expect(Object.keys(adminReferralsApi)).toEqual(['list']);
    const src = strip(read('lib/admin-oversight-api.ts'));
    for (const forbidden of ['awardReferral', 'payReferral', 'adjustReferral', 'reverseReferral']) {
      expect(src).not.toContain(forbidden);
    }
  });

  it('shows the blocked reason where a reward figure would be — never a zero', () => {
    const src = read(PAGE);
    expect(src).toContain('referrals-unavailable');
    expect(src).toContain('No reward is calculated');
    expect(strip(src)).not.toMatch(/reward[A-Za-z]*\s*[:=]\s*['"0]/);
  });

  it('has loading, error, empty states and paging', () => {
    const src = read(PAGE);
    for (const id of ['referrals-loading', 'referrals-error', 'referrals-empty', 'referrals-paging']) {
      expect(src).toContain(id);
    }
    expect(src).toContain('minHeight: 44');
  });
});

/* ================================================== the gap itself, closed */

describe('Phase 2D.13 — no guarded operator route is left without a UI', () => {
  it('all four new consoles are wired into the admin navigation', () => {
    const nav = read('components/shared/navigation.ts');
    for (const href of ['/admin/catalog', '/admin/audit', '/admin/referrals']) {
      expect(`${href}:${nav.includes(`'${href}'`)}`).toBe(`${href}:true`);
    }
    // The responsible-gaming view lives on the users console, which is already in the nav.
    expect(nav).toContain("'/admin/users'");
  });

  it('none is marked demoOnly — these are real production surfaces', () => {
    const nav = read('components/shared/navigation.ts');
    for (const href of ['/admin/catalog', '/admin/audit', '/admin/referrals']) {
      const entry = nav.slice(nav.indexOf(`'${href}'`), nav.indexOf(`'${href}'`) + 120);
      expect(`${href}:${entry.includes('demoOnly')}`).toBe(`${href}:false`);
    }
  });

  it('no console fabricates data when the API fails', () => {
    for (const page of ['app/admin/catalog/page.tsx', 'app/admin/audit/page.tsx',
      'app/admin/referrals/page.tsx']) {
      const src = read(page);
      expect(`${page}:${src.includes('isError')}`).toBe(`${page}:true`);
      expect(`${page}:${src.includes('useDemoWallet')}`).toBe(`${page}:false`);
    }
  });
});
