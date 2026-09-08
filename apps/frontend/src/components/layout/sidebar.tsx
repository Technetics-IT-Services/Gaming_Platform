'use client';

import { ScrollArea, Separator, cn } from '@gaming-platform/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Logo } from '@/components/shared/logo';
import { adminNav, partnerNav, dashboardNav, visibleNav, type NavVariant } from '@/components/shared/navigation';
import { clientConfig } from '@/lib/config';
import { useUiStore } from '@/stores/ui-store';

interface SidebarProps {
  variant: NavVariant;
  title?: string;
}

export function Sidebar({ variant, title }: SidebarProps) {
  const pathname = usePathname();
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  // Demo-wallet-backed destinations never appear in a production build.
  const items = visibleNav(
    variant === 'admin' ? adminNav : variant === 'partner' ? partnerNav : dashboardNav,
    clientConfig.demoMode,
  );

  return (
    <aside
      className={cn(
        'hidden h-screen shrink-0 flex-col border-r border-border bg-card/40 transition-[width] duration-200 md:flex',
        sidebarOpen ? 'w-64' : 'w-[76px]',
      )}
    >
      <div className="flex h-16 items-center px-4">
        <Logo showText={sidebarOpen} />
      </div>
      <Separator />
      {title && sidebarOpen ? (
        <p className="px-4 pt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
      ) : null}
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="flex flex-col gap-1">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  !sidebarOpen && 'justify-center',
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {sidebarOpen ? <span>{item.label}</span> : null}
              </Link>
            );
          })}
        </nav>
      </ScrollArea>
    </aside>
  );
}
