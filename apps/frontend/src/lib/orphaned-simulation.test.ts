import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { adminNav, dashboardNav, partnerNav, primaryNav, visibleNav } from '@/components/shared/navigation';

/**
 * X-08 — quarantine of the orphaned simulation libraries.
 *
 * WHAT THESE ARE. `src/lib/{analytics,operations,partners,tenancy,…}` are ~23k lines of client-side
 * simulation written before the real backend existed. They are not merely unused — several encode
 * **invented business semantics**: `lib/partners` models CPA / RevShare / Hybrid / Tiered
 * commission schemes that no client requirement specifies, `lib/treasury` and `lib/ledger` model
 * money movement the server alone is authoritative for, and `lib/payments` models gateway behaviour
 * for a gateway that does not exist.
 *
 * WHY THEY ARE NOT DELETED. Removing ~23k lines days before a client delivery is a larger risk than
 * leaving inert code inert, and the deletion decision belongs to whoever owns the codebase after
 * handover. What matters for correctness is that none of it can reach a REAL-MONEY surface.
 *
 * WHAT THIS TEST DOES — and it is enforcement, not a note in a document:
 *
 *   1. Twelve directories must have **zero importers anywhere**.
 *   2. `payments` and `ledger` are honestly acknowledged as reachable, but only from the
 *      **demo wallet**, which is fictional by design and was removed from every money surface in
 *      Phase 2C.9. They must never be imported by anything else.
 *
 * If either rule is broken, this test names the offending file.
 */

const SRC = join(process.cwd(), 'src');

/** Quarantined and completely unreachable. Zero importers permitted. */
const UNREACHABLE = [
  'analytics', 'compliance', 'crm', 'infra', 'integrations', 'operations',
  'partners', 'perf', 'resilience', 'security', 'tenancy', 'treasury',
] as const;

/**
 * Simulation reachable ONLY from the demo wallet. Listed explicitly rather than pretended away.
 * `lib/payments` credits `useDemoWallet`; `lib/ledger` backs the demo wallet's own history.
 */
const DEMO_ONLY = ['payments', 'ledger'] as const;

/** The only files permitted to import a DEMO_ONLY library. */
const DEMO_WALLET_FILES = [
  join('stores', 'deposit-adapter.ts'),
  join('stores', 'deposit-adapter.test.ts'),
  join('stores', 'wallet-ledger.ts'),
  join('stores', 'demo-wallet.ts'),
];

/** `games` is real: the client-side game runtime genuinely uses it. */
const REAL_LIB_DIRS = ['games'] as const;

