import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  unwrap: async (p: Promise<{ data: { data: unknown } }>) => (await p).data.data,
}));

import { apiClient } from './api-client';
import { adminSettingsApi, settingsApi } from './settings-api';

/**
 * AD-09 settings client contract, plus structural proof that the admin screen exposes only the
 * server's allow-list and never money- or safety-affecting configuration.
 */

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const post = apiClient.post as unknown as ReturnType<typeof vi.fn>;
const ok = (data: unknown) => Promise.resolve({ data: { data } });

beforeEach(() => { get.mockReset(); post.mockReset(); });
afterEach(() => vi.clearAllMocks());

describe('settingsApi — contract', () => {
  it('reads the public subset from the unauthenticated route', async () => {
    get.mockReturnValueOnce(ok({ 'platform.support_email': 'a@b.test' }));
    const s = await settingsApi.publicSettings();
    expect(get.mock.calls[0][0]).toBe('/settings/public');
    expect(s['platform.support_email']).toBe('a@b.test');
  });

  it('sends ONLY a value when changing a setting', async () => {
    post.mockReturnValueOnce(ok({}));
    await adminSettingsApi.set('platform.support_email', 'ops@x.test');
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/admin/settings/platform.support_email');
    expect(Object.keys(body)).toEqual(['value']);
    // Type, visibility and description are SERVER facts and must never be client-supplied.
    for (const forbidden of ['type', 'isPublic', 'requiresRestart', 'description', 'key']) {
      expect(Object.keys(body)).not.toContain(forbidden);
    }
  });

  it('encodes the key so a dotted or odd key cannot break the path', async () => {
    post.mockReturnValueOnce(ok({}));
    await adminSettingsApi.set('platform.support response/hours', 1);
    expect(String(post.mock.calls[0][0])).toBe('/admin/settings/platform.support%20response%2Fhours');
  });

  it('reset posts to the reset route with no body fields', async () => {
    post.mockReturnValueOnce(ok({}));
    await adminSettingsApi.reset('platform.support_phone');
    expect(post.mock.calls[0][0]).toBe('/admin/settings/platform.support_phone/reset');
    expect(post.mock.calls[0][1]).toEqual({});
  });

  it('preserves a boolean and a number without stringifying', async () => {
    post.mockReturnValue(ok({}));
    await adminSettingsApi.set('platform.maintenance_banner_enabled', true);
    await adminSettingsApi.set('platform.support_response_hours', 48);
    expect((post.mock.calls[0][1] as Record<string, unknown>).value).toBe(true);
    expect((post.mock.calls[1][1] as Record<string, unknown>).value).toBe(48);
  });
});

describe('the settings screen exposes only safe configuration', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const PAGE = 'app/admin/settings/page.tsx';

  it('renders from the API, not a hardcoded list', () => {
    const src = strip(read(PAGE));
    expect(src).toContain('adminSettingsApi.list');
    expect(src).toContain('adminSettingsApi.set');
    expect(src).toContain('adminSettingsApi.reset');
  });

  it('the placeholder is gone', () => {
    expect(read(PAGE)).not.toContain('Settings render here');
    expect(read(PAGE)).toContain('admin-settings');
  });

  it('hardcodes NO setting key at all — the list is whatever the server allows', () => {
    const src = strip(read(PAGE));
    // A key would appear as a quoted dotted identifier, e.g. 'platform.support_email'. The page
    // must render whatever the server returns, so it should contain none.
    const hardcodedKeys = src.match(/'[a-z][a-z0-9_]*\.[a-z0-9_.]+'/g) ?? [];
    expect(hardcodedKeys).toEqual([]);
  });

  it('offers no CONTROL for money- or safety-affecting configuration', () => {
    const src = strip(read(PAGE));
    // These may be NAMED in the explanatory notice (that is the point of it), but must never appear
    // as a variant scope or an env-style key the screen could write.
    for (const forbidden of [
      'dice-variant', 'crash-variant', 'roulette-variant', 'card-variant',
      'RG_LIMIT_INCREASE_DELAY_HOURS', 'SESSION_IDLE_TIMEOUT_MINUTES',
      'CASHIER_LARGE_WITHDRAWAL_THRESHOLD',
    ]) {
      expect(src).not.toContain(forbidden);
    }
  });

  it('states plainly what it deliberately cannot edit', () => {
    const src = read(PAGE);
    expect(src).toContain('settings-excluded');
    expect(src).toContain('Not editable here, by design');
    expect(src).toContain('money- or');
  });

  it('hides write controls without permission and says the server decides', () => {
    const src = read(PAGE);
    expect(src).toContain('mayWrite');
    expect(src).toContain('The server refuses writes from this account');
  });

  it('tells the operator a refused change was NOT applied', () => {
    expect(read(PAGE)).toContain('was NOT applied');
  });

  it('surfaces requiresRestart when the server reports it', () => {
    expect(read(PAGE)).toContain('requiresRestart');
    expect(read(PAGE)).toContain('restart is required');
  });

  it('has loading, error and empty states with >=44px targets', () => {
    const src = read(PAGE);
    expect(src).toContain('settings-loading');
    expect(src).toContain('settings-error');
    expect(src).toContain('settings-empty');
    expect(src).toContain('minHeight: 44');
  });

  it('long keys and descriptions wrap rather than widening the page', () => {
    const src = read(PAGE);
    expect(src).toContain("overflowWrap: 'anywhere'");
    expect(src).toContain('minWidth: 0');
  });
});

describe('the support page consumes REAL server settings', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const SUPPORT = 'app/(dashboard)/support/page.tsx';

  it('reads contact details from the server, with env only as a fallback', () => {
    const src = read(SUPPORT);
    expect(src).toContain('settingsApi.publicSettings');
    expect(src).toContain("platform.support_email");
    // The env value survives only as a fallback for a deployment that has not set the setting.
    expect(src).toContain('ENV_SUPPORT_EMAIL');
  });

  it('renders a server-driven maintenance banner only when enabled AND a message exists', () => {
    const src = read(SUPPORT);
    expect(src).toContain('maintenance-banner');
    expect(src).toContain('maintenanceOn && maintenanceMsg');
  });
});
