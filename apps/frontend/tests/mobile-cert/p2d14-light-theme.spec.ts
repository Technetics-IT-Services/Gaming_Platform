import { execSync } from 'node:child_process';

import { test, expect, type Page } from '@playwright/test';

import { pacedLogin } from './login-throttle';

/**
 * Phase 2D.14 — the money screens at 375 / 390 / 412.
 *
 * The bug: these screens set a dark-theme foreground (`#e5e7eb`) on their root while the app shell
 * is light, so every heading and helper line outside a panel rendered at ~1.14:1 — invisible. This
 * checks the fix on a phone, where the wallet screens are actually used: light surfaces, dark text,
 * a readable balance, and no horizontal overflow.
 */

const EMAIL = process.env.P2D14_EMAIL ?? '';
const PASSWORD = process.env.P2D14_PASSWORD ?? '';
/** The balance the audited cashier deposit put on this account. */
const EXPECTED = process.env.P2D14_EXPECTED_BALANCE ?? '10000';

function db(sql: string): string {
  return execSync(
    `docker exec gp_phase1_pg psql -U gaming -d gaming_platform_phase1 -t -A -c "${sql}"`,
  ).toString().trim();
}

/**
 * Sign in through the shared pacer, which respects the application's 10-per-minute login window.
 * The throttle is untouched; the suite simply does not exceed it.
 */
async function login(page: Page) {
  await pacedLogin(page, { email: EMAIL, password: PASSWORD });
}

/** sRGB relative luminance of a computed `rgb()` string. */
async function luminanceOf(page: Page, selector: string, prop: 'color' | 'backgroundColor') {
  return page.evaluate(
    ([sel, p]) => {
      const el = document.querySelector(sel as string);
      if (!el) return null;
      const raw = getComputedStyle(el)[p as 'color'];
      const m = /rgba?\(([^)]+)\)/.exec(raw);
      if (!m || !m[1]) return null;
      const ch = m[1].split(',').map((x) => parseFloat(x.trim()));
      if (ch.length < 3) return null;
      const f = (v: number | undefined) => {
        const c = (v ?? 0) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(ch[0]) + 0.7152 * f(ch[1]) + 0.0722 * f(ch[2]);
    },
    [selector, prop] as const,
  );
}

async function noOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const scrollW = Math.max(doc.scrollWidth, document.body.scrollWidth);
    return { ok: scrollW <= doc.clientWidth + 1, scrollW, clientW: doc.clientWidth };
  });
}