/** This file names library paths in its own assertions; it is not an importer. */
const SELF = join('lib', 'orphaned-simulation.test.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every source file that is not itself inside a simulation directory, and not this test. */
function applicationFiles(): string[] {
  const simPrefixes = [...UNREACHABLE, ...DEMO_ONLY].map((d) => join('lib', d) + sep);
  return walk(SRC).filter((f) => {
    const rel = relative(SRC, f);
    return rel !== SELF && !simPrefixes.some((p) => rel.startsWith(p));
  });
}

/**
 * Module specifiers a file actually imports. A path merely MENTIONED in a comment does not match —
 * only a real `import` / `export … from` / `require()` / dynamic `import()` does.
 */
function importSpecifiers(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s[^;]*?from\s*['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) out.push(m[1]!);
  return out;
}

function targets(specifiers: string[], dirs: readonly string[]): string[] {
  return specifiers.filter((spec) =>
    dirs.some((d) =>
      spec === `@/lib/${d}` || spec.startsWith(`@/lib/${d}/`)
      || spec === `./${d}` || spec.startsWith(`./${d}/`)
      || spec.includes(`/lib/${d}/`) || spec.endsWith(`/lib/${d}`),
    ),
  );
}

describe('X-08 — orphaned simulation libraries stay quarantined', () => {
  const files = applicationFiles();

  it('finds application source to check (guards against a broken walker)', () => {
    // Were this ever to collapse to zero, every assertion below would pass vacuously.
    expect(files.length).toBeGreaterThan(200);
  });

  it('NO file anywhere imports an unreachable simulation library', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const hits = targets(importSpecifiers(readFileSync(file, 'utf8')), UNREACHABLE);
      if (hits.length > 0) offenders.push(`${relative(SRC, file)} → ${hits.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the demo-only simulation is imported ONLY by the demo wallet', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(SRC, file);
      const hits = targets(importSpecifiers(readFileSync(file, 'utf8')), DEMO_ONLY);
      if (hits.length > 0 && !DEMO_WALLET_FILES.includes(rel)) {
        offenders.push(`${rel} → ${hits.join(', ')}`);
      }
    }
    // A real-money page reaching for simulated payments or a simulated ledger is exactly the
    // failure this guards against.
    expect(offenders).toEqual([]);
  });

  it('no REAL-MONEY surface reaches the demo wallet either', () => {
    const moneyRoutes = files.filter((f) => {
      const rel = relative(SRC, f);
      return /^app[\\/].*(deposit|withdraw|wallet|cashier|offers|referral)[\\/]page\.tsx$/.test(rel);
    });
    expect(moneyRoutes.length).toBeGreaterThan(0);
    for (const file of moneyRoutes) {
      const src = readFileSync(file, 'utf8');
      expect(
        `${relative(SRC, file)}:${src.includes('useDemoWallet') ? 'USES-DEMO-WALLET' : 'clean'}`,
      ).toBe(`${relative(SRC, file)}:clean`);
    }
  });

  it('the classification matches what is actually on disk', () => {
    const onDisk = readdirSync(join(SRC, 'lib'))
      .filter((e) => statSync(join(SRC, 'lib', e)).isDirectory())
      .sort();
    const classified = [...UNREACHABLE, ...DEMO_ONLY, ...REAL_LIB_DIRS].sort();
    // A NEW simulation directory cannot be added without this test noticing it is unclassified.
    expect(onDisk).toEqual(classified);
  });

  it('the detector really detects (proves the test is not vacuous)', () => {
    expect(targets(importSpecifiers("import { x } from '@/lib/partners/commission';"), UNREACHABLE)).toHaveLength(1);
    expect(targets(importSpecifiers("export * from './treasury/accounts';"), UNREACHABLE)).toHaveLength(1);
    expect(targets(importSpecifiers("const m = require('@/lib/tenancy/registry');"), UNREACHABLE)).toHaveLength(1);
    expect(targets(importSpecifiers("import { PaymentService } from '@/lib/payments';"), DEMO_ONLY)).toHaveLength(1);
    // A comment mentioning the path is not an import.
    expect(targets(importSpecifiers('// see src/lib/partners/ for the old model'), UNREACHABLE)).toHaveLength(0);
    // A real, non-quarantined import is untouched.
    expect(targets(importSpecifiers("import { apiClient } from './api-client';"), UNREACHABLE)).toHaveLength(0);
  });
});

describe('Phase 2D.11 — demo destinations never appear in a production build', () => {
  const ALL_NAVS = { dashboardNav, adminNav, partnerNav, primaryNav };

  it('every demo-wallet-backed destination is marked demoOnly', () => {
    // These six pages read `useDemoWallet`; a production player must not be offered them.
    const DEMO_HREFS = ['/promotions', '/vault', '/bets', '/store', '/marketplace', '/mailbox'];
    const unmarked: string[] = [];
    for (const [name, items] of Object.entries(ALL_NAVS)) {
      for (const item of items) {
        if (DEMO_HREFS.includes(item.href) && !item.demoOnly) unmarked.push(`${name} → ${item.href}`);
      }
    }
    expect(unmarked).toEqual([]);
  });

  it('production navigation (demo mode OFF) contains no demo destination', () => {
    for (const [name, items] of Object.entries(ALL_NAVS)) {
      const production = visibleNav(items, false);
      const leaked = production.filter((i) => i.demoOnly).map((i) => `${name} → ${i.href}`);
      expect(leaked).toEqual([]);
    }
  });

  it('demo mode ON still shows them, so nothing was deleted', () => {
    const withDemo = visibleNav(dashboardNav, true);
    expect(withDemo.some((i) => i.href === '/vault')).toBe(true);
    expect(withDemo.length).toBeGreaterThan(visibleNav(dashboardNav, false).length);
  });

  it('the REAL equivalents remain in production navigation', () => {
    const production = visibleNav(dashboardNav, false);
    // `/offers` replaces the demo `/promotions`; wallet and transactions replace the demo `/vault`
    // and `/bets`. Hiding the demo screens removes no capability.
    for (const href of ['/offers', '/wallet', '/transactions', '/referral']) {
      expect(`${href}:${production.some((i) => i.href === href)}`).toBe(`${href}:true`);
    }
  });

  it('both navigation renderers apply the filter', () => {
    const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
    for (const file of ['components/layout/header.tsx', 'components/layout/sidebar.tsx']) {
      expect(`${file}:${read(file).includes('visibleNav')}`).toBe(`${file}:true`);
      expect(`${file}:${read(file).includes('clientConfig.demoMode')}`).toBe(`${file}:true`);
    }
  });
});
