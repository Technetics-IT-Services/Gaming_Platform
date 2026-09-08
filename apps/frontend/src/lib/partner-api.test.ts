import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  unwrap: async (p: Promise<{ data: { data: unknown } }>) => (await p).data.data,
}));

import { apiClient } from './api-client';
import { adminPartnerApi, partnerApi, PARTNER_STATUSES } from './partner-api';
import { canAccessPartnerPortal, canReadPartnerAdmin, canWritePartners } from './partner-access';

/**
 * Phase 2D.4 — partner client contract and access rules, plus structural proof that the partner UI
 * is server-backed and never fabricates money.
 */

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const post = apiClient.post as unknown as ReturnType<typeof vi.fn>;
const ok = (data: unknown) => Promise.resolve({ data: { data } });

beforeEach(() => { get.mockReset(); post.mockReset(); });
afterEach(() => vi.clearAllMocks());

describe('partnerApi — a partner reads only their own organisation', () => {
  it('neither route sends a partner id or a user id', async () => {
    get.mockReturnValue(ok({}));
    await partnerApi.me();
    await partnerApi.dashboard();
    const urls = get.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(['/partner', '/partner/dashboard']);
    for (const u of urls) {
      expect(u).not.toMatch(/partnerId|userId|[0-9a-f]{8}-/i);
    }
  });

  it('passes the server share through as a STRING, never a number', async () => {
    get.mockReturnValueOnce(ok({
      partner: { id: 'p1', code: 'PTR-AAA111', name: 'Acme', status: 'ACTIVE', revenueSharePercent: '12.5000', memberCount: 2, createdAt: '2026-01-01T00:00:00.000Z' },
      unavailable: [],
    }));
    const d = await partnerApi.dashboard();
    expect(d.partner.revenueSharePercent).toBe('12.5000');
    expect(typeof d.partner.revenueSharePercent).toBe('string');
  });

  it('carries the server-declared unavailable figures verbatim', async () => {
    get.mockReturnValueOnce(ok({
      partner: {},
      unavailable: [{ metric: 'netProfit', reason: 'NOT AVAILABLE — BUSINESS DEFINITION MISSING: ...' }],
    }));
    const d = await partnerApi.dashboard();
    expect(d.unavailable[0]!.metric).toBe('netProfit');
    expect(d.unavailable[0]!.reason).toMatch(/BUSINESS DEFINITION MISSING/);
  });
});

describe('adminPartnerApi — operator contract', () => {
  it('creates with only name, share and notes — never status, code or a balance', async () => {
    post.mockReturnValueOnce(ok({}));
    await adminPartnerApi.create({ name: 'Acme', revenueSharePercent: '10' });
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/admin/partners');
    expect(Object.keys(body).sort()).toEqual(['name', 'revenueSharePercent']);
    for (const forbidden of ['status', 'code', 'availableBalance', 'profit', 'balance', 'memberCount']) {
      expect(Object.keys(body)).not.toContain(forbidden);
    }
  });

  it('sends the share as a string so precision is preserved', async () => {
    post.mockReturnValueOnce(ok({}));
    await adminPartnerApi.setShare('p1', '33.3333');
    expect((post.mock.calls[0][1] as Record<string, unknown>).percent).toBe('33.3333');
  });

  it('hits the operator routes for read and write', async () => {
    get.mockReturnValue(ok({ items: [], allocation: {} }));
    post.mockReturnValue(ok({}));
    await adminPartnerApi.list({ limit: 100 });
    await adminPartnerApi.members('p1');
    await adminPartnerApi.setStatus('p1', 'ACTIVE');
    await adminPartnerApi.addMember('p1', 'u1');
    expect(String(get.mock.calls[0][0])).toContain('/admin/partners?limit=100');
    expect(String(get.mock.calls[1][0])).toBe('/admin/partners/p1/members');
    expect(String(post.mock.calls[0][0])).toBe('/admin/partners/p1/status');
    expect(String(post.mock.calls[1][0])).toBe('/admin/partners/p1/members');
  });

  it('exposes exactly the four server statuses', () => {
    expect(PARTNER_STATUSES).toEqual(['PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED']);
  });
});

describe('partner access rules mirror the backend permissions', () => {
  const u = (perms: string[]) => ({ permissions: perms });

  it('the portal needs partners:read_own', () => {
    expect(canAccessPartnerPortal(u(['partners:read_own']), false)).toBe(true);
    expect(canAccessPartnerPortal(u([]), false)).toBe(false);
    // An admin is NOT a partner — holding partners:read does not open the portal.
    expect(canAccessPartnerPortal(u(['partners:read', 'partners:write']), false)).toBe(false);
  });

  it('a demo session is never a partner, whatever it claims', () => {
    expect(canAccessPartnerPortal(u(['partners:read_own']), true)).toBe(false);
    expect(canReadPartnerAdmin(u(['partners:read']), true)).toBe(false);
    expect(canWritePartners(u(['partners:write']), true)).toBe(false);
  });

  it('admin read and super-admin write are separate', () => {
    const admin = u(['partners:read']);
    expect(canReadPartnerAdmin(admin, false)).toBe(true);
    expect(canWritePartners(admin, false)).toBe(false);

    const superAdmin = u(['partners:read', 'partners:write']);
    expect(canWritePartners(superAdmin, false)).toBe(true);
  });

  it('a null or unknown user is refused everywhere', () => {
    for (const fn of [canAccessPartnerPortal, canReadPartnerAdmin, canWritePartners]) {
      expect(fn(null, false)).toBe(false);
      expect(fn(undefined, false)).toBe(false);
      expect(fn(u([]), false)).toBe(false);
    }
  });
});

