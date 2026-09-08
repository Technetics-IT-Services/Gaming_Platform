'use client';

import { Spinner } from '@gaming-platform/ui';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useAuthStore } from '@/stores/auth-store';

/**
 * Client-side route guard for authenticated sections (Phase 1.1, hardened in Phase 2C.5).
 *
 * Reuses the single authoritative auth store. It NEVER redirects while the session bootstrap is
 * still running (`initialized === false`, i.e. status BOOTSTRAPPING/REFRESHING) — it renders a
 * lightweight, overflow-safe mobile shell instead. Only once bootstrap resolves does it act:
 * UNAUTHENTICATED → /login, AUTHENTICATED → the page. This prevents the login-flash / premature
 * redirect that a rotating, reuse-detecting refresh could otherwise cause.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const initialized = useAuthStore((s) => s.initialized);

  useEffect(() => {
    if (initialized && !isAuthenticated) router.replace('/login');
  }, [initialized, isAuthenticated, router]);

  // BOOTSTRAPPING / REFRESHING — wait. A minimal, centered shell: no protected content, no login
  // flash, no layout shift, and no horizontal overflow at mobile widths.
  if (!initialized) {
    return (
      <div
        className="flex min-h-screen w-full flex-col items-center justify-center gap-3 overflow-x-hidden px-6"
        role="status"
        aria-live="polite"
        aria-busy="true"
        data-testid="auth-loading"
      >
        <Spinner size={28} />
        <span className="text-sm text-muted-foreground">Restoring your session…</span>
      </div>
    );
  }

  if (!isAuthenticated) return null; // redirecting to /login

  return <>{children}</>;
}
