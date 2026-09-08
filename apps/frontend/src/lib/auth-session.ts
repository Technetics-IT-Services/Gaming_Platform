import { apiClient, setAccessToken, setRefreshHandler } from './api-client';
import { authApi } from './auth-api';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Single-flight session bootstrap + refresh (Phase 2C.5).
 *
 * The backend refresh endpoint ROTATES the refresh token and burns the whole session family if an
 * already-rotated token is presented again (reuse detection). So the client must ensure **exactly
 * one** refresh is ever in flight and that startup bootstrap runs **once** — otherwise a double/
 * concurrent refresh (StrictMode, remount, parallel 401s) revokes the session and the guard bounces
 * the user to /login. This module provides that guarantee without touching backend security, without
 * storing the refresh token in JS, and without trusting client claims for authorization (identity
 * always comes from the backend `/auth/me`).
 */

// One shared in-flight refresh; concurrent callers await the same promise.
let refreshPromise: Promise<string | null> | null = null;
// One shared bootstrap; StrictMode / remounts reuse it instead of re-refreshing.
let bootstrapPromise: Promise<void> | null = null;
// Set on explicit logout; blocks any in-flight/queued refresh from resurrecting the session until
// the next successful login. Reset by a full page reload (module re-init) or `notifyLogin()`.
let loggedOut = false;

/** Single-flight refresh. Returns the new access token, or null if the session could not be restored. */
export function refreshSession(): Promise<string | null> {
  if (loggedOut) return Promise.resolve(null);
  // Demo sessions are client-only: there is no refresh cookie to rotate. Refreshing would 401 and the
  // failure branch below would call setUnauthenticated(), destroying the demo session and bouncing the
  // player back to /login (Phase 2C.15 redirect loop). Resolve null WITHOUT touching the session.
  if (useAuthStore.getState().isDemoSession) return Promise.resolve(null);
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      // `skipAuthRefresh` prevents the 401 interceptor from recursively refreshing this call.
      const res = await apiClient.post('/auth/refresh', {}, { skipAuthRefresh: true } as never);
      const token = (res.data as { data: { accessToken: string } }).data.accessToken;
      if (loggedOut) { setAccessToken(null); return null; } // logged out mid-flight — discard
      setAccessToken(token);
      useAuthStore.getState().setAccessToken(token);
      return token;
    } catch {
      // Refresh failed (missing/expired/revoked cookie) → the session is unauthenticated.
      // …UNLESS a demo session was started while this refresh was in flight (e.g. the bootstrap
      // fired on /login, the player then signed in as a guest). Tearing that session down here is
      // exactly what produced the Phase 2C.15 redirect loop, so re-check the flag before clearing.
      if (useAuthStore.getState().isDemoSession) return null;
      setAccessToken(null);
      useAuthStore.getState().setUnauthenticated();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/** Idempotent startup bootstrap: restore the session from the refresh cookie, or resolve unauthenticated. */
export function bootstrapSession(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  // A restored demo session is already authoritative — never overwrite it with a backend bootstrap.
  if (useAuthStore.getState().isDemoSession) return Promise.resolve();
  bootstrapPromise = (async () => {
    const store = useAuthStore.getState();
    store.setStatus('bootstrapping');
    const token = await refreshSession();
    // A demo session may have been created while this bootstrap was awaiting the network (the
    // bootstrap starts on /login; a guest sign-in resolves synchronously). It is authoritative —
    // never overwrite it with the bootstrap's outcome.
    if (useAuthStore.getState().isDemoSession) return;
    if (!token) {
      store.setUnauthenticated();
      return;
    }
    try {
      const user = await authApi.me(); // authoritative identity from the backend
      store.setSession(user, token);
    } catch {
      // A valid refresh but /me failed — treat as unauthenticated rather than a half-session.
      if (useAuthStore.getState().isDemoSession) return;
      setAccessToken(null);
      store.setUnauthenticated();
    }
  })();
  return bootstrapPromise;
}

/** Explicit logout: server revokes the session + clears the cookie; the client clears its state. */
export async function logoutSession(): Promise<void> {
  const store = useAuthStore.getState();
  const wasDemo = store.isDemoSession;
  store.setStatus('logging-out');
  loggedOut = true;
  // A demo session has nothing to revoke server-side; calling /auth/logout would only 401. Clear it
  // locally — which is authoritative for a client-only session.
  if (wasDemo) {
    setAccessToken(null);
    store.clearSession();
    return;
  }
  try {
    await authApi.logout();
  } catch {
    /* even if the network call fails, the local session is cleared below */
  }
  setAccessToken(null);
  store.clearSession();
}

/** Clear the logout latch after a fresh, explicit login so future refreshes are allowed again. */
export function notifyLogin(): void {
  loggedOut = false;
  bootstrapPromise = null;
}

/** Test-only: reset the module singletons between tests. */
export function __resetAuthSessionForTests(): void {
  refreshPromise = null;
  bootstrapPromise = null;
  loggedOut = false;
}

// Register the single-flight refresh as the api-client's 401 handler (no import cycle: api-client
// does not import this module).
setRefreshHandler(refreshSession);
