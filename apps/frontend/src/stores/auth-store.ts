import { create } from 'zustand';

import { setAccessToken, setDemoSessionMode } from '@/lib/api-client';
import type { AuthUser } from '@/lib/auth-api';

/**
 * Explicit authentication lifecycle (Phase 2C.5). Replaces ambiguous boolean juggling with one
 * authoritative state. `initialized`/`isAuthenticated` are kept as derived views for back-compat.
 */
export type AuthStatus = 'bootstrapping' | 'authenticated' | 'unauthenticated' | 'refreshing' | 'logging-out';

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  /** The one authoritative auth lifecycle state. */
  status: AuthStatus;
  /** Derived: authenticated. */
  isAuthenticated: boolean;
  /** Derived: the initial bootstrap has resolved (guard may act). True unless BOOTSTRAPPING/REFRESHING. */
  initialized: boolean;
  /**
   * EXPLICIT demo-session marker (Phase 2C.15 hotfix). True only for a client-only demo session
   * created by `setDemoSession()`. Demo state is NEVER inferred from `isAuthenticated` (both kinds of
   * session set that) nor from the build-time `clientConfig.demoMode` (which is also on for a REAL
   * login in development). Every demo-vs-real decision in the app reads this field.
   */
  isDemoSession: boolean;
  setStatus: (status: AuthStatus) => void;
  setSession: (user: AuthUser, accessToken: string) => void;
  /** Start a client-only demo session: authenticated, explicitly marked demo, no backend session. */
  setDemoSession: (user: AuthUser) => void;
  setUser: (user: AuthUser) => void;
  setAccessToken: (token: string) => void;
  setInitialized: (value: boolean) => void;
  setUnauthenticated: () => void;
  clearSession: () => void;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
}

/**
 * Client auth state. The access token lives in memory only and is mirrored to
 * the Axios client; the refresh token is an httpOnly cookie, so a page reload
 * re-authenticates silently via the single-flight `bootstrapSession()`.
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: null,
  status: 'bootstrapping',
  isAuthenticated: false,
  initialized: false,
  isDemoSession: false,

  setStatus: (status) => set({ status, initialized: status !== 'bootstrapping' && status !== 'refreshing' }),

  setSession: (user, accessToken) => {
    setAccessToken(accessToken);
    setDemoSessionMode(false); // a real session: normal bearer auth + 401 refresh behaviour
    set({ user, accessToken, status: 'authenticated', isAuthenticated: true, initialized: true, isDemoSession: false });
  },

  setDemoSession: (user) => {
    // A demo session holds NO credential: `accessToken` stays null so the api-client never sends a
    // bearer header and every token-gated backend socket (wallet, crash, runtime, admin ops) stays
    // closed. A demo session must never present itself to the backend as an authenticated player.
    setAccessToken(null);
    setDemoSessionMode(true);
    set({ user, accessToken: null, status: 'authenticated', isAuthenticated: true, initialized: true, isDemoSession: true });
  },

  setUser: (user) => set({ user }),

  setAccessToken: (token) => {
    setAccessToken(token);
    // A fresh access token means we are authenticated; the bootstrap may still be fetching `me`.
    set({ accessToken: token, isAuthenticated: true });
  },

  setInitialized: (value) => set({ initialized: value }),

  setUnauthenticated: () => {
    setAccessToken(null);
    setDemoSessionMode(false);
    set({ user: null, accessToken: null, status: 'unauthenticated', isAuthenticated: false, initialized: true, isDemoSession: false });
  },

  clearSession: () => {
    setAccessToken(null);
    setDemoSessionMode(false);
    set({ user: null, accessToken: null, status: 'unauthenticated', isAuthenticated: false, initialized: true, isDemoSession: false });
  },

  hasPermission: (permission) => {
    const user = get().user;
    if (!user) return false;
    if (user.roles.includes('super_admin')) return true;
    return user.permissions.includes(permission);
  },

  hasRole: (role) => get().user?.roles.includes(role) ?? false,
}));
