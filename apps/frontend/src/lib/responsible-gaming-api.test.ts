import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  unwrap: async (p: Promise<{ data: { data: unknown } }>) => (await p).data.data,
}));

import { apiClient } from './api-client';
import { LIMIT_PERIODS, LIMIT_TYPES, responsibleGamingApi } from './responsible-gaming-api';

/**
 * Responsible gaming client contract, plus structural proof that the UI presents SERVER-enforced
 * protection and never a client-side imitation of it.
 */

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const post = apiClient.post as unknown as ReturnType<typeof vi.fn>;
const del = apiClient.delete as unknown as ReturnType<typeof vi.fn>;
const ok = (data: unknown) => Promise.resolve({ data: { data } });

beforeEach(() => { get.mockReset(); post.mockReset(); del.mockReset(); });
afterEach(() => vi.clearAllMocks());

describe('responsibleGamingApi — contract', () => {
  it('exposes the three limit types and three periods the server supports', () => {
    expect([...LIMIT_TYPES]).toEqual(['DEPOSIT', 'WAGER', 'LOSS']);
    expect([...LIMIT_PERIODS]).toEqual(['DAILY', 'WEEKLY', 'MONTHLY']);
  });

  it('reads the overview from the server and never sends a userId', async () => {
    get.mockReturnValueOnce(ok({ limits: [], restrictions: [] }));
    await responsibleGamingApi.overview();
    const url = get.mock.calls[0][0] as string;
    expect(url).toBe('/responsible-gaming');
    expect(url.toLowerCase()).not.toContain('userid');
  });

  it('posts a limit with its type, period, amount and currency', async () => {
    post.mockReturnValueOnce(ok({ type: 'WAGER', period: 'DAILY', amount: '100', currency: 'INR', effectiveFrom: '2026-01-01T00:00:00.000Z' }));
    await responsibleGamingApi.setLimit({ type: 'WAGER', period: 'DAILY', amount: '100', currency: 'INR' });
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/responsible-gaming/limits');
    expect(body).toEqual({ type: 'WAGER', period: 'DAILY', amount: '100', currency: 'INR' });
    // Identity is the server's business — the client must never assert whose limit this is.
    expect(Object.keys(body)).not.toContain('userId');
  });

  it('keeps the amount as a STRING so a decimal is never floated', async () => {
    post.mockReturnValueOnce(ok({}));
    await responsibleGamingApi.setLimit({ type: 'LOSS', period: 'WEEKLY', amount: '1250.75', currency: 'INR' });
    expect((post.mock.calls[0][1] as Record<string, unknown>).amount).toBe('1250.75');
  });

  it('removes a limit by its identifying triple', async () => {
    del.mockReturnValueOnce(ok({ removed: true }));
    await responsibleGamingApi.removeLimit({ type: 'DEPOSIT', period: 'MONTHLY', currency: 'INR' });
    const url = del.mock.calls[0][0] as string;
    expect(url).toContain('type=DEPOSIT');
    expect(url).toContain('period=MONTHLY');
    expect(url).toContain('currency=INR');
  });

  it('self-exclusion sends no end date (indefinite)', async () => {
    post.mockReturnValueOnce(ok({ id: 'r1', type: 'SELF_EXCLUSION', status: 'ACTIVE', startsAt: '', endsAt: null, reason: null }));
    await responsibleGamingApi.createRestriction({ type: 'SELF_EXCLUSION' });
    expect(post.mock.calls[0][1]).toEqual({ type: 'SELF_EXCLUSION' });
  });

  it('cooling-off carries a real end date', async () => {
    post.mockReturnValueOnce(ok({}));
    const endsAt = new Date(Date.now() + 86_400_000).toISOString();
    await responsibleGamingApi.createRestriction({ type: 'COOLING_OFF', endsAt });
    expect((post.mock.calls[0][1] as Record<string, unknown>).endsAt).toBe(endsAt);
  });

  it('passes server usage figures through untouched', async () => {
    get.mockReturnValueOnce(ok({
      limits: [{ type: 'WAGER', period: 'DAILY', currency: 'INR', limit: '30', used: '30', remaining: '0', windowStart: '2026-01-01T00:00:00.000Z' }],
      restrictions: [],
    }));
    const o = await responsibleGamingApi.overview();
    expect(o.limits[0]!.used).toBe('30');
    expect(o.limits[0]!.remaining).toBe('0');
  });
});

describe('the responsible-gaming UI presents SERVER enforcement, not a client imitation', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const CONTROLS = 'components/account/responsible-gaming-controls.tsx';
  const PAGE = 'app/(dashboard)/responsible-gaming/page.tsx';

  it('calls the real API for every control', () => {
    const src = strip(read(CONTROLS));
    expect(src).toContain('responsibleGamingApi.setLimit');
    expect(src).toContain('responsibleGamingApi.removeLimit');
    expect(src).toContain('responsibleGamingApi.createRestriction');
    expect(src).toContain('responsibleGamingApi.overview');
  });

  it('holds no client-side limit state that could masquerade as enforcement', () => {
    const src = strip(read(CONTROLS));
    expect(src).not.toContain('localStorage');
    expect(src).not.toContain('sessionStorage');
    expect(src).not.toContain('setTimeout');
    expect(src).not.toContain('setInterval');
    expect(src).not.toContain('useDemoWallet');
  });

  it('does not compute usage or remaining headroom on the client', () => {
    const src = strip(read(CONTROLS));
    // Those figures come from the server, which derives them from authoritative financial tables.
    expect(src).not.toContain('l.limit -');
    expect(src).not.toContain('parseFloat(');
    expect(src).toContain('{l.used}');
    expect(src).toContain('{l.remaining}');
  });

  it('tells the user a failed save did NOT take effect', () => {
    expect(read(CONTROLS)).toContain('was NOT changed');
  });

  it('warns that a load failure does not mean limits are inactive', () => {
    expect(read(CONTROLS)).toContain('may still be active');
  });

  it('requires explicit confirmation before an indefinite self-exclusion', () => {
    const src = read(CONTROLS);
    expect(src).toContain('rg-exclude-confirm');
    expect(src).toContain('Only support can lift it');
  });

  it('states that withdrawals remain possible while restricted', () => {
    const src = read(CONTROLS);
    expect(src).toContain('still be able to withdraw');
    expect(src).toContain('You can still withdraw your balance');
  });

  it('uses >=44px touch targets on every control', () => {
    const src = read(CONTROLS);
    expect(src.match(/minHeight: 44/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it('has explicit loading and error states', () => {
    const src = read(CONTROLS);
    expect(src).toContain('rg-loading');
    expect(src).toContain('rg-error');
  });

  it('the page no longer claims these controls are unavailable', () => {
    const src = read(PAGE);
    // The old copy said self-set limits / exclusion / cooling-off did not exist. It would now be a lie.
    expect(src).not.toContain('self-exclusion and cooling-off are not yet');
    expect(src).toContain('ResponsibleGamingControls');
    expect(src).toContain('enforced by our');
  });

  it('still refuses to show a control the server cannot enforce', () => {
    // Session-time limits remain honestly excluded.
    expect(read(PAGE)).toContain('will not display a control the');
  });
});
