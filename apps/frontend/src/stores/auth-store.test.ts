import { beforeEach, describe, expect, it, vi } from 'vitest';

const { setAccessTokenSpy, setDemoSessionModeSpy } = vi.hoisted(() => ({
  setAccessTokenSpy: vi.fn(),
  setDemoSessionModeSpy: vi.fn(),
}));
vi.mock('@/lib/api-client', () => ({
  setAccessToken: setAccessTokenSpy,
  setDemoSessionMode: setDemoSessionModeSpy,
}));

import { useAuthStore } from './auth-store';

/**
 * Phase 2C.5 — the single authoritative auth state machine. `initialized` (the value AuthGuard waits
 * on) is DERIVED from `status`: it is false only while BOOTSTRAPPING/REFRESHING, so the guard never
 * redirects mid-restore. These transitions are exactly what the guard consumes.
 */
const reset = () => useAuthStore.setState({ user: null, accessToken: null, status: 'bootstrapping', isAuthenticated: false, initialized: false, isDemoSession: false });
beforeEach(() => { reset(); vi.clearAllMocks(); });

const user = { id: 'u1', username: 'p', roles: ['user'], permissions: ['wallets:read'] } as never;

describe('auth state machine', () => {
  it('starts BOOTSTRAPPING → guard must wait (initialized false, not authenticated)', () => {
    const s = useAuthStore.getState();
    expect(s.status).toBe('bootstrapping');
    expect(s.initialized).toBe(false);
    expect(s.isAuthenticated).toBe(false);
  });

  it('BOOTSTRAPPING / REFRESHING keep initialized false; terminal states set it true', () => {
    const { setStatus } = useAuthStore.getState();
    setStatus('refreshing'); expect(useAuthStore.getState().initialized).toBe(false);
    setStatus('bootstrapping'); expect(useAuthStore.getState().initialized).toBe(false);
    setStatus('unauthenticated'); expect(useAuthStore.getState().initialized).toBe(true);
    setStatus('authenticated'); expect(useAuthStore.getState().initialized).toBe(true);
  });

  it('setSession → AUTHENTICATED (guard renders children)', () => {
    useAuthStore.getState().setSession(user, 'ACCESS');
    const s = useAuthStore.getState();
    expect(s.status).toBe('authenticated');
    expect(s.isAuthenticated).toBe(true);
    expect(s.initialized).toBe(true);
    expect(s.user).toBe(user);
    expect(s.accessToken).toBe('ACCESS');
  });

  it('setUnauthenticated → UNAUTHENTICATED, cleared (guard redirects)', () => {
    useAuthStore.getState().setSession(user, 'ACCESS');
    useAuthStore.getState().setUnauthenticated();
    const s = useAuthStore.getState();
    expect(s.status).toBe('unauthenticated');
    expect(s.isAuthenticated).toBe(false);
    expect(s.initialized).toBe(true);
    expect(s.user).toBeNull();
    expect(s.accessToken).toBeNull();
  });

  it('clearSession is equivalent to unauthenticated + cleared', () => {
    useAuthStore.getState().setSession(user, 'ACCESS');
    useAuthStore.getState().clearSession();
    const s = useAuthStore.getState();
    expect(s.status).toBe('unauthenticated');
    expect(s.user).toBeNull();
    expect(s.accessToken).toBeNull();
  });

  it('hasPermission / hasRole read from the backend-provided user only', () => {
    useAuthStore.getState().setSession(user, 'ACCESS');
    expect(useAuthStore.getState().hasPermission('wallets:read')).toBe(true);
    expect(useAuthStore.getState().hasPermission('admin:everything')).toBe(false);
    expect(useAuthStore.getState().hasRole('user')).toBe(true);
    expect(useAuthStore.getState().hasRole('super_admin')).toBe(false);
  });
});

/**
 * Phase 2C.15 — DEMO SESSIONS ARE EXPLICIT. `isDemoSession` is a first-class field, never inferred
 * from `isAuthenticated` (both session kinds set it) nor from the build-time demo flag (which is also
 * on for a REAL login in development). A demo session additionally holds NO credential, so nothing in
 * the app can present it to the backend.
 */
describe('demo session isolation', () => {
  it('setDemoSession → AUTHENTICATED and explicitly marked demo, with NO access token', () => {
    useAuthStore.getState().setDemoSession(user);
    const s = useAuthStore.getState();
    expect(s.status).toBe('authenticated');
    expect(s.isAuthenticated).toBe(true);
    expect(s.initialized).toBe(true);
    expect(s.isDemoSession).toBe(true);
    expect(s.accessToken).toBeNull(); // ← no credential: no bearer header, no backend socket
    expect(setAccessTokenSpy).toHaveBeenCalledWith(null);
    expect(setDemoSessionModeSpy).toHaveBeenCalledWith(true); // api-client isolation armed
  });

  it('demo state is NOT inferable from isAuthenticated — a real session sets the same flag', () => {
    useAuthStore.getState().setSession(user, 'ACCESS');
    const real = useAuthStore.getState();
    expect(real.isAuthenticated).toBe(true);
    expect(real.isDemoSession).toBe(false); // ← the distinguishing bit
    expect(setDemoSessionModeSpy).toHaveBeenLastCalledWith(false);
  });

  it('a real login after a demo session clears the demo marker (and re-arms real auth)', () => {
    useAuthStore.getState().setDemoSession(user);
    useAuthStore.getState().setSession(user, 'ACCESS');
    const s = useAuthStore.getState();
    expect(s.isDemoSession).toBe(false);
    expect(s.accessToken).toBe('ACCESS');
    expect(setDemoSessionModeSpy).toHaveBeenLastCalledWith(false);
  });

  it('clearSession / setUnauthenticated always drop the demo marker', () => {
    useAuthStore.getState().setDemoSession(user);
    useAuthStore.getState().clearSession();
    expect(useAuthStore.getState().isDemoSession).toBe(false);
    expect(setDemoSessionModeSpy).toHaveBeenLastCalledWith(false);

    useAuthStore.getState().setDemoSession(user);
    useAuthStore.getState().setUnauthenticated();
    expect(useAuthStore.getState().isDemoSession).toBe(false);
    expect(setDemoSessionModeSpy).toHaveBeenLastCalledWith(false);
  });

  it('the gate every user-scoped query uses (isAuthenticated && !isDemoSession) is false for demo', () => {
    useAuthStore.getState().setDemoSession(user);
    const demo = useAuthStore.getState();
    expect(demo.isAuthenticated && !demo.isDemoSession).toBe(false); // ← C: no user-scoped queries

    useAuthStore.getState().setSession(user, 'ACCESS');
    const real = useAuthStore.getState();
    expect(real.isAuthenticated && !real.isDemoSession).toBe(true); // ← real sessions unaffected
  });
});
