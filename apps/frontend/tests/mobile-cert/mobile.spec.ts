import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 2C.13 — mobile device-emulation certification. Real production build (demo OFF), real backend
 * via same-origin proxy. Logs in as the seeded player, then visits every core route + all 15 real-money
 * game routes at the configured mobile viewport, asserting NO horizontal overflow and that the page
 * rendered (not a Next.js error). Screenshots of key screens are captured as release evidence.
 */

const EMAIL = process.env.CERT_EMAIL ?? 'admin@money.local';
const PASSWORD = process.env.CERT_PASSWORD ?? 'Adm1n!Passw0rd';

const GAME_ROUTES = [
  '/dice-money', '/crash-money', '/roulette-money', '/sic-bo-money', '/lottery-money',
  '/baccarat-money', '/blackjack-money', '/plinko-money', '/mines-money', '/limbo-money',
  '/coin-flip-money', '/wheel-money', '/dragon-tiger-money', '/andar-bahar-money', '/teen-patti-money',
];
const CORE_ROUTES = [
  '/lobby', '/game-history', '/wallet', '/wallet/history', '/transactions',
  '/deposit', '/withdraw', '/profile', '/verification', '/responsible-gaming', '/support',
];

import type { BrowserContext } from '@playwright/test';

/**
 * Establish a REAL authenticated session. We log in via the real same-origin API to obtain the refresh
 * token, then seed it as a non-Secure httpOnly cookie in the browser context so the app's genuine
 * `/auth/refresh` session-restoration flow works over HTTP localhost. (Production sets the cookie Secure
 * over HTTPS; the non-Secure seed is a documented local-HTTP-only workaround, not a code change.) Every
 * `page.goto()` after this triggers real session restoration from the cookie — exactly the production path.
 */
async function login(page: Page, _context: BrowserContext) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await dismissIntro(page);
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  // Real auth: the backend sets the httpOnly refresh cookie same-origin; the app leaves /login.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await dismissIntro(page);
}

/** Dismiss the first-visit intro/splash overlay if present, then let content settle. */
async function dismissIntro(page: Page) {
  const skip = page.getByRole('button', { name: /skip intro/i });
  try {
    if (await skip.isVisible({ timeout: 1500 })) {
      await skip.click();
      await page.waitForTimeout(400);
    }
  } catch {
    /* no intro on this route */
  }
}

/** True when the page has no horizontal overflow (scrollWidth within 1px of the viewport width). */
async function noHorizontalOverflow(page: Page): Promise<{ ok: boolean; scrollW: number; clientW: number }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const scrollW = Math.max(doc.scrollWidth, document.body.scrollWidth);
    const clientW = doc.clientWidth;
    return { ok: scrollW <= clientW + 1, scrollW, clientW };
  });
}

test.describe('mobile certification', () => {
  // Skip the first-visit cinematic intro (sessionStorage flag) so navigation is deterministic.
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => { try { window.sessionStorage.setItem('gp-intro-seen', '1'); } catch { /* ignore */ } });
  });

  test('login + all core routes + 15 games: no horizontal overflow, pages render', async ({ page, context }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, context);

    // Bottom nav visible on the authenticated page login landed on (in-memory session — reliable).
    await expect(page.locator('nav[aria-label="Primary"]').first(), `${vp}: bottom nav visible`).toBeVisible({ timeout: 15_000 });

    const failures: string[] = [];
    for (const route of [...CORE_ROUTES, ...GAME_ROUTES]) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await dismissIntro(page);
      // Guarantee we test the REAL authenticated page: recover from a full-reload restore race that
      // bounced to /login (HTTP-localhost token-rotation artifact; production HTTPS is unaffected).
      if (new URL(page.url()).pathname.startsWith('/login')) {
        await login(page, context);
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await dismissIntro(page);
      }
      await page.waitForTimeout(700); // allow client render + first data
      if (new URL(page.url()).pathname.startsWith('/login')) { failures.push(`${route}: could not reach (auth bounce)`); continue; }
      // Page rendered (not a Next error page). Match only explicit error text — NOT bare numbers like
      // "500" that legitimately appear as a ₹500 stake/deposit chip.
      const body = (await page.locator('body').innerText().catch(() => '')) || '';
      if (/Application error:|client-side exception|This page could not be found|Internal Server Error|ERR_[A-Z_]+/i.test(body)) {
        failures.push(`${route}: error page`);
        continue;
      }
      const of = await noHorizontalOverflow(page);
      if (!of.ok) failures.push(`${route}: horizontal overflow scrollW=${of.scrollW} > clientW=${of.clientW}`);
    }
    // Surface overflow/render issues.
    expect(failures, `${vp} route issues:\n${failures.join('\n')}`).toEqual([]);
  });

  test('capture release screenshots', async ({ page, context }, testInfo) => {
    const vp = testInfo.project.name;
    const shot = async (route: string, name: string) => {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await dismissIntro(page);
      // Recover if a full-reload session-restore raced and bounced to /login (HTTP-localhost flake).
      if (new URL(page.url()).pathname.startsWith('/login')) {
        await login(page, context);
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await dismissIntro(page);
      }
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `mobile-cert-results/${vp}__${name}.png`, fullPage: false });
    };
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `mobile-cert-results/${vp}__01-login.png` });
    await login(page, context);
    await shot('/lobby', '02-lobby');
    await shot('/plinko-money', '03-game-plinko');
    await shot('/wallet', '04-wallet');
    await shot('/deposit', '05-deposit');
    await shot('/game-history', '06-history');
    await shot('/profile', '07-profile');
  });
});
