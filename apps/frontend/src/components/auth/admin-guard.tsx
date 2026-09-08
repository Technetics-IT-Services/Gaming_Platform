'use client';

import { Spinner } from '@gaming-platform/ui';
import Link from 'next/link';

import { canAccessAdminConsole } from '@/lib/admin-access';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Admin console route guard (Phase 2C.17, P0-2).
 *
 * Before this existed, `app/admin/layout.tsx` used `AuthGuard` alone — which only checks
 * *authentication* — so ANY signed-in player (and, in a demo-mode build, any guest) could load every
 * admin page shell, sidebar and route. The backend was never breached (all 17 admin controllers are
 * permission-guarded and `JwtAuthGuard`/`RolesGuard`/`PermissionsGuard` are global `APP_GUARD`s), but
 * the console structure was disclosed and the defence-in-depth layer was missing.
 *
 * THE BACKEND REMAINS THE AUTHORITY. This guard never grants access to data — it only refuses to
 * paint an interface the caller is not entitled to. `roles`/`permissions` here are backend-resolved
 * (RbacService flattens them from the database into the session payload), not client assertions, and
 * every request the console makes is independently re-authorized server-side.
 *
 * Ordering matters: while the session bootstrap is still running we render the neutral loading shell,
 * never children and never a login flash — the same contract `AuthGuard` established in Phase 2C.5.
 */

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const initialized = useAuthStore((s) => s.initialized);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoSession = useAuthStore((s) => s.isDemoSession);
  const user = useAuthStore((s) => s.user);

  // Session bootstrap still running — show nothing privileged. AuthGuard renders its own shell for
  // the unauthenticated case; this branch prevents an admin-UI flash while roles are still unknown.
  if (!initialized || (isAuthenticated && !user)) {
    return (
      <div
        className="flex min-h-screen w-full flex-col items-center justify-center gap-3 overflow-x-hidden px-6"
        role="status"
        aria-live="polite"
        aria-busy="true"
        data-testid="admin-guard-loading"
      >
        <Spinner size={28} />
        <span className="text-sm text-muted-foreground">Checking permissions…</span>
      </div>
    );
  }

  // Unauthenticated is AuthGuard's job (it redirects to /login); this is belt-and-braces.
  if (!isAuthenticated) return null;

  if (!canAccessAdminConsole(user, isDemoSession)) {
    return (
      <div
        data-testid="admin-forbidden"
        className="flex min-h-screen w-full flex-col items-center justify-center gap-4 overflow-x-hidden px-6 text-center"
        role="alert"
      >
        <div className="max-w-sm space-y-3">
          <h1 className="font-display text-xl font-bold tracking-tight">Not authorised</h1>
          <p className="text-sm text-muted-foreground">
            Your account does not have access to the admin console.
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
