'use client';

import { useEffect } from 'react';

import { bootstrapSession } from '@/lib/auth-session';
import { clientConfig } from '@/lib/config';
import { createDemoSession, DEMO_SESSION_KEY } from '@/lib/demo-session';
import { useAuthStore } from '@/stores/auth-store';
import { usePlayerProfile } from '@/stores/player-profile';

/**
 * On first mount, attempts a silent refresh using the httpOnly refresh cookie
 * and hydrates the session. In demo mode, if a persisted demo session flag is
 * present (set at demo login), it restores that session instead — so a page
 * reload keeps the demo player signed in. Renders nothing.
 */
export function AuthInitializer() {
  useEffect(() => {
    const store = useAuthStore.getState();

    // Demo fast-path: a persisted demo session is authoritative and available
    // synchronously in localStorage (set at guest login, cleared on logout).
    // Restore it immediately so the guarded shell paints on the first commit
    // instead of blocking behind a doomed backend /auth/refresh round-trip
    // (which has no backend in demo mode and only fails after a network
    // timeout). Real sessions — no demo flag — still refresh via the backend.
    const demoEmail =
      clientConfig.demoMode && typeof window !== 'undefined'
        ? window.localStorage.getItem(DEMO_SESSION_KEY)
        : null;
    if (demoEmail) {
      const { user } = createDemoSession(demoEmail);
      store.setDemoSession(user); // restored demo session stays explicitly demo
      usePlayerProfile.getState().setUsername(demoEmail.split('@')[0] || 'player');
      return;
    }

    // Real session: single-flight, idempotent bootstrap. Safe under StrictMode / remounts — one
    // refresh, one `/me`, no reuse-detection revocation. The guard waits on the resulting state.
    void bootstrapSession();
  }, []);

  return null;
}
