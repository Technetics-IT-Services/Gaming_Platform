import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({
  apiClient: { get: vi.fn(), patch: vi.fn() },
  unwrap: async (p: Promise<{ data: { data: unknown } }>) => (await p).data.data,
}));

import { apiClient } from './api-client';
import { notificationsApi } from './notifications-api';

/**
 * Phase 2D.1 — the notification client contract, plus structural proof that the notification surface
 * is 100% server-backed. This vitest project runs in the `node` environment with no DOM, so component
 * rendering is covered by the Playwright mobile run; what is asserted here is the API contract and the
 * dependency properties, which a render test could not prove anyway.
 */

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const patch = apiClient.patch as unknown as ReturnType<typeof vi.fn>;
const ok = (data: unknown) => Promise.resolve({ data: { data } });

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('notificationsApi — endpoints and contract', () => {
  it('lists with pagination and never sends a userId', async () => {
    get.mockReturnValueOnce(ok({ items: [], total: 0, page: 1, limit: 20, pages: 0, unread: 0 }));
    await notificationsApi.list({ page: 2, limit: 20 });
    const url = get.mock.calls[0][0] as string;
    expect(url).toContain('/notifications');
    expect(url).toContain('page=2');
    expect(url).toContain('limit=20');
    // Recipient is derived server-side from the JWT — the client must never assert identity.
    expect(url.toLowerCase()).not.toContain('userid');
  });

  it('list with no params hits the bare collection route', async () => {
    get.mockReturnValueOnce(ok({ items: [], total: 0, page: 1, limit: 20, pages: 0, unread: 0 }));
    await notificationsApi.list();
    expect(get.mock.calls[0][0]).toBe('/notifications');
  });

  it('unreadCount uses the dedicated endpoint and returns the server number', async () => {
    get.mockReturnValueOnce(ok({ unread: 4 }));
    const res = await notificationsApi.unreadCount();
    expect(get.mock.calls[0][0]).toBe('/notifications/unread-count');
    expect(res.unread).toBe(4);
  });

  it('markRead PATCHes the single-notification route', async () => {
    patch.mockReturnValueOnce(ok({ id: 'n1', read: true }));
    await notificationsApi.markRead('n1');
    expect(patch.mock.calls[0][0]).toBe('/notifications/n1/read');
  });

  it('markAllRead PATCHes the collection route', async () => {
    patch.mockReturnValueOnce(ok({ updated: 3 }));
    const res = await notificationsApi.markAllRead();
    expect(patch.mock.calls[0][0]).toBe('/notifications/read-all');
    expect(res.updated).toBe(3);
  });

  it('unwraps the standard API envelope into the page payload', async () => {
    get.mockReturnValueOnce(ok({ items: [{ id: 'n1', title: 'Deposit successful' }], total: 1, page: 1, limit: 20, pages: 1, unread: 1 }));
    const page = await notificationsApi.list();
    expect(page.items[0]!.title).toBe('Deposit successful');
    expect(page.unread).toBe(1);
  });
});

describe('notification surface is server-backed only (no fabricated data)', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const SURFACE = [
    'app/(dashboard)/notifications/page.tsx',
    'components/shared/notifications-menu.tsx',
    'lib/notifications-api.ts',
  ];

  it.each(SURFACE)('%s has no demo-wallet dependency', (f) => {
    const src = strip(read(f));
    expect(src).not.toContain("from '@/stores/demo-wallet'");
    expect(src).not.toContain('useDemoWallet(');
  });

  it('the page no longer holds a hardcoded notification array', () => {
    const src = strip(read('app/(dashboard)/notifications/page.tsx'));
    // The previous implementation declared `const NOTIFICATIONS: Notification[] = [ ... ]`.
    expect(src).not.toMatch(/const NOTIFICATIONS\s*[:=]/);
    expect(src).toContain('notificationsApi.list');
  });

  it('the bell reads the real unread count rather than a permanent fake badge', () => {
    const src = strip(read('components/shared/notifications-menu.tsx'));
    expect(src).toContain('notificationsApi.unreadCount');
    expect(src).not.toMatch(/const NOTES\s*=/);
    // The badge is conditional on a real count, not always rendered.
    expect(src).toContain('unread > 0');
  });

  it('the page renders honest loading, empty and error states', () => {
    const src = read('app/(dashboard)/notifications/page.tsx');
    expect(src).toContain('notifications-loading');
    expect(src).toContain('notifications-empty');
    expect(src).toContain('notifications-error');
  });

  it('notification bodies are rendered as TEXT, never as HTML (XSS safety)', () => {
    for (const f of SURFACE) {
      expect(read(f)).not.toContain('dangerouslySetInnerHTML');
    }
  });

  it('user-scoped notification queries are gated on a REAL session', () => {
    for (const f of ['app/(dashboard)/notifications/page.tsx', 'components/shared/notifications-menu.tsx']) {
      expect(read(f)).toContain('useRealSession');
    }
  });

  it('the UI does not claim email/SMS/push delivery', () => {
    const page = read('app/(dashboard)/notifications/page.tsx');
    expect(page).toContain('not configured for this deployment');
  });
});
