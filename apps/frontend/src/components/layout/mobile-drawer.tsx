'use client';

import { Button, Sheet, SheetContent, SheetTitle, SheetTrigger, cn } from '@gaming-platform/ui';
import {
  CircleDot,
  Dice5,
  Dices,
  Gamepad2,
  Gem,
  Gift,
  LayoutDashboard,
  LifeBuoy,
  Lock,
  LogOut,
  Medal,
  Menu,
  Receipt,
  Settings,
  Spade,
  TrendingUp,
  UserCircle2,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { Logo } from '@/components/shared/logo';
import { logoutSession } from '@/lib/auth-session';
import { clearDemoSession } from '@/lib/demo-session';
import { useDemoWallet } from '@/stores/demo-wallet';

/**
 * Full-height mobile navigation drawer (Phase 1.5). Mobile only — gives phone
 * users access to EVERY section, grouped and icon-led, that the desktop top nav
 * exposes. Reuses next/link routing + the existing auth logout flow; closes
 * automatically after navigation. Rendered only for authenticated users.
 */

interface Item {
  label: string;
  href: string;
  icon: LucideIcon;
}

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Play',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Casino', href: '/casino', icon: Spade },
      { label: 'Games', href: '/games', icon: Gamepad2 },
      { label: 'Sportsbook', href: '/sportsbook', icon: TrendingUp },
      { label: 'Crash', href: '/crash', icon: TrendingUp },
      { label: 'Dice', href: '/dice', icon: Dice5 },
      { label: 'Roulette', href: '/roulette', icon: CircleDot },
    ],
  },
  {
    title: 'Rewards',
    items: [
      { label: 'Promotions', href: '/promotions', icon: Gift },
      { label: 'VIP', href: '/vip', icon: Gem },
      { label: 'Leaderboard', href: '/leaderboards', icon: Medal },
    ],
  },
  {
    title: 'Wallet',
    items: [
      { label: 'Wallet', href: '/wallet', icon: Wallet },
      { label: 'Vault', href: '/vault', icon: Lock },
      { label: 'Transactions', href: '/transactions', icon: Receipt },
      { label: 'Bet History', href: '/bets', icon: Dices },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Profile', href: '/profile', icon: UserCircle2 },
      { label: 'Settings', href: '/settings', icon: Settings },
      { label: 'Support', href: '/help', icon: LifeBuoy },
    ],
  },
];

export function MobileDrawer() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const logout = async () => {
    setOpen(false);
    // Authoritative logout: server revokes the session, latch prevents auto-resurrect, state cleared.
    await logoutSession();
    clearDemoSession();
    useDemoWallet.getState().reset();
    router.push('/');
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11 md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-[86vw] max-w-sm flex-col gap-0 bg-background p-0">
        <SheetTitle className="sr-only">Navigation menu</SheetTitle>

        <div className="flex h-16 shrink-0 items-center border-b border-black/[0.06] px-5">
          <Logo />
        </div>

        <nav className="flex-1 overflow-y-auto overscroll-contain px-3 py-4" aria-label="All sections">
          {GROUPS.map((group) => (
            <div key={group.title} className="mb-5 last:mb-0">
              <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {group.title}
              </p>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-[15px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50',
                          active
                            ? 'bg-primary/10 font-semibold text-primary before:absolute before:left-0 before:top-1/2 before:h-5 before:w-1 before:-translate-y-1/2 before:rounded-r-full before:bg-primary'
                            : 'text-foreground hover:bg-black/[0.04]',
                        )}
                      >
                        <Icon className={cn('h-5 w-5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-black/[0.06] p-3">
          <button
            type="button"
            onClick={() => void logout()}
            className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-destructive/50"
          >
            <LogOut className="h-5 w-5 shrink-0" /> Logout
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
