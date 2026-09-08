'use client';

import { cn } from '@gaming-platform/ui';
import { History, Home, Spade, User, Wallet, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Stake-inspired fixed mobile bottom navigation (Phase 1.4.1 → 1.4.2).
 *
 * Mobile only (`md:hidden`, < 768px) — desktop, laptop and tablet keep the
 * existing top navigation untouched. Reuses the app's routing (next/link) and
 * design system; no navigation logic is duplicated. A soft, rounded, blurred
 * card that always stays visible, with a safe-area inset for iPhone home bars.
 */

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Extra path prefixes that keep this tab active (defaults to `[href]`). */
  match?: string[];
}

const ITEMS: NavItem[] = [
  { label: 'Home', href: '/dashboard', icon: Home },
  // "Play" is the real-money lobby (Phase 2C.8); it stays active across the lobby, the demo casino,
  // and every real-money `-money` game route so the tab reflects "in a game".
  {
    label: 'Play',
    href: '/lobby',
    icon: Spade,
    match: [
      '/lobby', '/casino', '/play',
      '/dice-money', '/crash-money', '/roulette-money', '/sic-bo-money', '/lottery-money',
      '/baccarat-money', '/blackjack-money', '/plinko-money', '/mines-money',
      '/limbo-money', '/coin-flip-money', '/wheel-money',
      '/dragon-tiger-money', '/andar-bahar-money', '/teen-patti-money',
    ],
  },
  { label: 'History', href: '/game-history', icon: History, match: ['/game-history', '/wallet/history', '/transactions'] },
  { label: 'Wallet', href: '/wallet', icon: Wallet },
  { label: 'Profile', href: '/profile', icon: User },
];

/** True when the current pathname equals or is nested under any of the item's prefixes. */
function isActive(pathname: string, item: NavItem): boolean {
  return (item.match ?? [item.href]).some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-3 mb-2 flex items-stretch justify-around rounded-[20px] border border-black/[0.06] bg-white/95 shadow-[0_8px_30px_-8px_rgba(20,20,60,0.28)] backdrop-blur-sm">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-2xl px-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50',
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span className="relative flex h-6 w-6 items-center justify-center">
                  <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.3 : 2} />
                  <span
                    aria-hidden
                    className={cn(
                      'absolute -top-1.5 h-1 w-1 rounded-full bg-primary transition-opacity',
                      active ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </span>
                <span className="text-[10px] font-semibold leading-none">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
