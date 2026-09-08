'use client';

import { Spinner } from '@gaming-platform/ui';
import Link from 'next/link';

import { canAccessPartnerPortal } from '@/lib/partner-access';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Partner portal route guard (Phase 2D.4, PA-01).
 *
 * Mirrors `AdminGuard`'s contract deliberately, so the codebase has one shell-guard pattern rather
 * than two: while the session bootstrap runs, render the neutral loading shell — never children, and
 * never a login flash.
 *
 * **THE BACKEND REMAINS THE AUTHORITY.** This never grants access to data; it only declines to paint
 * an interface the caller is not entitled to. Every partner request is independently re-authorized
 * server-side, verified live: a player, a moderator, and a partner reaching *another* partner's
 * resources all receive 403.
 *
 * Keyed on the `partners:read_own` PERMISSION (not a role name), which is exactly what the backend
 * controller requires — so the shell and the API can never disagree about who is a partner.
 */
export function PartnerGuard({ children }: { children: React.ReactNode }) {
  const initialized = useAuthStore((s) => s.initialized);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoSession = useAuthStore((s) => s.isDemoSession);
  const user = useAuthStore((s) => s.user);

  if (!initialized || (isAuthenticated && !user)) {
    return (
      <div
        className="flex min-h-screen w-full flex-col items-center justify-center gap-3 overflow-x-hidden px-6"
        role="status"
        aria-live="polite"
        aria-busy="true"
        data-testid="partner-guard-loading"
      >
        <Spinner size={28} />
        <span className="text-sm text-muted-foreground">Checking permissions…</span>
      </div>
    );
  }

  // Unauthenticated is AuthGuard's job (it redirects to /login); this is belt-and-braces.
  if (!isAuthenticated) return null;

  if (!canAccessPartnerPortal(user, isDemoSession)) {
    return (
      <div
        data-testid="partner-forbidden"
        className="flex min-h-screen w-full flex-col items-center justify-center gap-4 overflow-x-hidden px-6 text-center"
        role="alert"
      >
        <div className="max-w-sm space-y-3">
          <h1 className="font-display text-xl font-bold tracking-tight">Not authorised</h1>
          <p className="text-sm text-muted-foreground">
            This area is for partner accounts. Your account is not linked to a partner organisation.
          </p>
          <Link
            href="/dashboard"
            className="inline-block rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
