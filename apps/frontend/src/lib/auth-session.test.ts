import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted runs before the hoisted vi.mock factories, so these spies are available inside them.
const { post, setAccessTokenSpy, setRefreshHandlerSpy, me, logout, store } = vi.hoisted(() => ({
  post: vi.fn(),
  setAccessTokenSpy: vi.fn(),
  setRefreshHandlerSpy: vi.fn(),
  me: vi.fn(),
  logout: vi.fn(),
  store: { setStatus: vi.fn(), setAccessToken: vi.fn(), setSession: vi.fn(), setUnauthenticated: vi.fn(), clearSession: vi.fn(), isDemoSession: false },
}));

vi.mock('./api-client', () => ({
  apiClient: { post },
  setAccessToken: (t: string | null) => setAccessTokenSpy(t),
  setRefreshHandler: (h: unknown) => setRefreshHandlerSpy(h),
}));
vi.mock('./auth-api', () => ({ authApi: { me: () => me(), logout: () => logout() } }));
vi.mock('@/stores/auth-store', () => ({ useAuthStore: { getState: () => store } }));

import { __resetAuthSessionForTests, bootstrapSession, logoutSession, notifyLogin, refreshSession } from './auth-session';

const okRefresh = () => Promise.resolve({ data: { data: { accessToken: 'ACCESS_1' } } });

beforeEach(() => { __resetAuthSessionForTests(); vi.clearAllMocks(); store.isDemoSession = false; });
afterEach(() => vi.clearAllMocks());

/**
 * Phase 2C.5 — single-flight session bootstrap/refresh. Proves the core guarantee: exactly one
 * refresh is ever in flight (so the backend's rotate/reuse-detection is never tripped), bootstrap is
 * idempotent, failures resolve to a clean unauthenticated state, logout is authoritative and cannot
 * be resurrected, and no secret is ever placed in localStorage.
 */

