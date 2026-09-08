'use client';

import Link from 'next/link';

import { useAuthStore } from '@/stores/auth-store';

/**
 * Real-money surface guard (Phase 2C.15 hotfix).
 *
 * Real-money and account surfaces require a REAL server-authenticated session. A demo session is
 * client-only — it has no backend principal, no wallet and no ledger — so it must never enter these
 * flows, even though `isAuthenticated` is true for it.
 *
 * This is the visible half of the isolation; the enforcing half is in `api-client`, which rejects
 * every user-scoped / real-money request from a demo session before it reaches the wire. Neither
 * relaxes anything for real sessions: when the session is real (or still bootstrapping) the guard is
 * completely transparent.
 */
export function RealMoneyGuard({ children }: { children: React.ReactNode }) {
  const isDemoSession = useAuthStore((s) => s.isDemoSession);

  if (!isDemoSession) return <>{children}</>;
  return <RealAccountRequired />;
}

/**
 * The "real account required" notice on its own, for pages that need it as an early return (after
 * their hooks) rather than as a wrapper around the whole tree.
 */
export function RealAccountRequired() {
  return (
    <div
      data-testid="real-money-blocked"
      style={{ maxWidth: 440, margin: '0 auto', padding: '24px 16px', color: '#1b1f37', boxSizing: 'border-box' }}
    >
      <div style={{ border: '1px solid #b9c1d4', background: '#ffffff', borderRadius: 16, padding: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 8px' }}>Real account required</h2>
        <p style={{ fontSize: 14, lineHeight: 1.5, opacity: 0.8, margin: '0 0 16px' }}>
          You are signed in with a guest demo session. Real-money play, the wallet, the cashier and
          account records need a real signed-in account.
        </p>
        <Link
          href="/login"
          style={{ display: 'inline-block', padding: '12px 18px', borderRadius: 12, background: '#8a5300', color: '#ffffff', fontWeight: 800, fontSize: 15, textDecoration: 'none' }}
        >
          Sign in with a real account
        </Link>
      </div>
    </div>
  );
}
