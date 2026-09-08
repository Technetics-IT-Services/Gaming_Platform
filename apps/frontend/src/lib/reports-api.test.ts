import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({
  apiClient: { get: vi.fn() },
  unwrap: async (p: Promise<{ data: { data: unknown } }>) => (await p).data.data,
}));

import { apiClient } from './api-client';
import { REPORT_TYPES, reportsApi } from './reports-api';

/**
 * Phase 2D.7 — reports client contract, plus structural proof that the reports page is entirely
 * server-backed and honest about what it cannot show.
 *
 * This vitest project runs in the `node` environment with no DOM, so component rendering is covered
 * by the Playwright mobile run. What is asserted here is the API contract and the honesty
 * properties, which a render test could not prove anyway.
 */

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const ok = (data: unknown) => Promise.resolve({ data: { data } });

beforeEach(() => get.mockReset());
afterEach(() => vi.clearAllMocks());

describe('reportsApi — contract', () => {
  it('exposes exactly the six supported report types', () => {
    expect([...REPORT_TYPES]).toEqual([
      'financial', 'gaming', 'cashier', 'operations', 'users', 'security-audit',
    ]);
  });

  it('sends the report type and never a userId', async () => {
    get.mockReturnValueOnce(ok({ meta: {}, columns: [], rows: [] }));
    await reportsApi.build('financial', { from: '2026-01-01T00:00:00.000Z' });
    const url = get.mock.calls[0][0] as string;
    expect(url).toContain('/analytics/reports?');
    expect(url).toContain('type=financial');
    expect(url).toContain('from=');
    expect(url.toLowerCase()).not.toContain('userid');
    expect(url.toLowerCase()).not.toContain('role=');
    expect(url.toLowerCase()).not.toContain('permission');
  });

  it('omits empty filters rather than sending blanks', async () => {
    get.mockReturnValueOnce(ok({}));
    await reportsApi.build('gaming', { from: '2026-01-01T00:00:00.000Z', currency: '' });
    const url = get.mock.calls[0][0] as string;
    expect(url).toContain('from=');
    expect(url).not.toContain('currency=');
  });

  it('passes a currency filter through so a report stays currency-scoped', async () => {
    get.mockReturnValueOnce(ok({}));
    await reportsApi.build('financial', { currency: 'INR' });
    expect(get.mock.calls[0][0]).toContain('currency=INR');
  });

  it('lists report types from the server, not a hardcoded client list', async () => {
    get.mockReturnValueOnce(ok({ types: ['financial'] }));
    const res = await reportsApi.types();
    expect(get.mock.calls[0][0]).toBe('/analytics/reports/types');
    expect(res.types).toEqual(['financial']);
  });

  it('unwraps the standard envelope into the report payload', async () => {
    get.mockReturnValueOnce(ok({
      meta: { reportType: 'users', timezone: 'UTC', rowCount: 1 },
      columns: ['metric', 'basis', 'value'],
      rows: [['registered', 'point_in_time', 1826]],
    }));
    const r = await reportsApi.build('users');
    expect(r.meta.timezone).toBe('UTC');
    expect(r.rows[0]![2]).toBe(1826);
  });

  it('preserves a null cell as null — the UI must be able to distinguish it from 0', async () => {
    get.mockReturnValueOnce(ok({
      meta: {}, columns: ['metric', 'basis', 'value'],
      rows: [['deposit_conversion_rate', 'in_range', null]],
    }));
    const r = await reportsApi.build('users');
    expect(r.rows[0]![2]).toBeNull();
    expect(r.rows[0]![2]).not.toBe(0);
  });
});