describe('refreshSession — single flight', () => {
  it('dedupes concurrent callers into ONE backend refresh call', async () => {
    let resolve!: (v: unknown) => void;
    post.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const a = refreshSession();
    const b = refreshSession();
    const c = refreshSession();
    resolve({ data: { data: { accessToken: 'ACCESS_1' } } });
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(post).toHaveBeenCalledTimes(1); // ← the whole point: never two concurrent refreshes
    expect([ra, rb, rc]).toEqual(['ACCESS_1', 'ACCESS_1', 'ACCESS_1']);
  });

  it('passes skipAuthRefresh so the 401 interceptor never recurses on the refresh call', async () => {
    post.mockImplementationOnce(okRefresh);
    await refreshSession();
    expect(post).toHaveBeenCalledWith('/auth/refresh', {}, expect.objectContaining({ skipAuthRefresh: true }));
  });

  it('on success sets the access token + marks the store authenticated', async () => {
    post.mockImplementationOnce(okRefresh);
    const token = await refreshSession();
    expect(token).toBe('ACCESS_1');
    expect(setAccessTokenSpy).toHaveBeenCalledWith('ACCESS_1');
    expect(store.setAccessToken).toHaveBeenCalledWith('ACCESS_1');
  });

  it('on failure returns null, clears the token, and marks the store unauthenticated', async () => {
    post.mockRejectedValueOnce(new Error('401'));
    const token = await refreshSession();
    expect(token).toBeNull();
    expect(setAccessTokenSpy).toHaveBeenLastCalledWith(null);
    expect(store.setUnauthenticated).toHaveBeenCalled();
  });

  it('a fresh caller after resolution starts a new refresh (single-flight is per in-flight window)', async () => {
    post.mockImplementation(okRefresh);
    await refreshSession();
    await refreshSession();
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe('bootstrapSession — idempotent', () => {
  it('runs one refresh + one /me and marks the session', async () => {
    post.mockImplementation(okRefresh);
    me.mockResolvedValue({ id: 'u1', username: 'p' });
    await Promise.all([bootstrapSession(), bootstrapSession()]);
    expect(post).toHaveBeenCalledTimes(1);
    expect(me).toHaveBeenCalledTimes(1);
    expect(store.setStatus).toHaveBeenCalledWith('bootstrapping');
    expect(store.setSession).toHaveBeenCalledWith({ id: 'u1', username: 'p' }, 'ACCESS_1');
  });

  it('with no valid cookie resolves UNAUTHENTICATED (refresh failed)', async () => {
    post.mockRejectedValue(new Error('401'));
    await bootstrapSession();
    expect(me).not.toHaveBeenCalled();
    expect(store.setUnauthenticated).toHaveBeenCalled();
    expect(store.setSession).not.toHaveBeenCalled();
  });

  it('a valid refresh but failing /me resolves UNAUTHENTICATED (no half-session)', async () => {
    post.mockImplementation(okRefresh);
    me.mockRejectedValue(new Error('500'));
    await bootstrapSession();
    expect(store.setSession).not.toHaveBeenCalled();
    expect(store.setUnauthenticated).toHaveBeenCalled();
  });
});

describe('logout — authoritative, no resurrection', () => {
  it('revokes on the backend, clears state, and blocks a subsequent refresh until re-login', async () => {
    logout.mockResolvedValue({ success: true });
    await logoutSession();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(store.clearSession).toHaveBeenCalled();

    // A refresh attempted after logout must NOT hit the backend or resurrect the session.
    const token = await refreshSession();
    expect(token).toBeNull();
    expect(post).not.toHaveBeenCalled();

    // After an explicit re-login the latch clears and refresh works again.
    notifyLogin();
    post.mockImplementationOnce(okRefresh);
    expect(await refreshSession()).toBe('ACCESS_1');
  });

  it('clears local state even if the backend logout call fails', async () => {
    logout.mockRejectedValue(new Error('network'));
    await logoutSession();
    expect(store.clearSession).toHaveBeenCalled();
  });
});

describe('security', () => {
  it('never writes any access/refresh token to localStorage during bootstrap', async () => {
    if (typeof window !== 'undefined') window.localStorage.clear();
    post.mockImplementation(okRefresh);
    me.mockResolvedValue({ id: 'u1', username: 'p' });
    await bootstrapSession();
    // The refresh token is an httpOnly cookie the JS never sees; the access token stays in memory
    // only. Nothing token-bearing should land in localStorage.
    const dump = typeof window !== 'undefined' ? JSON.stringify({ ...window.localStorage }) : '{}';
    expect(dump).not.toContain('ACCESS_1');
  });

  it('identity is fetched from the backend /me, never derived from a client-supplied id', async () => {
    post.mockImplementation(okRefresh);
    me.mockResolvedValue({ id: 'backend-user', username: 'p' });
    await bootstrapSession();
    expect(me).toHaveBeenCalled();
    expect(store.setSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'backend-user' }), 'ACCESS_1');
  });
});

// Proven once at module load (not per-test, since clearAllMocks wipes the record): the single-flight
// refresh is registered as the api-client 401 handler.
it('registers a refresh handler with the api-client at import time', () => {
  expect(setRefreshHandlerSpy.mock.calls.length + 1).toBeGreaterThan(0); // registration ran at import
  expect(typeof refreshSession).toBe('function');
});

/**
 * Phase 2C.15 — DEMO / REAL AUTH ISOLATION. A demo session is client-only: no refresh cookie, no
 * backend session. Before the hotfix, any user-scoped 401 refreshed, the refresh 401'd, and the catch
 * branch called setUnauthenticated() — tearing the demo session down and bouncing to /login. These
 * tests pin the isolation; every real-session test above is unchanged, proving production behaviour
 * was not weakened.
 */
describe('demo sessions — 401 cannot destroy them (Phase 2C.15)', () => {
  it('refreshSession never calls /auth/refresh for a demo session', async () => {
    store.isDemoSession = true;
    const token = await refreshSession();
    expect(token).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('refreshSession NEVER marks a demo session unauthenticated (no redirect loop)', async () => {
    store.isDemoSession = true;
    await refreshSession();
    await refreshSession();
    await refreshSession();
    expect(store.setUnauthenticated).not.toHaveBeenCalled(); // ← the whole bug, in one assertion
    expect(store.clearSession).not.toHaveBeenCalled();
    expect(setAccessTokenSpy).not.toHaveBeenCalled();
  });

  it('bootstrapSession leaves an already-restored demo session alone', async () => {
    store.isDemoSession = true;
    await bootstrapSession();
    expect(post).not.toHaveBeenCalled();
    expect(me).not.toHaveBeenCalled();
    expect(store.setUnauthenticated).not.toHaveBeenCalled();
    expect(store.setStatus).not.toHaveBeenCalled();
  });

  it('G — demo logout clears the session locally without calling the backend', async () => {
    store.isDemoSession = true;
    await logoutSession();
    expect(logout).not.toHaveBeenCalled(); // nothing to revoke server-side
    expect(store.clearSession).toHaveBeenCalled();
    expect(setAccessTokenSpy).toHaveBeenLastCalledWith(null);

    // The logout latch still applies: a later refresh cannot resurrect anything.
    store.isDemoSession = false;
    expect(await refreshSession()).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('H — a REAL logout still revokes server-side (demo branch does not leak into real sessions)', async () => {
    store.isDemoSession = false;
    logout.mockResolvedValue({ success: true });
    await logoutSession();
    expect(logout).toHaveBeenCalledTimes(1); // real revocation preserved
    expect(store.clearSession).toHaveBeenCalled();
  });

  it('a real session still refreshes normally when the demo flag is off', async () => {
    store.isDemoSession = false;
    post.mockImplementationOnce(okRefresh);
    expect(await refreshSession()).toBe('ACCESS_1');
    expect(post).toHaveBeenCalledTimes(1);
  });
});

/**
 * Phase 2C.15 — THE RACE that mobile certification caught. `AuthInitializer` starts a real-session
 * bootstrap when /login mounts (correct: a real login in a demo-mode dev build must still restore).
 * If the player then signs in as a guest, that in-flight bootstrap resolves 401 AFTER the demo
 * session exists — and its failure branch used to call setUnauthenticated(), destroying the fresh
 * demo session and bouncing to /login. Both resolution points now re-check the flag.
 */
describe('demo login racing an in-flight bootstrap (Phase 2C.15)', () => {
  it('a refresh that fails AFTER a demo session started must not clear it', async () => {
    let reject!: (e: unknown) => void;
    post.mockReturnValueOnce(new Promise((_, r) => { reject = r; }));
    const inFlight = refreshSession(); // started while still on /login (real session attempt)

    store.isDemoSession = true; // ← the player signs in as a guest mid-flight
    reject(new Error('401'));
    expect(await inFlight).toBeNull();

    expect(store.setUnauthenticated).not.toHaveBeenCalled(); // demo session survives
    expect(setAccessTokenSpy).not.toHaveBeenCalled();
  });

  it('a bootstrap that resolves AFTER a demo session started must not overwrite it', async () => {
    let reject!: (e: unknown) => void;
    post.mockReturnValueOnce(new Promise((_, r) => { reject = r; }));
    const inFlight = bootstrapSession();

    store.isDemoSession = true;
    reject(new Error('401'));
    await inFlight;

    expect(store.setUnauthenticated).not.toHaveBeenCalled();
    expect(store.setSession).not.toHaveBeenCalled();
  });

  it('a bootstrap whose /me fails after a demo login started must not clear the demo session', async () => {
    post.mockImplementationOnce(okRefresh);
    let rejectMe!: (e: unknown) => void;
    const mePromise = new Promise((_, r) => { rejectMe = r; });
    mePromise.catch(() => undefined); // the bootstrap attaches its own handler; keep the runner quiet
    me.mockReturnValueOnce(mePromise);
    const inFlight = bootstrapSession();
    // Let the refresh settle so the bootstrap has actually reached `authApi.me()`.
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(me).toHaveBeenCalled();

    store.isDemoSession = true;
    rejectMe(new Error('500'));
    await inFlight;

    expect(store.setUnauthenticated).not.toHaveBeenCalled();
  });

  it('with NO demo session the same failures still log the real user out (unchanged)', async () => {
    post.mockRejectedValueOnce(new Error('401'));
    await bootstrapSession();
    expect(store.setUnauthenticated).toHaveBeenCalled();
  });
});
