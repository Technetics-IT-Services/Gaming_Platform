'use client';

import { useAuthStore } from '@/stores/auth-store';

/**
 * The gate every USER-SCOPED backend query must use (Phase 2C.15 hotfix).
 *
 * `isAuthenticated` alone is not enough: a demo session sets it too, but has no backend session, so
 * user-scoped requests 401 → refresh → 401 → session torn down → redirect loop. A "real session" is
 * an authenticated session that is NOT a demo session — the only kind that may talk to user-scoped or
 * real-money endpoints.
 *
 * Public/catalog queries (featured, trending, popular, categories, `/catalog`, game configs) must NOT
 * be gated on this — they work for demo sessions too.
 */
export function useRealSession(): boolean {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoSession = useAuthStore((s) => s.isDemoSession);
  return isAuthenticated && !isDemoSession;
}

/** True when the current session is the client-only demo session. */
export function useIsDemoSession(): boolean {
  return useAuthStore((s) => s.isDemoSession);
}
