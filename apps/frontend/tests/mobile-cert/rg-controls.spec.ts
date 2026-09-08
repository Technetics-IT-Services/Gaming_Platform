import { test, expect, type Page } from '@playwright/test';

/**
 * Responsible gaming controls — mobile certification (375 / 390 / 412).
 *
 * Production build, real backend. Proves the controls are genuinely server-backed, that a limit set
 * here is actually returned by the server afterwards, and that the screen is usable on a phone.
 */

const EMAIL = process.env.RG_EMAIL ?? '';
const PASSWORD = process.env.RG_PASSWORD ?? '';

async function dismissIntro(page: Page) {
  const skip = page.getByRole('button', { name: /skip intro/i });
  try {
    if (await skip.isVisible()) { await skip.click(); await page.waitForTimeout(250); }
  } catch { /* none */ }
}

async function login(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await dismissIntro(page);
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
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

test.describe('Responsible gaming controls (mobile)', () => {
  test.skip(!EMAIL, 'no RG_EMAIL supplied');

  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try { window.sessionStorage.setItem('gp-intro-seen', '1'); } catch { /* ignore */ }
    });
  });

  test('renders SERVER-backed controls with no horizontal overflow', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/')) calls.push(r.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0]!);
    });

    await login(page);
    await page.goto('/responsible-gaming', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('rg-controls'), `${vp}: controls render`).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => calls.some((c) => c.includes('/responsible-gaming')), { timeout: 20_000 }).toBe(true);

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('every control is a >=44px touch target and reachable', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page);
    await page.goto('/responsible-gaming', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('rg-controls')).toBeVisible({ timeout: 20_000 });

    for (const id of ['rg-type', 'rg-period', 'rg-amount', 'rg-save-limit', 'rg-cooloff-days', 'rg-cooloff']) {
      const el = page.getByTestId(id);
      await expect(el, `${vp}: ${id} visible`).toBeVisible({ timeout: 20_000 });
      const box = await el.boundingBox();
      expect(box!.height, `${vp}: ${id} >= 44px`).toBeGreaterThanOrEqual(44);
      expect(box!.x, `${vp}: ${id} not clipped`).toBeGreaterThanOrEqual(0);
    }
  });

  test('setting a limit PERSISTS on the server and shows real usage', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page);
    await page.goto('/responsible-gaming', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('rg-controls')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('rg-type').selectOption('DEPOSIT');
    await page.getByTestId('rg-period').selectOption('MONTHLY');
    await page.getByTestId('rg-amount').fill('12345');
    await page.getByTestId('rg-save-limit').click();

    await expect(page.getByTestId('rg-notice'), `${vp}: save confirmed`).toBeVisible({ timeout: 20_000 });

    // Reload from the SERVER — a client-only limit would vanish here.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('rg-limit-list'), `${vp}: limit persisted`).toContainText('12345', { timeout: 20_000 });
    await expect(page.getByTestId('rg-limit-list')).toContainText('Used');

    // Clean up so the run is repeatable.
    await page.getByTestId('rg-remove-DEPOSIT-MONTHLY').click();
    await expect(page.getByTestId('rg-notice')).toBeVisible({ timeout: 20_000 });
  });

  test('self-exclusion requires explicit confirmation and states withdrawals stay open', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page);
    await page.goto('/responsible-gaming', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('rg-controls')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('rg-self-exclude').click();
    const confirm = page.getByTestId('rg-exclude-confirm');
    await expect(confirm, `${vp}: confirmation required`).toBeVisible({ timeout: 20_000 });
    await expect(confirm).toContainText('indefinitely');
    await expect(confirm, `${vp}: withdrawal stays possible`).toContainText('withdraw');

    // Deliberately NOT confirmed — the test must not permanently exclude the fixture account.
    const box = await page.getByTestId('rg-exclude-confirm-yes').boundingBox();
    expect(box!.height, `${vp}: confirm button >= 44px`).toBeGreaterThanOrEqual(44);
  });

  test('the page no longer claims these controls are unavailable', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page);
    await page.goto('/responsible-gaming', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('rg-controls')).toBeVisible({ timeout: 20_000 });

    const body = await page.locator('body').innerText();
    expect(body, `${vp}: stale "not yet available" copy is gone`).not.toContain('self-exclusion and cooling-off are not yet');
    // But session limits are still honestly excluded.
    expect(body).toContain('Session-time limits');
  });
});
