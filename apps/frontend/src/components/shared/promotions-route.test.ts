import { describe, expect, it } from 'vitest';

import { dashboardNav, marketingNav, primaryNav, visibleNav } from './navigation';

/**
 * Phase 2D.14 — HOME and PROMOTIONS were the same page.
 *
 * Every "Promotions" link in the chrome (premium top bar, marketing bar, footer) pointed at
 * `/#promotions` — an anchor on the HOME page. The `Promotions()` section that would have provided
 * that anchor is not rendered anywhere, so the fragment had no target either: clicking Promotions
 * simply landed you on Home. For a signed-in player `/` additionally redirects to `/dashboard`, so
 * the two really were one page.
 *
 * The canonical promotions surface is `/offers` — server-backed (AD-08), showing operator-published
 * promotions and the server's own reason where awarding is blocked. `/promotions` remains the
 * fictional demo showcase and stays demo-only.
 */

const promoLinks = (items: { label: string; href: string }[]) =>
  items.filter((i) => i.label === 'Promotions').map((i) => i.href);

describe('Promotions never points back at Home', () => {
  it.each([
    ['primaryNav', primaryNav as { label: string; href: string }[]],
    ['marketingNav', marketingNav],
  ])('%s sends Promotions to the real offers surface', (_name, items) => {
    const hrefs = promoLinks(items);
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs).toEqual(hrefs.map(() => '/offers'));
  });

  it('no Promotions entry anywhere uses a home-page fragment', () => {
    const all = [...primaryNav, ...marketingNav, ...dashboardNav];
    const fragments = all.filter((i) => i.href.startsWith('/#')).map((i) => i.label);
    expect(fragments).not.toContain('Promotions');
    // `About` is the same dead-anchor defect — `id="about"` does not exist either — but there is
    // no About page to point it at, so it is reported in the phase document, not invented away.
    expect(fragments).toEqual(['About']);
  });
});

describe('the two promotion routes stay distinct', () => {
  it('the demo showcase is demo-only, so production never shows it', () => {
    const demo = dashboardNav.find((i) => i.href === '/promotions');
    expect(demo?.demoOnly).toBe(true);
    expect(visibleNav(dashboardNav, false).map((i) => i.href)).not.toContain('/promotions');
  });

  it('the real offers surface is always shown, in demo and in production alike', () => {
    for (const demoMode of [true, false]) {
      expect(visibleNav(dashboardNav, demoMode).map((i) => i.href)).toContain('/offers');
    }
  });

  it('Home and the promotions destination are different routes', () => {
    const home = dashboardNav.find((i) => i.label === 'Dashboard')?.href;
    expect(home).toBe('/dashboard');
    expect(promoLinks(primaryNav as { label: string; href: string }[])).not.toContain(home);
  });
});
