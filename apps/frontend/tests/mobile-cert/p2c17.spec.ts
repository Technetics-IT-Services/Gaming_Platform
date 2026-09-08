import { createHmac } from 'node:crypto';

import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 2C.17 — mobile regression for the P0 fixes, at 375/390/412.
 *
 * Runs against the PRODUCTION build (demo OFF) with the real backend behind the same-origin proxy,
 * so `/dashboard` is exercised by a REAL, ledger-funded session — the exact case that used to render
 * demo money.
 *
 * Covers:
 *   P0-1  real session sees the server balance on /dashboard, and no "Demo Account" badge
 *   P0-2  a non-admin player is refused the admin console (and there is no admin-UI flash)
 *   core  no horizontal overflow on the money + account routes at each viewport
 */

const EMAIL = process.env.CERT_EMAIL ?? 'admin@money.local';
const PASSWORD = process.env.CERT_PASSWORD ?? 'Adm1n!Passw0rd';
const PLAYER_EMAIL = process.env.CERT_PLAYER_EMAIL ?? '';
const PLAYER_PASSWORD = process.env.CERT_PLAYER_PASSWORD ?? '';
/** The MAIN wallet `available`, read from the backend out-of-band before the run. */
const EXPECTED_BALANCE = (process.env.CERT_EXPECTED_BALANCE ?? '').replace(/[^\d]/g, '');

const MONEY_ROUTES = [
  '/dashboard', '/lobby', '/wallet', '/deposit', '/withdraw', '/transactions',
  '/game-history', '/dice-money', '/profile', '/verification', '/responsible-gaming', '/support',
];

async function dismissIntro(page: Page) {
  const skip = page.getByRole('button', { name: /skip intro/i });
  try {
    if (await skip.isVisible({ timeout: 1200 })) {
      await skip.click();
      await page.waitForTimeout(300);
    }
  } catch {
    /* no intro here */
  }
}


/**
 * Complete the two-factor challenge when the account has 2FA enabled.
 *
 * Phase 2D.2 made 2FA mandatory for administrator ACCOUNTS to use admin functions, so the seeded
 * operator now enrols and its login is genuinely two-step. `CERT_TOTP_SECRET` carries the shared
 * secret for the harness; without it the helper is a no-op for non-2FA accounts.
 */
/**
 * RFC-6238 TOTP, computed with `node:crypto` so this spec adds NO dependency to the frontend.
 * Used only to drive the login form; the server remains the sole verifier.
 */
function totp(base32Secret: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of base32Secret.replace(/=+$/, '').toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));

  const counter = Buffer.alloc(8);
  counter.writeBigInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));

  const hmac = createHmac('sha1', bytes).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

async function completeTwoFactor(page: Page) {
  const secret = process.env.CERT_TOTP_SECRET;
  const codeField = page.locator('#code');
  // `isVisible()` does NOT auto-wait — it answers immediately, so it would return false before the
  // challenge screen has rendered and the helper would skip the second factor entirely.
  const appeared = await codeField
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;
  if (!secret) throw new Error('login requires 2FA but CERT_TOTP_SECRET was not provided');

  await codeField.fill(totp(secret));
  const verify = page.getByRole('button', { name: /verify/i });
  await expect(verify).toBeEnabled({ timeout: 5000 }); // proves the controlled input took the value
  await verify.click();
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await dismissIntro(page);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('button[type="submit"]').click();
  await completeTwoFactor(page);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  await dismissIntro(page);
}

async function noOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const scrollW = Math.max(doc.scrollWidth, document.body.scrollWidth);
    return { ok: scrollW <= doc.clientWidth + 1, scrollW, clientW: doc.clientWidth };
  });
}

test.describe('Phase 2C.17 P0 regressions (mobile)', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try { window.sessionStorage.setItem('gp-intro-seen', '1'); } catch { /* ignore */ }
    });
  });

  test('P0-1: a REAL session sees the SERVER balance on /dashboard, never demo money', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/')) calls.push(r.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0]!);
    });

    await login(page, EMAIL, PASSWORD);
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await dismissIntro(page);

    // The dashboard must actually ask the SERVER for the money it displays.
    await expect
      .poll(() => calls.some((c) => c.includes('/wallet-engine/balances')), { timeout: 20_000 })
      .toBe(true);
    expect(calls.some((c) => c.includes('/wallet/history')), `${vp}: dashboard reads server wallet history`).toBe(true);

    // A real session must NOT be labelled a demo account, and must not show the demo-funds badge.
    await expect(page.getByTestId('demo-account-badge'), `${vp}: no Demo Account badge for a real session`).toHaveCount(0);
    await expect(page.getByTestId('wallet-summary-demo-badge'), `${vp}: wallet summary is not demo`).toHaveCount(0);

    // The rendered wallet figure must equal the server's authoritative `available`. The expected
    // value is read from the backend OUT-OF-BAND (the access token lives in memory, so an in-page
    // fetch could not authenticate) and injected via CERT_EXPECTED_BALANCE.
    const walletStat = page.locator('section', { hasText: 'Wallet summary' }).first();
    await expect(walletStat, `${vp}: wallet summary renders`).toBeVisible({ timeout: 15_000 });
    // `AnimatedNumber` counts up to the real value, so poll until the animation has settled rather
    // than reading a single mid-animation frame.
    if (EXPECTED_BALANCE) {
      await expect
        .poll(
          async () => (await walletStat.innerText()).replace(/[^\d]/g, '').includes(EXPECTED_BALANCE),
          { timeout: 25_000, message: `${vp}: dashboard must render the server balance ${EXPECTED_BALANCE}` },
        )
        .toBe(true);
    } else {
      await expect
        .poll(async () => (await walletStat.innerText()).replace(/[^\d]/g, '').length, { timeout: 20_000 })
        .toBeGreaterThan(0);
    }
  });

  test('P0-2: a signed-in non-admin is refused the admin console', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!PLAYER_EMAIL, 'no non-admin credentials supplied (CERT_PLAYER_EMAIL)');

    await login(page, PLAYER_EMAIL, PLAYER_PASSWORD);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-forbidden'), `${vp}: player is refused the admin console`).toBeVisible({ timeout: 20_000 });
    // The console CHROME must never paint. (`text=Admin Console` would also match the document
    // <title>, which is not rendered UI — assert on the visible header/sidebar instead.)
    await expect(page.getByRole('heading', { name: 'Admin Console' }), `${vp}: no admin header`).toHaveCount(0);
    await expect(page.locator('aside, nav[aria-label="Admin"]'), `${vp}: no admin sidebar`).toHaveCount(0);
    await expect(page.locator('main'), `${vp}: no admin main region`).toHaveCount(0);
  });

  test('P0-2: an ADMIN/SUPER_ADMIN still reaches the admin console', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, EMAIL, PASSWORD);
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-forbidden'), `${vp}: super admin is NOT refused`).toHaveCount(0);
    await expect(page.locator('main').first(), `${vp}: admin console renders`).toBeVisible({ timeout: 20_000 });
  });

  test('core money + account routes have no horizontal overflow', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, EMAIL, PASSWORD);

    const failures: string[] = [];
    for (const route of MONEY_ROUTES) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await dismissIntro(page);
      await page.waitForTimeout(400);
      const o = await noOverflow(page);
      if (!o.ok) failures.push(`${route} (${o.scrollW} > ${o.clientW})`);
      const isError = await page.locator('text=Application error').count();
      if (isError > 0) failures.push(`${route} rendered an application error`);
    }
    expect(failures, `${vp}: overflow/render failures: ${failures.join(', ')}`).toEqual([]);
  });
});
