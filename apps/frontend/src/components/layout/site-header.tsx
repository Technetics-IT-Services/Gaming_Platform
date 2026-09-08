'use client';

import { Button, cn } from '@gaming-platform/ui';
import { Gift, HelpCircle, Home, LogIn, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { MobileDrawer } from '@/components/layout/mobile-drawer';
import { MobileNav } from '@/components/layout/mobile-nav';
import { BalancePill } from '@/components/shared/balance-pill';
import { LevelPill } from '@/components/shared/level-pill';
import { Logo } from '@/components/shared/logo';
import { type NavItem, primaryNav } from '@/components/shared/navigation';
import { NotificationsMenu } from '@/components/shared/notifications-menu';
import { SearchCommand } from '@/components/shared/search-command';
import { UserMenu } from '@/components/shared/user-menu';
import { useAuthStore } from '@/stores/auth-store';

/** Guest (signed-out) navigation — marketing only, no betting content (Phase 1.1). */
const GUEST_NAV: NavItem[] = [
  { label: 'Home', href: '/', icon: Home },
  { label: 'Login', href: '/login', icon: LogIn },
  { label: 'Sign Up', href: '/signup', icon: UserPlus },
  { label: 'Help', href: '/help', icon: HelpCircle },
];

/**
 * Premium gaming top bar shared by the marketing site and the authenticated
 * app. Sticky, glassy, light. The nav switches automatically after login:
 * guests see Home/Login/Sign Up/Help; authenticated players see the full app.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const navItems = isAuthenticated ? primaryNav : GUEST_NAV;

  return (
    <header className="sticky top-0 z-40 border-b border-black/[0.07] bg-white/85 shadow-[0_6px_24px_-18px_hsl(230_50%_40%/0.35)] backdrop-blur-md">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="mx-auto flex h-16 max-w-[1800px] items-center gap-1 px-3 sm:gap-2 sm:px-6">
        {/* Mobile (< md): grouped full-section drawer for authenticated players. */}
        {isAuthenticated ? (
          <div className="flex items-center md:hidden">
            <MobileDrawer />
          </div>
        ) : null}

        {/* Hamburger: tablet only (768–1023px). Hidden on desktop (full top nav). */}
        <div className="hidden items-center md:flex lg:hidden">
          <MobileNav items={navItems} />
        </div>

        <Logo />

        {/*
          Single-row primary nav. No horizontal scroll: every item is always
          visible (icon-only below 1728px, icon+label on wide desktops), so a
          1920px desktop shows the full labelled set with room to spare. Guests
          see the minimal marketing nav; authenticated players see the full app.
        */}
        <nav className="ml-2 hidden items-center gap-0.5 lg:flex min-[1728px]:ml-3 min-[1728px]:gap-1">
          {navItems.map((item) => {
            const active =
              item.href === '/'
                ? pathname === '/'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={cn(
                  'group relative flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-primary/50 min-[1728px]:px-3',
                  active
                    ? 'bg-primary/[0.06] text-foreground'
                    : 'text-muted-foreground hover:bg-black/[0.04] hover:text-foreground',
                )}
              >
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0 transition-colors',
                    active ? 'text-accent' : 'text-muted-foreground group-hover:text-accent',
                  )}
                />
                <span className="hidden min-[1728px]:inline">{item.label}</span>
                <span
                  className={cn(
                    'absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-primary to-neon transition-all',
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60',
                  )}
                />
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {isAuthenticated ? (
            <>
              {/* On mobile the profile avatar and the notification bell show. Search, VIP and the
                  pills appear from tablet up (md+). The bell is mobile-first (Phase 2D.1): on a phone
                  it is the only entry point to the notification centre. */}
              <div className="hidden items-center gap-1 sm:gap-2 md:flex">
                <SearchCommand />
                <Button asChild variant="gold" size="sm">
                  <Link href="/vip">
                    <Gift className="h-4 w-4" /> VIP
                  </Link>
                </Button>
                <LevelPill />
                <BalancePill />
              </div>
              <NotificationsMenu />
              <UserMenu />
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Login</Link>
              </Button>
              <Button asChild variant="gradient" size="sm">
                <Link href="/signup">Sign Up</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
