import { AdminGuard } from '@/components/auth/admin-guard';
import { AuthGuard } from '@/components/auth/auth-guard';
import { Header } from '@/components/layout/header';
import { Sidebar } from '@/components/layout/sidebar';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      {/* Phase 2C.17 (P0-2): AuthGuard proves WHO you are; AdminGuard proves you may see this
          console. The backend permission guards remain the authority for every request it makes. */}
      <AdminGuard>
        <div className="flex min-h-screen">
          <Sidebar variant="admin" title="Admin" />
          {/* Phase 2D.6: `min-w-0` is load-bearing on mobile. This column is a flex item, so its
              default `min-width: auto` sizes it to its widest content — any admin page with a wide
              table dragged the WHOLE page sideways (measured 594px against a 390px viewport) instead
              of letting the table scroll inside its own container. */}
          <div className="flex min-h-screen min-w-0 flex-1 flex-col">
            <Header variant="admin" title="Admin Console" />
            <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
          </div>
        </div>
      </AdminGuard>
    </AuthGuard>
  );
}
