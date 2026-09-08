import { createHmac } from 'node:crypto';

import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 2D.6 — analytics dashboard mobile certification (375 / 390 / 412).
 *
 * Production build, real backend, a real 2FA-verified operator. Proves the dashboard is genuinely
 * server-backed, renders unavailable metrics honestly, and stays usable on a phone — including that
 * wide tables scroll inside their own container rather than making the page scroll sideways.
 */

const ADMIN_EMAIL = process.env.CERT_EMAIL ?? 'admin@money.local';
const ADMIN_PASSWORD = process.env.CERT_PASSWORD ?? 'Adm1n!Passw0rd';
const TOTP_SECRET = process.env.CERT_TOTP_SECRET ?? '';
const PLAYER_EMAIL = process.env.CERT_PLAYER_EMAIL ?? '';
const PLAYER_PASSWORD = process.env.CERT_PLAYER_PASSWORD ?? '';

/** RFC-6238 TOTP via `node:crypto` — no dependency is added to the frontend. */
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

async function login(page: Page, email: string, password: string, secret?: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await dismissIntro(page);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('button[type="submit"]').click();

  const code = page.locator('#code');
  const needs2fa = await code.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  if (needs2fa) {
    if (!secret) throw new Error('login requires 2FA but no TOTP secret was supplied');
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

test.describe('Phase 2D.6 — analytics dashboard (mobile)', () => {
  test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try { window.sessionStorage.setItem('gp-intro-seen', '1'); } catch { /* ignore */ }
    });
  });

  test('renders REAL server data with no horizontal overflow', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/')) calls.push(r.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0]!);
    });

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-analytics'), `${vp}: page renders`).toBeVisible({ timeout: 20_000 });

    // The numbers must come from the SERVER, not from anything in the bundle.
    await expect.poll(() => calls.some((c) => c.includes('/analytics/summary')), { timeout: 20_000 }).toBe(true);
    expect(calls.some((c) => c.includes('/analytics/daily')), `${vp}: daily series fetched`).toBe(true);

    // A real figure landed (registered users is always > 0 on this stack).
    const usersPanel = page.locator('section', { hasText: 'Registered' }).first();
    await expect(usersPanel).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await usersPanel.innerText()).replace(/[^\d]/g, '').length, { timeout: 20_000 })
      .toBeGreaterThan(0);

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('unavailable metrics are shown honestly, not as zeros', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });

    const panel = page.getByTestId('analytics-unavailable');
    await expect(panel, `${vp}: unavailable panel is present`).toBeVisible({ timeout: 20_000 });

    const text = await panel.innerText();
    for (const metric of ['dau', 'mau', 'retention', 'ltv', 'revenue', 'expenses', 'profit']) {
      expect(text.toLowerCase(), `${vp}: ${metric} declared unavailable`).toContain(metric);
    }
    expect(text).toContain('NOT AVAILABLE');
  });

  test('wide tables scroll inside their own container, not the page', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('admin-analytics')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1200);

    const tableScrollers = await page.evaluate(() => {
      const out: { overflowsSelf: boolean }[] = [];
      for (const table of Array.from(document.querySelectorAll('table'))) {
        const box = table.parentElement;
        if (!box) continue;
        out.push({ overflowsSelf: getComputedStyle(box).overflowX === 'auto' });
      }
      return out;
    });
    expect(tableScrollers.length, `${vp}: tables rendered`).toBeGreaterThan(0);
    expect(tableScrollers.every((t) => t.overflowsSelf), `${vp}: every table has its own scroller`).toBe(true);

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: page itself does not scroll sideways`).toBe(true);
  });

  test('date filters are usable at phone width', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });

    for (const id of ['analytics-from', 'analytics-to']) {
      const field = page.getByTestId(id);
      await expect(field).toBeVisible({ timeout: 20_000 });
      const box = await field.boundingBox();
      expect(box!.height, `${vp}: ${id} >= 44px`).toBeGreaterThanOrEqual(44);
    }
  });

  test('a non-admin cannot reach the analytics dashboard', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!PLAYER_EMAIL, 'no CERT_PLAYER_EMAIL supplied');

    await login(page, PLAYER_EMAIL, PLAYER_PASSWORD);
    await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-forbidden'), `${vp}: player refused`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('admin-analytics'), `${vp}: dashboard never painted`).toHaveCount(0);
  });
});
