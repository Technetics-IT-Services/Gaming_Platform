import { AuthGuard } from '@/components/auth/auth-guard';
import { PartnerGuard } from '@/components/auth/partner-guard';
import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';

/**
 * Partner portal shell.
 *
 * Mirrors the admin shell rather than introducing a second architecture: AuthGuard proves WHO you
 * are, PartnerGuard declines to paint the portal for anyone without `partners:read_own`, and the
 * backend permission guards remain the authority for every request it makes.
 *
 * A partner is NOT a player, so this deliberately does not live in the `(dashboard)` group — that
 * would give a partner the player navigation (wallet, games, deposits) they have no business seeing.
 */
export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <PartnerGuard>
        <div className="flex min-h-screen">
          <Sidebar variant="partner" title="Partner" />
          {/* `min-w-0` is load-bearing (Phase 2D.6): without it a wide table drags the whole page
              sideways instead of scrolling inside its own container. */}
          <div className="flex min-h-screen min-w-0 flex-1 flex-col">
            <Header variant="partner" title="Partner Portal" />
            <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
          </div>
        </div>
      </PartnerGuard>
    </AuthGuard>
  );
}
