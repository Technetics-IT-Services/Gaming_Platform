import { createHmac } from 'node:crypto';
import { execSync } from 'node:child_process';

import { test, expect, type Page } from '@playwright/test';

import { pacedLogin } from './login-throttle';

/**
 * Phase 2D.13 — mobile certification of the last four operator surfaces at 375 / 390 / 412.
 *
 * AD-03 game catalogue · AD-12 audit trail · P-10 responsible-gaming view · P-17 referrals.
 * After these, no permission-guarded operator route requires curl.
 */

const ADMIN_EMAIL = process.env.CERT_EMAIL ?? 'admin@money.local';
const ADMIN_PASSWORD = process.env.CERT_PASSWORD ?? 'Adm1n!Passw0rd';
const TOTP_SECRET = process.env.CERT_TOTP_SECRET ?? '';
const PASSWORD = process.env.P2D9_PASSWORD ?? '';
const PLAYER_EMAIL = process.env.P2D9_REFERRER_EMAIL ?? '';

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
    ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

function db(sql: string): string {
  return execSync(
    `docker exec gp_phase1_pg psql -U gaming -d gaming_platform_phase1 -t -A -c "${sql}"`,
  ).toString().trim();
}

async function dismissIntro(page: Page) {
  const skip = page.getByRole('button', { name: /skip intro/i });
  try {
    if (await skip.isVisible()) { await skip.click(); await page.waitForTimeout(250); }
  } catch { /* none */ }
}

/**
 * Sign in through the shared pacer.
 *
 * 18 tests each sign in, but the application throttles `/auth/login` to 10 attempts a minute, so
 * an unpaced run could not pass — the first ten tests succeeded and the rest timed out on the
 * login page. `pacedLogin` waits for the application's own window to have room before attempting.
 * The throttle itself is untouched and no assertion here is relaxed.
 */
async function login(page: Page, email: string, password: string, secret?: string) {
  await pacedLogin(page, { email, password, secret, totp, dismissIntro });
}

async function noOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const scrollW = Math.max(doc.scrollWidth, document.body.scrollWidth);
    return { ok: scrollW <= doc.clientWidth + 1, scrollW, clientW: doc.clientWidth };
  });
}

test.describe('Phase 2D.13 — oversight consoles (mobile + E2E)', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try { window.sessionStorage.setItem('gp-intro-seen', '1'); } catch { /* ignore */ }
    });
  });

  test('UI catalogue create → API → DATABASE, then cleanup', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/catalog', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('admin-catalog'), `${vp}: console renders`).toBeVisible({ timeout: 20_000 });

    // A name unique to this viewport so the three projects do not collide.
    const name = `MobCat ${vp} ${Date.now() % 100000}`;
    await page.getByTestId('catalog-name').fill(name);
    const submit = page.getByTestId('catalog-create-submit');
    const box = await submit.boundingBox();
    expect(box!.height, `${vp}: submit >= 44px`).toBeGreaterThanOrEqual(44);
    await submit.click();
    await expect(page.getByTestId('catalog-notice'), `${vp}: created`).toBeVisible({ timeout: 20_000 });

    // The value reached the database.
    await expect.poll(
      () => db(`SELECT count(*) FROM game_categories WHERE name='${name}'`),
      { timeout: 20_000 },
    ).toBe('1');

    // Clean up through the UI so the next viewport starts fresh.
    const id = db(`SELECT id FROM game_categories WHERE name='${name}' LIMIT 1`);
    await page.getByTestId(`catalog-delete-${id}`).click();
    await expect.poll(
      () => db(`SELECT count(*) FROM game_categories WHERE name='${name}' AND deleted_at IS NULL`),
      { timeout: 20_000 },
    ).toBe('0');

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('all four catalogue tabs load real data', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/catalog', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('admin-catalog')).toBeVisible({ timeout: 20_000 });

    for (const tab of ['providers', 'collections', 'launchers'] as const) {
      const el = page.getByTestId(`catalog-tab-${tab}`);
      const box = await el.boundingBox();
      expect(box!.height, `${vp}: ${tab} tab >= 44px`).toBeGreaterThanOrEqual(44);
      await el.click();
      // Either rows or an honest empty state — never a spinner that never resolves.
      await expect(
        page.getByTestId('catalog-table').or(page.getByTestId('catalog-empty')),
        `${vp}: ${tab} resolved`,
      ).toBeVisible({ timeout: 20_000 });
    }

    // Launchers are platform-registered, and the page says so rather than offering a create form.
    await expect(page.getByTestId('catalog-launchers-note')).toBeVisible();
    await expect(page.getByTestId('catalog-create')).toHaveCount(0);
  });

  test('the audit trail shows real records and matches the database', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/audit', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-audit'), `${vp}: console renders`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('audit-table'), `${vp}: real records listed`).toBeVisible({ timeout: 20_000 });

    const total = db('SELECT count(*) FROM audit_trails');
    await expect(page.locator('body'), `${vp}: record count matches SQL`)
      .toContainText(`${total} records`, { timeout: 20_000 });

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('the referral console shows attribution and no reward figure', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/referrals', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-referrals'), `${vp}: console renders`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('referrals-table')).toBeVisible({ timeout: 20_000 });

    const total = db('SELECT count(*) FROM referral_history');
    await expect(page.locator('body'), `${vp}: count matches SQL`)
      .toContainText(`${total} relationships`, { timeout: 20_000 });

    // The reason, never a zero.
    await expect(page.getByTestId('referrals-unavailable')).toContainText('No reward is calculated');
    const body = await page.locator('body').innerText();
    expect(body, `${vp}: no currency symbol`).not.toContain('₹');

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('the responsible-gaming panel offers no way to create or raise a limit', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/users', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('users-table')).toBeVisible({ timeout: 20_000 });

    // Open the first player's detail; the RG panel loads alongside sessions.
    await page.locator('[data-testid^="user-detail-"]').first().click();
    await expect(page.getByTestId('user-rg-panel'), `${vp}: RG panel renders`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('user-rg-panel')).toContainText('Limits are set by the player');

    // Limits belong to the player: an operator may only lift a restriction early.
    const amountInputs = await page.getByTestId('user-rg-panel')
      .locator('input[type="number"], input[inputmode="decimal"]').count();
    expect(amountInputs, `${vp}: no limit-amount input`).toBe(0);

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('a player is refused every new console, in the shell and at the API', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!PLAYER_EMAIL, 'no seeded player');

    await login(page, PLAYER_EMAIL, PASSWORD);
    for (const route of ['/admin/catalog', '/admin/audit', '/admin/referrals']) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('admin-forbidden'), `${vp}: player refused ${route}`).toBeVisible({ timeout: 20_000 });
    }

    const statuses = await page.evaluate(async () => {
      const paths = [
        '/api/v1/admin/game-categories',
        '/api/v1/admin/audit',
        '/api/v1/admin/referrals',
      ];
      return Promise.all(paths.map((p) => fetch(p, { credentials: 'include' }).then((r) => r.status)));
    });
    for (const s of statuses) {
      expect([401, 403], `${vp}: API refuses a player (got ${s})`).toContain(s);
    }
  });
});
