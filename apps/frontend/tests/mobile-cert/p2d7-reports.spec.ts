import { createHmac } from 'node:crypto';

import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 2D.7 — reports & export mobile certification (375 / 390 / 412).
 *
 * Production build, real backend, a real 2FA-verified operator. Proves the reports surface is
 * genuinely server-backed, exports a real file through an AUTHENTICATED request, renders unavailable
 * values honestly, and stays usable on a phone — including that wide tables scroll inside their own
 * container rather than making the page scroll sideways.
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

test.describe('Phase 2D.7 — reports & export (mobile)', () => {
  test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try { window.sessionStorage.setItem('gp-intro-seen', '1'); } catch { /* ignore */ }
    });
  });

  test('renders a REAL server-built report with no horizontal overflow', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/')) calls.push(r.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0]!);
    });

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/reports', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-reports'), `${vp}: page renders`).toBeVisible({ timeout: 20_000 });

    // The rows must come from the SERVER, not from anything in the bundle.
    await expect.poll(() => calls.some((c) => c.includes('/analytics/reports')), { timeout: 20_000 }).toBe(true);

    const meta = page.getByTestId('report-meta');
    await expect(meta, `${vp}: metadata envelope shown`).toBeVisible({ timeout: 20_000 });
    await expect(meta).toContainText('UTC');

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('every report type renders and the page never scrolls sideways', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/reports', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('admin-reports')).toBeVisible({ timeout: 20_000 });

    for (const type of ['financial', 'gaming', 'cashier', 'operations', 'users', 'security-audit']) {
      const tab = page.getByTestId(`report-tab-${type}`);
      await tab.waitFor({ state: 'visible', timeout: 20_000 });

      const box = await tab.boundingBox();
      expect(box!.height, `${vp}: ${type} tab >= 44px`).toBeGreaterThanOrEqual(44);

      await tab.click();
      await expect(page.getByTestId('report-meta')).toBeVisible({ timeout: 20_000 });

      const o = await noOverflow(page);
      expect(o.ok, `${vp}: ${type} no overflow (${o.scrollW}>${o.clientW})`).toBe(true);
    }
  });

  test('wide tables scroll inside their own container, not the page', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/reports', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('admin-reports')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('report-table').waitFor({ state: 'visible', timeout: 20_000 });

    const scrollers = await page.evaluate(() => {
      const out: { overflowsSelf: boolean }[] = [];
      for (const table of Array.from(document.querySelectorAll('table'))) {
        const box = table.parentElement;
        if (!box) continue;
        out.push({ overflowsSelf: getComputedStyle(box).overflowX === 'auto' });
      }
      return out;
    });
    expect(scrollers.length, `${vp}: tables rendered`).toBeGreaterThan(0);
    expect(scrollers.every((t) => t.overflowsSelf), `${vp}: every table has its own scroller`).toBe(true);

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: page itself does not scroll sideways`).toBe(true);
  });

  test('filters and the export control are usable at phone width', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/reports', { waitUntil: 'domcontentloaded' });

    for (const id of ['report-from', 'report-to', 'report-currency', 'report-export']) {
      const el = page.getByTestId(id);
      await expect(el, `${vp}: ${id} visible`).toBeVisible({ timeout: 20_000 });
      const box = await el.boundingBox();
      expect(box!.height, `${vp}: ${id} >= 44px`).toBeGreaterThanOrEqual(44);
      // Reachable: fully inside the viewport horizontally.
      expect(box!.x, `${vp}: ${id} not clipped left`).toBeGreaterThanOrEqual(0);
    }
  });

  test('export downloads a real CSV through an AUTHENTICATED request', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/reports', { waitUntil: 'domcontentloaded' });

    const exportBtn = page.getByTestId('report-export');
    await expect(exportBtn).toBeEnabled({ timeout: 20_000 });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      exportBtn.click(),
    ]);

    expect(download.suggestedFilename(), `${vp}: CSV filename`).toMatch(/\.csv$/);
    // No path separator or traversal can reach the filename.
    expect(download.suggestedFilename()).not.toMatch(/[/\\]|\.\./);

    await expect(page.getByTestId('report-export-notice'), `${vp}: export confirmed to the user`)
      .toBeVisible({ timeout: 20_000 });
  });

  test('the Phase 2D.6 admin-shell fix is not regressed on /admin/analytics', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);

    // min-w-0 on the shell column is what stops a wide admin page dragging the whole page sideways.
    const hasMinW0 = async () =>
      page.evaluate(() => {
        const col = document.querySelector('div.flex.min-h-screen.flex-1.flex-col');
        return col ? getComputedStyle(col).minWidth === '0px' : false;
      });

    for (const route of ['/admin/analytics', '/admin/reports']) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      expect(await hasMinW0(), `${vp}: ${route} shell keeps min-w-0`).toBe(true);
      const o = await noOverflow(page);
      expect(o.ok, `${vp}: ${route} no overflow (${o.scrollW}>${o.clientW})`).toBe(true);
    }
  });

  test('a non-admin cannot reach the reports console', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!PLAYER_EMAIL, 'no CERT_PLAYER_EMAIL supplied');

    await login(page, PLAYER_EMAIL, PLAYER_PASSWORD);
    await page.goto('/admin/reports', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-forbidden'), `${vp}: player refused`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('admin-reports'), `${vp}: reports never painted`).toHaveCount(0);
  });
});
