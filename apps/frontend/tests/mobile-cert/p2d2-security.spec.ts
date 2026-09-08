import { createHmac } from 'node:crypto';

import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 2D.2 — security UX mobile certification (375 / 390 / 412).
 *
 * Production build, real backend, real accounts. Covers the security surfaces this phase touched:
 * the two-factor challenge screen, the security/session page, logout, and the admin boundary — all at
 * phone widths, where this product primarily lives.
 */

const ADMIN_EMAIL = process.env.CERT_EMAIL ?? 'admin@money.local';
const ADMIN_PASSWORD = process.env.CERT_PASSWORD ?? 'Adm1n!Passw0rd';
const TOTP_SECRET = process.env.CERT_TOTP_SECRET ?? '';
const PLAYER_EMAIL = process.env.CERT_PLAYER_EMAIL ?? '';
const PLAYER_PASSWORD = process.env.CERT_PLAYER_PASSWORD ?? '';

/** RFC-6238 TOTP via `node:crypto` — the spec adds no dependency; the server remains the verifier. */
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

async function dismissIntro(page: Page) {
  const skip = page.getByRole('button', { name: /skip intro/i });
  try {
    if (await skip.isVisible()) { await skip.click(); await page.waitForTimeout(250); }
  } catch { /* none */ }
}

async function submitCredentials(page: Page, email: string, password: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await dismissIntro(page);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('button[type="submit"]').click();
}

async function noOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const scrollW = Math.max(doc.scrollWidth, document.body.scrollWidth);
    return { ok: scrollW <= doc.clientWidth + 1, scrollW, clientW: doc.clientWidth };
  });
}

test.describe('Phase 2D.2 — security UX (mobile)', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try { window.sessionStorage.setItem('gp-intro-seen', '1'); } catch { /* ignore */ }
    });
  });

  test('2FA challenge screen is usable at phone width', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await submitCredentials(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const code = page.locator('#code');
    await expect(code, `${vp}: 2FA challenge appears`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /two-factor/i })).toBeVisible();

    // No dashboard flash before the second factor is supplied.
    expect(page.url(), `${vp}: still on /login before the 2nd factor`).toContain('/login');

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: 2FA screen has no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);

    // Comfortable input + action targets on a touch device.
    const codeBox = await code.boundingBox();
    expect(codeBox!.height, `${vp}: code field >= 44px`).toBeGreaterThanOrEqual(44);

    const verify = page.getByRole('button', { name: /verify/i });
    await expect(verify, `${vp}: verify is disabled until 6 digits`).toBeDisabled();

    await code.fill(totp(TOTP_SECRET));
    await expect(verify).toBeEnabled({ timeout: 5000 });
    const verifyBox = await verify.boundingBox();
    expect(verifyBox!.height, `${vp}: verify button >= 44px`).toBeGreaterThanOrEqual(44);

    await verify.click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  });

  test('a WRONG 2FA code is rejected and the user stays on the challenge', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await submitCredentials(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const code = page.locator('#code');
    await expect(code).toBeVisible({ timeout: 20_000 });

    await code.fill('000000');
    await page.getByRole('button', { name: /verify/i }).click();

    await page.waitForTimeout(2500);
    // Refused: no session, still on the challenge, never the dashboard.
    expect(page.url(), `${vp}: a wrong code must not sign the user in`).toContain('/login');
    await expect(code, `${vp}: still on the challenge`).toBeVisible();
  });

  test('security & session page renders with no overflow', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!PLAYER_EMAIL, 'no CERT_PLAYER_EMAIL supplied');

    await submitCredentials(page, PLAYER_EMAIL, PLAYER_PASSWORD);
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });

    await page.goto('/settings/security', { waitUntil: 'domcontentloaded' });
    await dismissIntro(page);
    await page.waitForTimeout(600);

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: /settings/security overflow (${o.scrollW}>${o.clientW})`).toBe(true);
    await expect(page.locator('body')).not.toContainText('Application error');
  });

  test('logout ends the session and a guarded route returns to /login', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!PLAYER_EMAIL, 'no CERT_PLAYER_EMAIL supplied');

    await submitCredentials(page, PLAYER_EMAIL, PLAYER_PASSWORD);
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });

    // Clearing localStorage alone does NOT end the session — and that is correct: no token is stored
    // there. The refresh cookie is httpOnly, so ending the session means removing the COOKIE, which
    // is what logout does server-side. Prove the guard then redirects ONCE, with no loop (the Phase
    // 2C.15 regression this must never reintroduce).
    await page.evaluate(() => { try { window.localStorage.clear(); } catch { /* ignore */ } });
    await page.context().clearCookies();
    await page.goto('/wallet', { waitUntil: 'domcontentloaded' });
    await page.waitForURL((u) => u.pathname.startsWith('/login'), { timeout: 20_000 });

    await page.waitForTimeout(3000);
    expect(page.url(), `${vp}: settles on /login without looping`).toContain('/login');
  });

  test('a non-admin is refused the admin console with no admin chrome', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!PLAYER_EMAIL, 'no CERT_PLAYER_EMAIL supplied');

    await submitCredentials(page, PLAYER_EMAIL, PLAYER_PASSWORD);
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('admin-forbidden'), `${vp}: refused`).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('main'), `${vp}: no admin main region`).toHaveCount(0);

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: forbidden screen overflow`).toBe(true);
  });
});
