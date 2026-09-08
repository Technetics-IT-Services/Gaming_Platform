import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Award,
  BadgePercent,
  Banknote,
  BarChart3,
  CircleDot,
  ClipboardList,
  Coins,
  Cpu,
  Sparkles,
  Dice5,
  Dices,
  FileText,
  LifeBuoy,
  Gamepad2,
  Gem,
  Heart,
  Home,
  Landmark,
  LayoutDashboard,
  Library,
  Lock,
  type LucideIcon,
  Gift,
  Globe,
  Handshake,
  Medal,
  Receipt,
  Settings,
  Shield,
  ShieldCheck,
  Spade,
  TrendingUp,
  UserCog,
  Trophy,
  UserPlus,
  Wallet,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /**
   * Phase 2D.11 — this destination is backed by the DEMO WALLET, not by the server.
   *
   * Such a screen initialises to a balance of 0 and can never reach a real-money endpoint, so it is
   * not dangerous — but showing a player a "Vault" or a "Bet History" that can never hold anything
   * is misleading in a production deployment. `visibleNav()` filters these out whenever demo mode is
   * off, which is the case in every production build.
   *
   * The pages are deliberately NOT deleted: they are working demo surfaces, and several have a real
   * counterpart already shipped (`/offers` for `/promotions`, `/game-history` and `/transactions`
   * for `/bets`), so nothing of value is lost by hiding them.
   */
  demoOnly?: boolean;
}

/** Selects which navigation set a layout renders. */
export type NavVariant = 'dashboard' | 'admin' | 'partner';

/** Primary dashboard navigation. */
export const dashboardNav: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Discover', href: '/discover', icon: Sparkles },
  { label: 'Games', href: '/games', icon: Gamepad2 },
  { label: 'Arcade', href: '/arcade', icon: Cpu },
  { label: 'Casino', href: '/casino', icon: Spade },
  { label: 'Roulette', href: '/roulette', icon: CircleDot },
  { label: 'Dice', href: '/dice', icon: Dice5 },
  { label: 'Crash', href: '/crash', icon: TrendingUp },
  { label: 'Sportsbook', href: '/sportsbook', icon: TrendingUp },
  { label: 'Tournaments', href: '/tournaments', icon: Trophy },
  { label: 'Leaderboards', href: '/leaderboards', icon: Medal },
  { label: 'Promotions', href: '/promotions', icon: Gift , demoOnly: true },
  { label: 'Offers', href: '/offers', icon: BadgePercent },
  { label: 'Refer a friend', href: '/referral', icon: UserPlus },
  { label: 'Rewards', href: '/rewards', icon: Award },
  { label: 'VIP', href: '/vip', icon: Gem },
  { label: 'Favorites', href: '/favorites', icon: Heart },
  { label: 'Wallet', href: '/wallet', icon: Wallet },
  { label: 'Deposit', href: '/deposit', icon: ArrowDownToLine },
  { label: 'Withdraw', href: '/withdraw', icon: ArrowUpFromLine },
  { label: 'Vault', href: '/vault', icon: Lock , demoOnly: true },
  { label: 'Transactions', href: '/transactions', icon: Receipt },
  { label: 'Bet History', href: '/bets', icon: Dices , demoOnly: true },
  { label: 'Settings', href: '/settings', icon: Settings },
];

/** Admin console navigation. */
export const adminNav: NavItem[] = [
  { label: 'Overview', href: '/admin', icon: Shield },
  { label: 'Users', href: '/admin/users', icon: UserCog },
  { label: 'Verification', href: '/admin/kyc', icon: ShieldCheck },
  { label: 'Games', href: '/admin/games', icon: Gamepad2 },
  { label: 'Catalogue', href: '/admin/catalog', icon: Library },
  { label: 'Card Engine', href: '/admin/card', icon: Spade },
  { label: 'Roulette', href: '/admin/roulette', icon: CircleDot },
  { label: 'Dice', href: '/admin/dice', icon: Dice5 },
  { label: 'Crash', href: '/admin/crash', icon: TrendingUp },
  { label: 'Sports', href: '/admin/sports', icon: Trophy },
  { label: 'Wallet', href: '/admin/wallet', icon: Wallet },
  { label: 'Tournaments', href: '/admin/tournaments', icon: Trophy },
  { label: 'AI Assistant', href: '/admin/ai', icon: Sparkles },
  { label: 'Operations', href: '/admin/operations', icon: Activity },
  { label: 'Analytics', href: '/admin/analytics', icon: BarChart3 },
  { label: 'Reports', href: '/admin/reports', icon: FileText },
  { label: 'Support', href: '/admin/support', icon: LifeBuoy },
  { label: 'Partners', href: '/admin/partners', icon: Handshake },
  { label: 'Promotions', href: '/admin/promotions', icon: Gift },
  { label: 'Bonuses', href: '/admin/bonuses', icon: Coins },
  { label: 'Cashier', href: '/admin/cashier', icon: Landmark },
  { label: 'Finance', href: '/admin/finance', icon: Banknote },
  { label: 'Expenses', href: '/admin/expenses', icon: Receipt },
  { label: 'Referrals', href: '/admin/referrals', icon: UserPlus },
  { label: 'Audit', href: '/admin/audit', icon: ClipboardList },
  { label: 'Settings', href: '/admin/settings', icon: Settings },
];

/**
 * Partner portal navigation. Deliberately tiny: it lists only what the verified backend supports.
 * No hierarchy, referrals, activity or reports entry exists, because no such endpoint exists and a
 * link to a fabricated screen would be worse than its absence.
 */
export const partnerNav: NavItem[] = [
  { label: 'Overview', href: '/partner', icon: Handshake },
];

/**
 * Primary "gaming" navigation rendered in the premium top bar (marketing +
 * authenticated app). Every href maps to an existing route.
 */
export const primaryNav: NavItem[] = [
  { label: 'World', href: '/world', icon: Globe },
  { label: 'Home', href: '/', icon: Home },
  { label: 'Casino', href: '/casino', icon: Spade },
  { label: 'Crash', href: '/crash', icon: TrendingUp },
  { label: 'Dice', href: '/dice', icon: Dice5 },
  { label: 'Roulette', href: '/roulette', icon: CircleDot },
  { label: 'Games', href: '/games', icon: Gamepad2 },
  { label: 'Sports', href: '/sportsbook', icon: Activity },
  { label: 'Tournaments', href: '/tournaments', icon: Trophy },
  { label: 'Leaderboard', href: '/leaderboards', icon: Medal },
  { label: 'Promotions', href: '/offers', icon: Sparkles },
  { label: 'VIP', href: '/rewards', icon: Gift },
];

/** Public marketing navigation. */
export const marketingNav: { label: string; href: string }[] = [
  { label: 'Games', href: '/games' },
  { label: 'Promotions', href: '/offers' },
  { label: 'About', href: '/#about' },
];

/**
 * The navigation a real deployment should show.
 *
 * Demo-wallet-backed destinations are hidden whenever demo mode is off — which is every production
 * build (`NEXT_PUBLIC_DEMO_MODE=false`). This is a display filter, not a security control: those
 * routes hold no real money and reach no real-money endpoint, and the server remains the authority
 * for everything that does.
 */
export function visibleNav(items: NavItem[], demoMode: boolean): NavItem[] {
  return demoMode ? items : items.filter((item) => !item.demoOnly);
}