describe('the partner UI is server-backed and fabricates nothing', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const PORTAL = 'app/partner/page.tsx';
  const ADMIN = 'app/admin/partners/page.tsx';
  const GUARD = 'components/auth/partner-guard.tsx';

  it('never imports the orphaned simulation library', () => {
    for (const f of [PORTAL, ADMIN, 'lib/partner-api.ts', 'lib/partner-access.ts']) {
      const src = read(f);
      expect(src).not.toContain('@/lib/partners');
      expect(src).not.toContain('commission-engine');
      expect(src).not.toContain('partner-platform');
    }
  });

  it('renders from the real API', () => {
    expect(strip(read(PORTAL))).toContain('partnerApi.dashboard');
    const admin = strip(read(ADMIN));
    for (const fn of ['adminPartnerApi.list', 'adminPartnerApi.members', 'adminPartnerApi.create', 'adminPartnerApi.setShare', 'adminPartnerApi.setStatus', 'adminPartnerApi.addMember']) {
      expect(admin).toContain(fn);
    }
  });

  it('holds no fabricated money, earnings or player counts', () => {
    for (const f of [PORTAL, ADMIN]) {
      const src = strip(read(f));
      for (const bad of ['mockPartner', 'fakeEarnings', 'Math.random', 'toFixed(', 'parseFloat(', '₹0', 'commission']) {
        expect(src).not.toContain(bad);
      }
    }
  });

  it('does no client-side arithmetic on shares or allocation', () => {
    const admin = strip(read(ADMIN));
    // Allocation comes from the server object; the page must not sum shares itself.
    expect(admin).toContain('allocation.allocatedPercent');
    expect(admin).toContain('allocation.unallocatedPercent');
    expect(admin).not.toContain('.reduce(');
    expect(admin).not.toContain('Number(');
  });

  it('shows the server reason for blocked figures instead of a zero', () => {
    const src = read(PORTAL);
    expect(src).toContain('partner-unavailable');
    expect(src).toContain('u.reason');
    expect(src).toContain('deliberately not shown as zero');
  });

  it('has explicit loading and error states on both screens', () => {
    expect(read(PORTAL)).toContain('partner-loading');
    expect(read(PORTAL)).toContain('partner-error');
    expect(read(ADMIN)).toContain('partners-loading');
    expect(read(ADMIN)).toContain('partners-error');
  });

  it('tells the operator a refused change was NOT applied', () => {
    expect(read(ADMIN)).toContain('was NOT applied');
    expect(read(ADMIN)).toContain('Nothing was saved');
  });

  it('hides write controls without partners:write, and says the server decides', () => {
    const src = read(ADMIN);
    expect(src).toContain('canWritePartners');
    expect(src).toContain('mayWrite');
    expect(src).toContain('The server refuses writes from this account');
  });

  it('the guard states the backend remains the authority', () => {
    const src = read(GUARD);
    expect(src).toContain('BACKEND REMAINS THE AUTHORITY');
    expect(src).toContain('partner-forbidden');
    expect(src).toContain('canAccessPartnerPortal');
  });

  it('long names and codes wrap rather than widening the page', () => {
    for (const f of [PORTAL, ADMIN]) {
      const src = read(f);
      expect(src).toContain("overflowWrap: 'anywhere'");
      expect(src).toContain('minWidth: 0');
    }
  });

  it('the wide operator table scrolls inside its own container', () => {
    expect(read(ADMIN)).toContain("overflowX: 'auto'");
  });

  it('the partner shell keeps the 2D.6 min-w-0 fix', () => {
    expect(read('app/partner/layout.tsx')).toContain('min-w-0');
  });

  it('a demo session cannot reach partner routes at the transport layer', () => {
    const src = read('lib/api-client.ts');
    expect(src).toContain('/^\\/partner');
    expect(src).toContain('/^\\/admin\\/partners');
  });

  it('the partner portal is NOT inside the player dashboard group', () => {
    // A partner is not a player; the (dashboard) group would give them wallet/game navigation.
    const nav = read('components/shared/navigation.ts');
    expect(nav).toContain('partnerNav');
    expect(nav).not.toContain("{ label: 'Partner', href: '/partner'");
  });
});

describe('partner activity report (PA-07)', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const PAGE = 'app/partner/page.tsx';

  it('the report route takes NO partner id — the server resolves the caller', () => {
    const src = read('lib/partner-api.ts');
    expect(src).toContain('/partner/report');
    // Only window parameters may be sent.
    expect(src).toContain('params: { from?: string; to?: string; limit?: number }');
    expect(src).not.toContain('report: (partnerId');
  });

  it('the report type carries no monetary field', () => {
    const src = read('lib/partner-api.ts');
    const iface = src.slice(src.indexOf('export interface PartnerActivityReport'), src.indexOf('/** A partner'));
    for (const forbidden of ['amount', 'balance', 'profit', 'commission', 'payout', 'currency']) {
      expect(iface.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('the portal renders the report from the API with loading, error and empty states', () => {
    const src = read(PAGE);
    expect(src).toContain('partnerApi.report');
    expect(src).toContain('partner-report-loading');
    expect(src).toContain('partner-report-error');
    expect(src).toContain('partner-report-empty');
  });

  it('states truncation instead of silently dropping rows', () => {
    const src = read(PAGE);
    expect(src).toContain('partner-report-truncated');
    expect(src).toContain('report.data.truncated');
  });

  it('says plainly that the report is not a financial one', () => {
    expect(read(PAGE)).toContain('This is not a financial report');
  });
});
