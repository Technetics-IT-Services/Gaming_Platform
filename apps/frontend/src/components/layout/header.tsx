'use client';

import { Button } from '@gaming-platform/ui';
import { PanelLeft } from 'lucide-react';

import { MobileNav } from '@/components/layout/mobile-nav';
import { adminNav, partnerNav, dashboardNav, visibleNav, type NavVariant } from '@/components/shared/navigation';
import { clientConfig } from '@/lib/config';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { UserMenu } from '@/components/shared/user-menu';
import { useUiStore } from '@/stores/ui-store';

interface HeaderProps {
  variant: NavVariant;
  title?: string;
}

/** App header used inside authenticated layouts (dashboard, admin). */
export function Header({ variant, title }: HeaderProps) {
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  // Demo-wallet-backed destinations never appear in a production build.
  const navItems = visibleNav(
    variant === 'admin' ? adminNav : variant === 'partner' ? partnerNav : dashboardNav,
    clientConfig.demoMode,
  );

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
      <MobileNav items={navItems} triggerClassName="md:hidden" />
      <Button
        variant="ghost"
        size="icon"
        className="hidden md:inline-flex"
        aria-label="Toggle sidebar"
        onClick={toggleSidebar}
      >
        <PanelLeft className="h-5 w-5" />
      </Button>
      {title ? <h1 className="text-base font-semibold">{title}</h1> : null}
      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