test.describe('Phase 2D.14 — light theme on the money screens', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try { window.sessionStorage.setItem('gp-intro-seen', '1'); } catch { /* ignore */ }
    });
  });

  test('the deposit screen is a LIGHT surface with DARK text', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!EMAIL, 'no P2D14_EMAIL supplied');
    await login(page);
    await page.goto('/deposit', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('amount'), `${vp}: cashier renders`).toBeVisible({ timeout: 20_000 });

    // The page body is light...
    const bodyLum = await luminanceOf(page, 'body', 'backgroundColor');
    expect(bodyLum, `${vp}: body luminance`).not.toBeNull();
    expect(bodyLum!).toBeGreaterThan(0.6);

    // ...and the amount field paints dark text on a light field, not the other way round.
    const fieldBg = await luminanceOf(page, '[data-testid="amount"]', 'backgroundColor');
    const fieldFg = await luminanceOf(page, '[data-testid="amount"]', 'color');
    expect(fieldBg!, `${vp}: input background is light`).toBeGreaterThan(0.6);
    expect(fieldFg!, `${vp}: input text is dark`).toBeLessThan(0.2);

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('the heading and helper text are readable, not near-invisible', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!EMAIL, 'no P2D14_EMAIL supplied');
    await login(page);
    await page.goto('/deposit', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('amount')).toBeVisible({ timeout: 20_000 });

    // The exact regression: a heading sitting on the shell inheriting a dark-theme foreground.
    const headingLum = await luminanceOf(page, 'h1', 'color');
    const pageLum = await luminanceOf(page, 'body', 'backgroundColor');
    expect(headingLum, `${vp}: heading colour`).not.toBeNull();
    const ratio = (Math.max(headingLum!, pageLum!) + 0.05) / (Math.min(headingLum!, pageLum!) + 0.05);
    expect(ratio, `${vp}: heading vs page contrast`).toBeGreaterThanOrEqual(4.5);
  });

  test('the balance from the audited deposit is visible on a phone', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!EMAIL, 'no P2D14_EMAIL supplied');
    await login(page);
    await page.goto('/deposit', { waitUntil: 'domcontentloaded' });

    const balance = page.getByTestId('balance');
    await expect(balance, `${vp}: balance renders`).toBeVisible({ timeout: 20_000 });
    await expect(balance, `${vp}: shows the credited amount`).toContainText(EXPECTED);

    // And it is the server's number, not a client guess.
    const stored = db(
      `SELECT COALESCE(wb.available,'0') FROM users u JOIN wallets w ON w.user_id=u.id AND w.type='MAIN' JOIN wallet_balances wb ON wb.wallet_id=w.id WHERE u.email='${EMAIL}' LIMIT 1`,
    );
    expect(Number(stored).toFixed(2), `${vp}: database agrees`).toBe(Number(EXPECTED).toFixed(2));
  });

  test('the transaction appears in history and reads clearly', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!EMAIL, 'no P2D14_EMAIL supplied');
    await login(page);
    await page.goto('/transactions', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const heading = await luminanceOf(page, 'h1', 'color');
    expect(heading!, `${vp}: transactions heading is dark`).toBeLessThan(0.2);
    await expect(page.locator('body'), `${vp}: the deposit is listed`).toContainText(EXPECTED, { timeout: 20_000 });

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('Promotions in the chrome no longer points back at Home', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!EMAIL, 'no P2D14_EMAIL supplied');
    await login(page);
    await page.goto('/offers', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('offers-page'), `${vp}: the real offers surface renders`).toBeVisible({ timeout: 20_000 });
    // No navigation link anywhere may resolve to the home page with a dead fragment.
    const promoHrefs = await page.evaluate(() =>
      [...document.querySelectorAll('a')]
        .filter((a) => /promotions/i.test(a.textContent || ''))
        .map((a) => a.getAttribute('href') || ''),
    );
    for (const href of promoHrefs) {
      expect(href, `${vp}: Promotions link ${href}`).not.toBe('/#promotions');
    }

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('the profile secondary actions are readable, not white on grey', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!EMAIL, 'no P2D14_EMAIL supplied');
    await login(page);
    await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Withdraw/Transactions were left white-on-light-grey (1.80:1) by the palette conversion.
    const worst = await page.evaluate(() => {
      const parse = (s: string): number[] | null => {
        const m = /rgba?\(([^)]+)\)/.exec(s);
        if (!m || !m[1]) return null;
        const ch = m[1].split(',').map((x) => parseFloat(x.trim()));
        return ch.length >= 3 ? ch : null;
      };
      const lum = (c: number[]) => {
        const f = (v: number | undefined) => {
          const x = (v ?? 0) / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
      };
      let min = 99;
      for (const a of document.querySelectorAll('a')) {
        if (!/^(Withdraw|Transactions|Deposit)$/.test((a.textContent || '').trim())) continue;
        const cs = getComputedStyle(a);
        const fg = parse(cs.color);
        const bg = parse(cs.backgroundColor);
        if (!fg || !bg) continue;
        const l1 = lum(fg);
        const l2 = lum(bg);
        min = Math.min(min, (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
      }
      return min;
    });
    expect(worst, `${vp}: worst quick-action contrast`).toBeGreaterThanOrEqual(4.5);
  });
});
