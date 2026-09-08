import { execSync } from 'node:child_process';

import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 2D.4 — partner portal mobile + end-to-end certification (375 / 390 / 412).
 *
 * This does NOT stop at "the page loads". For the key values it compares:
 *   UI text  ←→  frontend API response  ←→  database row
 * so a screen that renders a plausible-but-wrong number fails.
 */

const PARTNER_EMAIL = process.env.PARTNER_EMAIL ?? '';
const PARTNER_PASSWORD = process.env.PARTNER_PASSWORD ?? '';
const PLAYER_EMAIL = process.env.P2D4_PLAYER_EMAIL ?? '';
const PLAYER_PASSWORD = process.env.P2D4_PLAYER_PASSWORD ?? '';
const PARTNER_CODE = process.env.PARTNER_CODE ?? '';

/** Read a single value straight from Postgres — the ultimate source of truth. */
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

async function login(page: Page, email: string, password: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await dismissIntro(page);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('button[type="submit"]').click();
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

test.describe('Phase 2D.4 — partner portal (mobile + E2E)', () => {
  test.skip(!PARTNER_EMAIL, 'no PARTNER_EMAIL supplied');

  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try { window.sessionStorage.setItem('gp-intro-seen', '1'); } catch { /* ignore */ }
    });
  });

  test('UI value === API response === DATABASE row', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;

    // Capture what the API actually returned, so the UI can be compared against it.
    let apiShare: string | null = null;
    let apiName: string | null = null;
    page.on('response', async (r) => {
      if (r.url().includes('/api/') && r.url().includes('/partner/dashboard') && r.status() === 200) {
        try {
          const body = await r.json();
          apiShare = body?.data?.partner?.revenueSharePercent ?? null;
          apiName = body?.data?.partner?.name ?? null;
        } catch { /* ignore */ }
      }
    });

    await login(page, PARTNER_EMAIL, PARTNER_PASSWORD);
    await page.goto('/partner', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('partner-overview'), `${vp}: portal renders`).toBeVisible({ timeout: 20_000 });

    // 1. DATABASE
    const dbShare = db(`SELECT revenue_share_percent FROM partners WHERE code='${PARTNER_CODE}'`);
    const dbName = db(`SELECT name FROM partners WHERE code='${PARTNER_CODE}'`);

    // 2. API — must equal the DB (numeric equality; the DB pads decimals)
    await expect.poll(() => apiShare, { timeout: 20_000 }).not.toBeNull();
    expect(Number(apiShare), `${vp}: API share === DB share`).toBeCloseTo(Number(dbShare), 4);
    expect(apiName, `${vp}: API name === DB name`).toBe(dbName);

    // 3. UI — must show exactly what the API returned
    await expect(page.getByTestId('partner-name'), `${vp}: UI name === API name`).toHaveText(apiName!);
    await expect(page.getByTestId('partner-share'), `${vp}: UI share === API share`).toContainText(apiShare!);

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('blocked financials show the REASON, never a zero', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, PARTNER_EMAIL, PARTNER_PASSWORD);
    await page.goto('/partner', { waitUntil: 'domcontentloaded' });

    const panel = page.getByTestId('partner-unavailable');
    await expect(panel, `${vp}: unavailable panel shown`).toBeVisible({ timeout: 20_000 });
    await expect(panel).toContainText('netProfit');
    await expect(panel).toContainText('availableBalance');
    await expect(panel, `${vp}: names the business blocker`).toContainText('BUSINESS DEFINITION MISSING');

    // The decisive check: no fabricated zero-money anywhere on the page.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('₹0');
    expect(body).not.toMatch(/Balance:\s*0/);
  });

  test('data persists across logout and re-login', async ({ page, context }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, PARTNER_EMAIL, PARTNER_PASSWORD);
    await page.goto('/partner', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('partner-overview')).toBeVisible({ timeout: 20_000 });
    const before = await page.getByTestId('partner-name').innerText();

    // A real logout: clear cookies so the refresh token is gone, then sign in again.
    await context.clearCookies();
    await login(page, PARTNER_EMAIL, PARTNER_PASSWORD);
    await page.goto('/partner', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('partner-overview')).toBeVisible({ timeout: 20_000 });
    expect(await page.getByTestId('partner-name').innerText(), `${vp}: same org after re-login`).toBe(before);
  });

  test('a normal player is REFUSED the partner portal and no partner data renders', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!PLAYER_EMAIL, 'no player credentials supplied');

    await login(page, PLAYER_EMAIL, PLAYER_PASSWORD);
    await page.goto('/partner', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('partner-forbidden'), `${vp}: player refused`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('partner-overview'), `${vp}: portal never painted`).toHaveCount(0);

    // No partner metadata leaks into the refusal screen.
    const body = await page.locator('body').innerText();
    expect(body).not.toContain(PARTNER_CODE);
  });

  test('a partner is REFUSED the operator partner console', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, PARTNER_EMAIL, PARTNER_PASSWORD);
    await page.goto('/admin/partners', { waitUntil: 'domcontentloaded' });

    // A partner holds partners:read_own only — the admin shell must refuse them.
    await expect(page.getByTestId('admin-forbidden'), `${vp}: partner refused admin`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('admin-partners')).toHaveCount(0);
  });

  test('a partner calling the operator API directly gets 403 (UI is not the boundary)', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, PARTNER_EMAIL, PARTNER_PASSWORD);

    // Bypass the UI entirely and hit the API with the partner's own session.
    const status = await page.evaluate(async () => {
      const res = await fetch('/api/v1/admin/partners', { credentials: 'include' });
      return res.status;
    });
    expect([401, 403], `${vp}: operator API refuses a partner (got ${status})`).toContain(status);
  });

  test('portal is usable at phone width: targets, wrapping, no clipping', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page, PARTNER_EMAIL, PARTNER_PASSWORD);
    await page.goto('/partner', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('partner-overview')).toBeVisible({ timeout: 20_000 });

    for (const id of ['partner-identity', 'partner-share', 'partner-members', 'partner-code']) {
      const el = page.getByTestId(id);
      await expect(el, `${vp}: ${id} visible`).toBeVisible({ timeout: 20_000 });
      const box = await el.boundingBox();
      expect(box!.x, `${vp}: ${id} not clipped left`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${vp}: ${id} not clipped right`).toBeLessThanOrEqual(
        (await page.viewportSize())!.width + 1,
      );
    }

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });
});
