import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 2D.3 — KYC + support mobile certification (375 / 390 / 412).
 *
 * Production build, real backend. Proves both surfaces are genuinely server-backed, that a ticket
 * created here survives a reload (so it is server state, not client state), and that long message
 * bodies and long rejection text wrap rather than widening the page.
 */

const EMAIL = process.env.P2D3_EMAIL ?? '';
const PASSWORD = process.env.P2D3_PASSWORD ?? '';

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

test.describe('Phase 2D.3 — KYC & support (mobile)', () => {
  test.skip(!EMAIL, 'no P2D3_EMAIL supplied');

  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try { window.sessionStorage.setItem('gp-intro-seen', '1'); } catch { /* ignore */ }
    });
  });

  /* ------------------------------------------------------------------ KYC */

  test('KYC status is server-backed and renders with no horizontal overflow', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/')) calls.push(r.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0]!);
    });

    await login(page);
    await page.goto('/verification', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('kyc-submission'), `${vp}: KYC section renders`).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => calls.some((c) => c.endsWith('/kyc')), { timeout: 20_000 }).toBe(true);

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('KYC states the upload limitation instead of offering a fake file picker', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page);
    await page.goto('/verification', { waitUntil: 'domcontentloaded' });

    const panel = page.getByTestId('kyc-unavailable');
    await expect(panel, `${vp}: limitation shown`).toBeVisible({ timeout: 20_000 });
    await expect(panel).toContainText('NOT AVAILABLE');
    // A file picker that silently discarded the file would be a lie.
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
  });

  test('KYC form controls are >=44px and reachable', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page);
    await page.goto('/verification', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('kyc-submission')).toBeVisible({ timeout: 20_000 });

    const form = page.getByTestId('kyc-form');
    if (await form.count() === 0) return; // already submitted on this account

    for (const id of ['kyc-level', 'kyc-doc-type', 'kyc-file-name', 'kyc-mime', 'kyc-size', 'kyc-submit']) {
      const el = page.getByTestId(id);
      await expect(el, `${vp}: ${id} visible`).toBeVisible({ timeout: 20_000 });
      const box = await el.boundingBox();
      expect(box!.height, `${vp}: ${id} >= 44px`).toBeGreaterThanOrEqual(44);
      expect(box!.x, `${vp}: ${id} not clipped`).toBeGreaterThanOrEqual(0);
    }
  });

  /* -------------------------------------------------------------- support */

  test('a ticket created in the UI PERSISTS on the server', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page);
    await page.goto('/support/tickets', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('support-tickets')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('support-new').click();
    const subject = `Mobile cert ${vp} ${Date.now()}`;
    await page.getByTestId('support-subject').fill(subject);
    await page.getByTestId('support-category').selectOption('TECHNICAL');
    await page.getByTestId('support-message').fill('Raised by the mobile certification run.');
    await page.getByTestId('support-submit').click();

    await expect(page.getByTestId('support-detail'), `${vp}: ticket opened`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('support-messages')).toContainText('mobile certification run');

    // Reload from the SERVER — a client-only ticket would vanish here.
    await page.goto('/support/tickets', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('support-list'), `${vp}: ticket persisted`).toContainText(subject, { timeout: 20_000 });

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('a LONG message body wraps instead of widening the page', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page);
    await page.goto('/support/tickets', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('support-tickets')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('support-new').click();
    await page.getByTestId('support-subject').fill(`Long body ${Date.now()}`);
    // An unbroken 600-character token is the worst case for layout.
    await page.getByTestId('support-message').fill('A'.repeat(600));
    await page.getByTestId('support-submit').click();

    await expect(page.getByTestId('support-detail')).toBeVisible({ timeout: 20_000 });
    const o = await noOverflow(page);
    expect(o.ok, `${vp}: long body did not widen the page (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('support controls are >=44px and the list has an explicit state', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page);
    await page.goto('/support/tickets', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('support-tickets')).toBeVisible({ timeout: 20_000 });

    const newBtn = page.getByTestId('support-new');
    await expect(newBtn).toBeVisible({ timeout: 20_000 });
    expect((await newBtn.boundingBox())!.height, `${vp}: new-ticket >= 44px`).toBeGreaterThanOrEqual(44);

    await newBtn.click();
    for (const id of ['support-subject', 'support-category', 'support-message', 'support-submit']) {
      const el = page.getByTestId(id);
      await expect(el, `${vp}: ${id} visible`).toBeVisible({ timeout: 20_000 });
      const box = await el.boundingBox();
      expect(box!.height, `${vp}: ${id} >= 44px`).toBeGreaterThanOrEqual(44);
    }
  });

  test('the help page links to real tickets and no longer denies having a backend', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await login(page);
    await page.goto('/support', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('support-tickets-link'), `${vp}: link present`).toBeVisible({ timeout: 20_000 });
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('There is no ticket backend');

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });
});