describe('reportsApi — CSV export', () => {
  it('requests a blob from the export route with the same filters', async () => {
    get.mockReturnValueOnce(Promise.resolve({ data: new Blob(['a,b\n1,2']), headers: {} }));
    // jsdom is not present in this project; stub only what the download path touches.
    const created: string[] = [];
    vi.stubGlobal('URL', {
      createObjectURL: () => { created.push('url'); return 'blob:x'; },
      revokeObjectURL: () => { /* released */ },
    });
    vi.stubGlobal('document', {
      createElement: () => ({ href: '', download: '', click: () => {}, remove: () => {} }),
      body: { appendChild: () => {} },
    });
    vi.stubGlobal('Blob', class { constructor(public parts: unknown[]) {} } as unknown as typeof Blob);

    const name = await reportsApi.exportCsv('cashier', { currency: 'INR' });

    const [url, cfg] = get.mock.calls[0] as [string, { responseType: string }];
    expect(url).toContain('/analytics/reports/export.csv?');
    expect(url).toContain('type=cashier');
    expect(url).toContain('currency=INR');
    // A blob response, NOT a plain navigation — the route needs an Authorization header.
    expect(cfg.responseType).toBe('blob');
    expect(name).toBe('cashier-report.csv');
    expect(created).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('uses the filename the SERVER chose when it supplies one', async () => {
    get.mockReturnValueOnce(Promise.resolve({
      data: new Blob(['x']),
      headers: { 'content-disposition': 'attachment; filename="gaming-2026-01-01_to_2026-02-01.csv"' },
    }));
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
    vi.stubGlobal('document', {
      createElement: () => ({ href: '', download: '', click: () => {}, remove: () => {} }),
      body: { appendChild: () => {} },
    });
    vi.stubGlobal('Blob', class { constructor(public parts: unknown[]) {} } as unknown as typeof Blob);

    expect(await reportsApi.exportCsv('gaming')).toBe('gaming-2026-01-01_to_2026-02-01.csv');
    vi.unstubAllGlobals();
  });
});

describe('the reports page is server-backed and honest', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const PAGE = 'app/admin/reports/page.tsx';

  it('has no demo dependency of any kind', () => {
    const src = strip(read(PAGE));
    expect(src).not.toContain("from '@/stores/demo-wallet'");
    expect(src).not.toContain('useDemoWallet(');
    expect(src).not.toContain('demo-games');
    expect(src).not.toContain('prototype');
    expect(src).not.toContain('mockData');
  });

  it('renders from the API, not from a hardcoded dataset', () => {
    const src = strip(read(PAGE));
    expect(src).toContain('reportsApi.build');
    expect(src).toContain('reportsApi.exportCsv');
  });

  it('shows "Not available" for a null cell instead of a fabricated zero', () => {
    const src = read(PAGE);
    // Rendered as JSX text in the null branch, so assert the branch AND the text it produces.
    expect(src).toContain('cell === null');
    expect(src).toContain('>Not available<');
  });

  it('surfaces the server-declared unavailable metrics with their reasons', () => {
    const src = read(PAGE);
    expect(src).toContain('report-unavailable');
    expect(src).toContain('meta.unavailable');
    expect(src).toContain('deliberately not displayed as zero');
  });

  it('shows the metric definitions that shipped with the report', () => {
    expect(read(PAGE)).toContain('report-definitions');
    expect(read(PAGE)).toContain('meta.definitions');
  });

  it('states the UTC basis and the per-currency rule to the operator', () => {
    const src = read(PAGE);
    expect(src).toContain('All times UTC');
    expect(src).toContain('never combined');
  });

  it('is gated on a REAL session (a demo session cannot reach reports)', () => {
    expect(read(PAGE)).toContain('useRealSession');
  });

  it('blocks /analytics (which reports live under) for demo sessions at the transport layer', () => {
    expect(read('lib/api-client.ts')).toContain('/^\\/analytics');
  });

  it('has explicit loading, error, empty and exporting states', () => {
    const src = read(PAGE);
    expect(src).toContain('report-loading');
    expect(src).toContain('report-error');
    expect(src).toContain('report-empty');
    expect(src).toContain('Exporting…');
  });

  it('distinguishes an empty result from a zero measurement in words', () => {
    expect(read(PAGE)).toContain('not a zero measurement');
  });

  it('keeps wide tables inside their own horizontal scroller (mobile safety)', () => {
    const src = read(PAGE);
    expect(src).toContain("overflowX: 'auto'");
    expect(src).toContain('minWidth: 0');
  });

  it('uses >=44px touch targets on filters, tabs and the export button', () => {
    const src = read(PAGE);
    expect(src.match(/minHeight: 44/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it('never renders report content as HTML', () => {
    expect(read(PAGE)).not.toContain('dangerouslySetInnerHTML');
  });

  it('does not reformat or recompute money on the client', () => {
    const src = strip(read(PAGE));
    // Values are rendered as received; no client-side arithmetic or currency conversion.
    expect(src).not.toContain('toFixed(');
    expect(src).not.toContain('parseFloat(');
    expect(src).not.toContain('Number(cell');
    expect(src).not.toContain('exchangeRate');
  });
});

describe('the admin shell fix from Phase 2D.6 is not regressed', () => {
  it('keeps min-w-0 on the admin shell column', () => {
    const layout = readFileSync(join(process.cwd(), 'src/app/admin/layout.tsx'), 'utf8');
    expect(layout).toContain('min-w-0');
  });
});
