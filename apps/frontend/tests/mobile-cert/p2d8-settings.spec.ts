import { createHmac } from 'node:crypto';
import { execSync } from 'node:child_process';

import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 2D.8 — settings (AD-09) mobile + end-to-end certification (375 / 390 / 412).
 *
 * Verifies the full chain for a real change: UI → API → database → the player-facing page that
 * consumes it. A screen that merely renders is not enough.
 */

const ADMIN_EMAIL = process.env.CERT_EMAIL ?? 'admin@money.local';
const ADMIN_PASSWORD = process.env.CERT_PASSWORD ?? 'Adm1n!Passw0rd';
const TOTP_SECRET = process.env.CERT_TOTP_SECRET ?? '';
const PLAYER_EMAIL = process.env.P2D8_PLAYER_EMAIL ?? '';
const PLAYER_PASSWORD = process.env.P2D8_PLAYER_PASSWORD ?? '';

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

async function login(page: Page, email: string, password: string, secret?: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await dismissIntro(page);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('button[type="submit"]').click();

  const code = page.locator('#code');
  const needs2fa = await code.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  if (needs2fa) {
    if (!secret) throw new Error('2FA required but no secret supplied');
    await code.fill(totp(secret));
    const verify = page.getByRole('button', { name: /verify/i });
    await expect(verify).toBeEnabled({ timeout: 5000 });
    await verify.click();
  }
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

test.describe('Phase 2D.8 — settings (mobile + E2E)', () => {
  test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try { window.sessionStorage.setItem('gp-intro-seen', '1'); } catch { /* ignore */ }
    });
  });

  test('settings render from the server with no horizontal overflow', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/')) calls.push(r.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0]!);
    });

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-settings'), `${vp}: page renders`).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => calls.some((c) => c.includes('/admin/settings')), { timeout: 20_000 }).toBe(true);

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('the screen states what it deliberately cannot edit', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });

    const panel = page.getByTestId('settings-excluded');
    await expect(panel, `${vp}: exclusion notice shown`).toBeVisible({ timeout: 20_000 });
    await expect(panel).toContainText('Not editable here, by design');
    await expect(panel).toContainText('responsible-gaming');

    // And no control exists for game-variant configuration.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('dice-variant');
    expect(body).not.toContain('crash-variant');
  });

  test('UI change → API → DATABASE → player-facing page', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    const value = `ops-${Date.now()}@example.test`;

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('admin-settings')).toBeVisible({ timeout: 20_000 });

    const input = page.getByTestId('setting-input-platform.support_email');
    await input.waitFor({ state: 'visible', timeout: 20_000 });
    await input.fill(value);
    await page.getByTestId('setting-save-platform.support_email').click();
    await expect(page.getByTestId('settings-notice'), `${vp}: save confirmed`).toBeVisible({ timeout: 20_000 });

    // 1. DATABASE holds exactly what was typed.
    await expect.poll(
      () => db(`SELECT value #>> '{}' FROM system_settings WHERE key='platform.support_email'`),
      { timeout: 20_000 },
    ).toBe(value);

    // 2. The PLAYER-FACING page consumes it — the setting is not write-only.
    await page.goto('/support', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body'), `${vp}: support page shows the new contact`).toContainText(value, { timeout: 20_000 });

    // 3. Reset leaves the system clean for a repeat run.
    await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('setting-reset-platform.support_email').click();
    await expect(page.getByTestId('settings-notice')).toBeVisible({ timeout: 20_000 });
    await expect.poll(
      () => db("SELECT count(*) FROM system_settings WHERE key='platform.support_email'"),
      { timeout: 20_000 },
    ).toBe('0');
  });

  test('controls are >=44px and reachable at phone width', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('admin-settings')).toBeVisible({ timeout: 20_000 });

    for (const id of [
      'setting-input-platform.support_email',
      'setting-save-platform.support_email',
      'setting-input-platform.support_response_hours',
    ]) {
      const el = page.getByTestId(id);
      await expect(el, `${vp}: ${id} visible`).toBeVisible({ timeout: 20_000 });
      const box = await el.boundingBox();
      expect(box!.height, `${vp}: ${id} >= 44px`).toBeGreaterThanOrEqual(44);
      expect(box!.x, `${vp}: ${id} not clipped`).toBeGreaterThanOrEqual(0);
    }
  });

  test('a normal player is refused the settings console', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!PLAYER_EMAIL, 'no player credentials supplied');

    await login(page, PLAYER_EMAIL, PLAYER_PASSWORD);
    await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-forbidden'), `${vp}: player refused`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('admin-settings')).toHaveCount(0);
  });

  test('a player calling the settings API directly gets 403', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!PLAYER_EMAIL, 'no player credentials supplied');

    await login(page, PLAYER_EMAIL, PLAYER_PASSWORD);
    const status = await page.evaluate(async () => {
      const res = await fetch('/api/v1/admin/settings', { credentials: 'include' });
      return res.status;
    });
    expect([401, 403], `${vp}: settings API refuses a player (got ${status})`).toContain(status);
  });
});
