import { AxiosError, type AxiosRequestHeaders, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEMO_BLOCKED_ERROR,
  apiClient,
  isDemoBlockedRequest,
  isDemoSessionMode,
  setAccessToken,
  setDemoSessionMode,
  setRefreshHandler,
} from './api-client';

/**
 * Phase 2C.15 — DEMO / REAL AUTH ISOLATION (redirect-loop hotfix).
 *
 * The bug: a demo login produced a client-only session that was indistinguishable from a real one, so
 * user-scoped queries 401'd → the global interceptor refreshed → refresh 401'd → the session was
 * marked unauthenticated → AuthGuard bounced to /login → demo login again. This file proves the
 * isolation at the transport layer:
 *
 *   B. A backend 401 can never destroy a demo session (no refresh, no state change).
 *   C. User-scoped endpoints are not reachable from a demo session at all.
 *   D. A REAL 401 still performs exactly ONE refresh and retries once.
 *   E. A REAL refresh failure still rejects (and the auth-session module logs the user out).
 *   F. Real-money endpoints are rejected locally for a demo session — it can never present itself
 *      to the backend as an authenticated player.
 *
 * The demo path is additive: every real-session assertion below is the pre-hotfix behaviour, unchanged.
 */

/** Build a minimal axios request config the interceptors will accept. */
function cfg(url: string, extra: Record<string, unknown> = {}): InternalAxiosRequestConfig {
  return { url, method: 'get', headers: {} as AxiosRequestHeaders, ...extra } as InternalAxiosRequestConfig;
}

/** A 401 AxiosError for `url`, as the response interceptor receives it. */
function unauthorized(url: string, config?: InternalAxiosRequestConfig): AxiosError {
  const c = config ?? cfg(url);
  return new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', c, {}, {
    status: 401,
    statusText: 'Unauthorized',
    data: { statusCode: 401, message: 'Unauthorized', error: 'UNAUTHORIZED' },
    headers: {},
    config: c,
  } as never);
}

/** Run the registered request interceptor chain over a config. */
async function runRequestInterceptor(config: InternalAxiosRequestConfig) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = (apiClient.interceptors.request as any).handlers.find((h: unknown) => h) as {
    fulfilled: (c: InternalAxiosRequestConfig) => unknown;
  };
  return handler.fulfilled(config);
}

/** Run the registered response-error interceptor over an error. */
async function runResponseErrorInterceptor(error: AxiosError) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handler = (apiClient.interceptors.response as any).handlers.find((h: unknown) => h) as {
    rejected: (e: AxiosError) => Promise<unknown>;
  };
  return handler.rejected(error);
}

beforeEach(() => {
  setDemoSessionMode(false);
  setAccessToken(null);
  setRefreshHandler(null);
});
afterEach(() => {
  setDemoSessionMode(false);
  setAccessToken(null);
});

describe('C/F — endpoints a demo session may never call', () => {
  const BLOCKED = [
    '/wallet',
    '/wallet/history?page=1',
    '/wallet-engine/balances',
    '/wallet-engine/transactions?limit=10',
    '/cashier/config',
    '/cashier/deposits',
    '/cashier/withdrawals?limit=20',
    '/users/me/verification',
    '/settings/security',
    '/recently-played?limit=12',
    '/recently-played/game-1',
    '/games/history?page=1',
    '/games/history/round-1',
    '/games/recommended?limit=12',
    '/ai/for-you',
    '/favorites?page=1',
    '/favorites/ids',
    '/referral',            // user-scoped referral attribution (Phase 2D.9)
    '/referral/claim',
    '/promotions',          // authenticated offer list (Phase 2D.9)
    '/games/dice/play', // ← the real-money bet
    '/games/blackjack/play',
    '/admin/wallet/credit',
    '/admin/finance/cash-flow', // Phase 2D.10 finance operations
    '/admin/finance/transactions',
    '/admin/bonuses',           // Phase 2D.10 operator bonus administration
    '/partner/members',
  ];

  const ALLOWED = [
    '/catalog',
    '/games/featured?limit=12',
    '/games/trending?limit=12',
    '/games/popular?limit=12',
    '/games/recently-added?limit=12',
    '/games/dice/config',
    '/games/slug-of-a-game',
    '/auth/login',
    '/auth/refresh',
    '/auth/logout',
  ];

  it.each(BLOCKED)('blocks %s', (url) => {
    expect(isDemoBlockedRequest(url)).toBe(true);
  });

  it.each(ALLOWED)('allows the public endpoint %s', (url) => {
    expect(isDemoBlockedRequest(url)).toBe(false);
  });

  it('normalizes absolute URLs and versioned base paths before matching', () => {
    expect(isDemoBlockedRequest('http://localhost:4000/api/v1/wallet')).toBe(true);
    expect(isDemoBlockedRequest('http://localhost:4000/api/v1/catalog')).toBe(false);
    expect(isDemoBlockedRequest('wallet')).toBe(true);
  });
});

