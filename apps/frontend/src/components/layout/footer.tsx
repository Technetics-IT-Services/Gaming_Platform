import { ShieldCheck, Sparkles } from 'lucide-react';
import Link from 'next/link';

import { Logo } from '@/components/shared/logo';

const footerLinks = [
  {
    heading: 'Play',
    links: [
      { label: 'Casino', href: '/casino' },
      { label: 'Crash', href: '/crash' },
      { label: 'Dice', href: '/dice' },
      { label: 'Roulette', href: '/roulette' },
      { label: 'Sportsbook', href: '/sportsbook' },
    ],
  },
  {
    heading: 'Compete',
    links: [
      { label: 'Tournaments', href: '/tournaments' },
      { label: 'Leaderboards', href: '/leaderboards' },
      { label: 'Rewards', href: '/rewards' },
      { label: 'Promotions', href: '/offers' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '/#about' },
      { label: 'Careers', href: '/#careers' },
      { label: 'Contact', href: '/#contact' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Terms', href: '/terms' },
      { label: 'Privacy', href: '/privacy' },
      { label: 'Responsible Play', href: '/responsible-play' },
    ],
  },
];

const payments = ['VISA', 'Mastercard', 'BTC', 'ETH', 'USDT', 'Apple Pay'];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative mt-16 border-t border-black/5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6">
        <div className="grid gap-10 py-14 md:grid-cols-2 lg:grid-cols-6">
          <div className="space-y-4 lg:col-span-2">
            <Logo />
            <p className="max-w-xs text-sm text-muted-foreground">
              A world-class gaming platform — premium casino, crash, dice, roulette, live sports and
              tournaments. Big wins, instant play.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {payments.map((p) => (
                <span
                  key={p}
                  className="rounded-md border border-black/10 bg-card/50 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
          {footerLinks.map((group) => (
            <div key={group.heading}>
              <h3 className="mb-3 font-display text-sm font-semibold tracking-wide text-foreground">
                {group.heading}
              </h3>
              <ul className="space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-accent"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Responsible gaming band */}
        <div className="flex flex-col items-start gap-4 rounded-2xl border border-black/10 bg-card/40 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald/15 text-emerald">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-foreground">Play responsibly</p>
              <p className="text-xs text-muted-foreground">
                Gaming should be fun. Set limits, take breaks, and play within your means. 18+ only.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-black/10 bg-card/60 px-3 py-1.5 text-xs font-bold text-muted-foreground">
              18+
            </span>
            <Link
              href="/responsible-play"
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald/15 px-3 py-1.5 text-xs font-semibold text-emerald transition-colors hover:bg-emerald/25"
            >
              <Sparkles className="h-3.5 w-3.5" /> Get support
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-black/5">
        <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <p>© {year} Gaming Platform. All rights reserved.</p>
          <p>Crafted for players. Powered by a production-grade engine.</p>
        </div>
      </div>
    </footer>
  );
}
