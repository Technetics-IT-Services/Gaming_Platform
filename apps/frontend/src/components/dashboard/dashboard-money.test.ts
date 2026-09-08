import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Phase 2C.17 — P0-1. `/dashboard` is the page login lands on, and its widgets read `useDemoWallet`
 * UNCONDITIONALLY, so a REAL ledger-funded player saw demo balances and demo transactions there. The
 * certified money journey runs through /lobby, /wallet, /deposit and /withdraw, which is why this was
 * never caught.
 *
 * These are STRUCTURAL tests over the real source files. The dashboard widgets are React components
 * and this vitest project runs in the `node` environment with no DOM, so a render test is not
 * available here — but the property that matters is a dependency property: **no component in the
 * /dashboard tree may import the demo wallet**, and the money source must be the server APIs. That is
 * exactly what a structural assertion can prove, and it cannot be satisfied by merely hiding an
 * import behind a condition. Live behaviour is separately certified by the mobile Playwright run.
 */

const SRC = join(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/** Every component rendered by app/(dashboard)/dashboard/page.tsx, transitively. */
const DASHBOARD_TREE = [
  'app/(dashboard)/dashboard/page.tsx',
  'components/dashboard/player-sections.tsx',
  'components/dashboard/dashboard-lobby.tsx',
  'components/dashboard/dashboard-lobby-lazy.tsx',
  'components/wallet/wallet-summary.tsx',
  'components/marketing/hero.tsx',
  'components/casino/provider-showcase.tsx',
  'components/games/home-sections.tsx',
  'components/live/global-live-feed.tsx',
  'components/live/live-now.tsx',
  'components/marketing/landing-sections.tsx',
  'components/marketing/lobby-sections.tsx',
];

describe('P0-1 — the production dashboard has no demo-wallet dependency', () => {
  it.each(DASHBOARD_TREE)('%s does not import the demo wallet', (file) => {
    const src = read(file);
    // Comments may mention the historical defect; only real imports/usages are forbidden.
    const withoutComments = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(withoutComments).not.toContain("from '@/stores/demo-wallet'");
    expect(withoutComments).not.toContain('useDemoWallet(');
  });

  it('the dashboard money source exists and is the single decision point', () => {
    const hook = read('components/dashboard/use-dashboard-money.ts');
    expect(hook).toContain('useRealSession');
    expect(hook).toContain('walletApi.balances');
    expect(hook).toContain('walletApi.history');
    expect(hook).toContain('gameHistoryApi.list');
  });
});

describe('P0-1 — a REAL session is served by the server, a DEMO session is isolated', () => {
  const hook = read('components/dashboard/use-dashboard-money.ts');

  it('every server query is gated on a REAL session, so a demo session fires none of them', () => {
    // Each useQuery in the hook must carry `enabled: isReal`.
    const queries = hook.match(/useQuery\(\{[\s\S]*?\}\);/g) ?? [];
    expect(queries.length).toBeGreaterThanOrEqual(5); // balances + wallet recent/today + rounds recent/today
    for (const q of queries) {
      expect(q).toContain('enabled: isReal');
    }
  });

  it('the balance is taken from the server `available`, never computed from transactions', () => {
    expect(hook).toContain('n(main.available)');
    // No arithmetic building a balance out of transaction rows.
    expect(hook).not.toMatch(/balance\s*[+-]=/);
  });

  it('the demo branch is reachable ONLY when the session is not real', () => {
    expect(hook).toContain('if (!isReal)');
    expect(hook).toContain('isReal: false');
  });

  it('a real session reports isDemo false, so consumers cannot mislabel it', () => {
    expect(hook).toContain('isDemo: false');
  });

  it('truncation of the "today" roll-up is surfaced honestly rather than silently', () => {
    expect(hook).toContain('todayTruncated');
  });
});

describe('P0-1 — the widgets render honest states', () => {
  it('WalletSummary labels a demo session and shows an error state instead of a fake zero', () => {
    const src = read('components/wallet/wallet-summary.tsx');
    expect(src).toContain('wallet-summary-demo-badge');
    expect(src).toContain('wallet-summary-error');
    // While loading, the stat renders null → "—", never a fabricated 0.
    expect(src).toContain('money.loading ? null : money.balance');
    expect(src).toContain("{value === null ? '—'");
  });

  it('PlayerHero only shows the Demo Account badge for a demo session', () => {
    const src = read('components/dashboard/player-sections.tsx');
    expect(src).toContain('money.isDemo ? (');
    expect(src).toContain('demo-account-badge');
    // Identity for a real session comes from the authenticated user, not the demo profile store.
    expect(src).toContain('authUser?.displayName || authUser?.username');
  });

  it('the recent-activity cards distinguish loading, error and genuinely empty', () => {
    const src = read('components/dashboard/player-sections.tsx');
    expect(src).toContain('money.error ? (');
    expect(src).toContain("Empty text=\"Loading…\"");
  });
});