describe('F — a demo session cannot reach a real-money endpoint', () => {
  it('rejects the request BEFORE it is put on the wire', async () => {
    setDemoSessionMode(true);
    await expect(runRequestInterceptor(cfg('/games/dice/play', { method: 'post' }))).rejects.toBe(
      DEMO_BLOCKED_ERROR,
    );
    await expect(runRequestInterceptor(cfg('/cashier/deposits', { method: 'post' }))).rejects.toBe(
      DEMO_BLOCKED_ERROR,
    );
    await expect(runRequestInterceptor(cfg('/wallet'))).rejects.toBe(DEMO_BLOCKED_ERROR);
  });

  it('never sends a bearer credential for a demo session, even on a public endpoint', async () => {
    setAccessToken('demo.cGxheWVy.session'); // a stale/placeholder token must never be presented
    setDemoSessionMode(true);
    const out = (await runRequestInterceptor(cfg('/catalog'))) as InternalAxiosRequestConfig;
    expect(out.headers.Authorization).toBeUndefined();
  });

  it('still lets a demo session read the PUBLIC catalog', async () => {
    setDemoSessionMode(true);
    const out = (await runRequestInterceptor(cfg('/catalog'))) as InternalAxiosRequestConfig;
    expect((out as { url?: string }).url).toBe('/catalog');
  });
});

describe('B — a backend 401 cannot destroy a demo session', () => {
  it('does NOT call the refresh handler on a 401 while in a demo session', async () => {
    const refresh = vi.fn(async () => 'NEW_TOKEN');
    setRefreshHandler(refresh);
    setDemoSessionMode(true);

    await expect(runResponseErrorInterceptor(unauthorized('/games/recommended'))).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(refresh).not.toHaveBeenCalled(); // ← no /auth/refresh ⇒ no setUnauthenticated ⇒ no /login
  });

  it('leaves the demo-session flag intact after repeated 401s', async () => {
    setRefreshHandler(vi.fn(async () => null));
    setDemoSessionMode(true);
    for (let i = 0; i < 5; i += 1) {
      await expect(runResponseErrorInterceptor(unauthorized('/wallet'))).rejects.toBeTruthy();
    }
    expect(isDemoSessionMode()).toBe(true);
  });
});

describe('D/E — REAL sessions keep the exact production 401 behaviour', () => {
  it('performs exactly ONE refresh for a real 401 and retries the request once', async () => {
    const refresh = vi.fn(async () => 'NEW_TOKEN');
    setRefreshHandler(refresh);
    setDemoSessionMode(false);

    const original = cfg('/wallet');
    const retried: InternalAxiosRequestConfig[] = [];
    // Intercept the retry: the interceptor calls apiClient(original) after a successful refresh.
    const adapter = vi.fn(async (c: InternalAxiosRequestConfig) => {
      retried.push(c);
      return { data: { data: 'ok' }, status: 200, statusText: 'OK', headers: {}, config: c };
    });
    apiClient.defaults.adapter = adapter as never;

    await runResponseErrorInterceptor(unauthorized('/wallet', original));

    expect(refresh).toHaveBeenCalledTimes(1); // exactly one refresh
    expect(retried).toHaveLength(1); // retried exactly once
    expect((retried[0].headers as Record<string, string>).Authorization).toBe('Bearer NEW_TOKEN');
    expect((original as { _authRetried?: boolean })._authRetried).toBe(true);
    apiClient.defaults.adapter = undefined as never;
  });

  it('never retries the same request twice (a second 401 rejects without refreshing again)', async () => {
    const refresh = vi.fn(async () => 'NEW_TOKEN');
    setRefreshHandler(refresh);
    const original = cfg('/wallet', { _authRetried: true });
    await expect(runResponseErrorInterceptor(unauthorized('/wallet', original))).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a failed refresh rejects the original request (the session is torn down by auth-session)', async () => {
    const refresh = vi.fn(async () => null); // refresh failed → setUnauthenticated() upstream
    setRefreshHandler(refresh);
    await expect(runResponseErrorInterceptor(unauthorized('/wallet'))).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('never refreshes on the refresh/logout endpoints themselves', async () => {
    const refresh = vi.fn(async () => 'NEW_TOKEN');
    setRefreshHandler(refresh);
    await expect(runResponseErrorInterceptor(unauthorized('/auth/refresh'))).rejects.toBeTruthy();
    await expect(runResponseErrorInterceptor(unauthorized('/auth/logout'))).rejects.toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a real session still presents its bearer token', async () => {
    setAccessToken('REAL_ACCESS');
    setDemoSessionMode(false);
    const out = (await runRequestInterceptor(cfg('/wallet'))) as InternalAxiosRequestConfig;
    expect(out.headers.Authorization).toBe('Bearer REAL_ACCESS');
  });
});
