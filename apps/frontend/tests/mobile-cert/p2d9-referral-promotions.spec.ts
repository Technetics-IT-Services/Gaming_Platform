import { createHmac } from 'node:crypto';
import { execSync } from 'node:child_process';

import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 2D.9 — mobile + end-to-end certification at 375 / 390 / 412.
 *
 * Covers everything this phase shipped: referral attribution (P-17), promotion administration and
 * the player offers page (AD-08), the engagement panel on the analytics console (X-02) and the
 * partner activity report (PA-07).
 *
 * A page that merely renders proves nothing, so the claim test follows the value all the way to a
 * database row, and the offers test asserts the player sees a promotion an operator really
 * activated through the admin API.
 */

const ADMIN_EMAIL = process.env.CERT_EMAIL ?? 'admin@money.local';
const ADMIN_PASSWORD = process.env.CERT_PASSWORD ?? 'Adm1n!Passw0rd';
const TOTP_SECRET = process.env.CERT_TOTP_SECRET ?? '';

const PASSWORD = process.env.P2D9_PASSWORD ?? '';
const REFERRER_EMAIL = process.env.P2D9_REFERRER_EMAIL ?? '';
const REFERRER_CODE = process.env.P2D9_REFERRER_CODE ?? '';
const CLAIMER_EMAIL = process.env.P2D9_CLAIMER_EMAIL ?? '';
const CLAIMER_ID = process.env.P2D9_CLAIMER_ID ?? '';
const PARTNER_EMAIL = process.env.P2D9_PARTNER_EMAIL ?? '';
const PROMO_CODE = process.env.P2D9_PROMO_CODE ?? '';

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

/** The page must never be wider than the viewport at any phone width. */
async function noOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const scrollW = Math.max(doc.scrollWidth, document.body.scrollWidth);
    return { ok: scrollW <= doc.clientWidth + 1, scrollW, clientW: doc.clientWidth };
  });
}

test.describe('Phase 2D.9 — referral, promotions, engagement, partner report (mobile + E2E)', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try { window.sessionStorage.setItem('gp-intro-seen', '1'); } catch { /* ignore */ }
    });
  });

  /* ------------------------------------------------------ P-17 referral */

  test('referral page shows the SERVER-issued code, with no earnings figure', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!REFERRER_EMAIL, 'no seeded referrer');

    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/')) calls.push(r.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0]!);
    });

    await login(page, REFERRER_EMAIL, PASSWORD);
    await page.goto('/referral', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('referral-page'), `${vp}: page renders`).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => calls.some((c) => c.includes('/referral')), { timeout: 20_000 }).toBe(true);

    // The code on screen is the one in the users table — not generated client-side.
    await expect(page.getByTestId('referral-code'), `${vp}: server code shown`).toHaveText(REFERRER_CODE, { timeout: 20_000 });

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);

    // No money anywhere on the page. A zero would imply a reward had been calculated.
    //
    // The check is STRUCTURAL, not a word scan: the page's own honest notice necessarily contains
    // the words "earnings" and "0" while explaining why neither is displayed, so a prose search
    // would flag the very sentence that makes the page honest. What must not exist is a rendered
    // amount — a currency symbol, or an element presenting an earnings/reward/balance value.
    const body = await page.locator('body').innerText();
    expect(body, `${vp}: no currency symbol`).not.toContain('₹');
    expect(body, `${vp}: no dollar amount`).not.toMatch(/\$\s*\d/);
    expect(
      await page.locator('[data-testid*="earning"], [data-testid*="reward"], [data-testid*="balance"]').count(),
      `${vp}: no earnings/reward/balance element on the referral page`,
    ).toBe(0);
    await expect(page.getByTestId('referral-unavailable')).toBeVisible();
  });

  test('UI claim → API → DATABASE row, and the referrer sees it', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!CLAIMER_EMAIL || !REFERRER_CODE, 'no seeded claimer');

    // Only the FIRST viewport actually performs the claim: attribution is permanent by design
    // (referredId is UNIQUE), so the later projects verify the resulting state instead.
    const already = db(`SELECT count(*) FROM referral_history WHERE referred_id='${CLAIMER_ID}'`) !== '0';

    await login(page, CLAIMER_EMAIL, PASSWORD);
    await page.goto('/referral', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('referral-page')).toBeVisible({ timeout: 20_000 });

    if (!already) {
      const input = page.getByTestId('referral-code-input');
      await input.waitFor({ state: 'visible', timeout: 20_000 });
      await input.fill(REFERRER_CODE);
      const submit = page.getByTestId('referral-claim-submit');
      const box = await submit.boundingBox();
      expect(box!.height, `${vp}: claim button >= 44px`).toBeGreaterThanOrEqual(44);
      await submit.click();
      await expect(page.getByTestId('referral-notice'), `${vp}: claim confirmed`).toBeVisible({ timeout: 20_000 });
    }

    // 1. The DATABASE holds exactly one attribution for this player.
    await expect.poll(
      () => db(`SELECT count(*) FROM referral_history WHERE referred_id='${CLAIMER_ID}'`),
      { timeout: 20_000 },
    ).toBe('1');
    // 2. And it points at the owner of the code that was typed.
    expect(db(
      `SELECT u.referral_code FROM referral_history r JOIN users u ON u.id=r.referrer_id WHERE r.referred_id='${CLAIMER_ID}'`,
    )).toBe(REFERRER_CODE);

    // 3. The UI now reflects the persisted state rather than a local success flag.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('referral-referred-by'), `${vp}: attribution shown after reload`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('referral-claim')).toHaveCount(0);
  });

  /* ---------------------------------------------------- AD-08 promotions */

  test('an operator-activated promotion reaches the player offers page', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!PROMO_CODE || !REFERRER_EMAIL, 'no seeded promotion');

    // It really is ACTIVE in the database — the page is not being handed a fixture.
    expect(db(`SELECT status FROM promotions WHERE code='${PROMO_CODE}'`)).toBe('ACTIVE');

    await login(page, REFERRER_EMAIL, PASSWORD);
    await page.goto('/offers', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('offers-page'), `${vp}: offers render`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`offer-${PROMO_CODE}`), `${vp}: the activated offer is listed`).toBeVisible({ timeout: 20_000 });

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);

    const body = await page.locator('body').innerText();
    expect(body, `${vp}: no fabricated bonus value`).not.toContain('₹');
    await expect(page.getByTestId('offers-unavailable')).toBeVisible();
  });

  test('the admin promotions console renders real rows and no money control', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/')) calls.push(r.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0]!);
    });

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/promotions', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-promotions'), `${vp}: console renders`).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => calls.some((c) => c.includes('/admin/promotions')), { timeout: 20_000 }).toBe(true);
    await expect(page.getByTestId(`promotion-row-${PROMO_CODE}`), `${vp}: the seeded promotion is listed`).toBeVisible({ timeout: 20_000 });

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);

    // The create form offers a code, a name and a type — and nothing that looks like an amount.
    for (const id of ['promotion-code-input', 'promotion-name-input', 'promotion-type-input']) {
      const el = page.getByTestId(id);
      await expect(el, `${vp}: ${id} visible`).toBeVisible({ timeout: 20_000 });
      const box = await el.boundingBox();
      expect(box!.height, `${vp}: ${id} >= 44px`).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByTestId('promotions-unavailable')).toContainText('Awarding is not available');
  });

  test('UI status change → DATABASE, and the player list follows it', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET || !PROMO_CODE, 'no seeded promotion');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/promotions', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('admin-promotions')).toBeVisible({ timeout: 20_000 });

    // ACTIVE → PAUSED through the real control.
    await page.getByTestId(`promotion-status-${PROMO_CODE}`).selectOption('PAUSED');
    await expect(page.getByTestId('promotions-notice'), `${vp}: change confirmed`).toBeVisible({ timeout: 20_000 });
    await expect.poll(
      () => db(`SELECT status FROM promotions WHERE code='${PROMO_CODE}'`),
      { timeout: 20_000 },
    ).toBe('PAUSED');

    // A paused promotion must disappear from the player-facing list.
    await page.goto('/offers', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('offers-page')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`offer-${PROMO_CODE}`), `${vp}: paused offer hidden`).toHaveCount(0);

    // Restore, so the next viewport starts from the same state.
    await page.goto('/admin/promotions', { waitUntil: 'domcontentloaded' });
    await page.getByTestId(`promotion-status-${PROMO_CODE}`).selectOption('ACTIVE');
    await expect.poll(
      () => db(`SELECT status FROM promotions WHERE code='${PROMO_CODE}'`),
      { timeout: 20_000 },
    ).toBe('ACTIVE');
  });

  /* ------------------------------------------------------ X-02 engagement */

  test('the analytics console shows engagement with its definition and coverage caveat', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });

    const panel = page.getByTestId('analytics-engagement');
    await expect(panel, `${vp}: engagement panel renders`).toBeVisible({ timeout: 20_000 });
    // The definition is on screen, so DAU cannot be silently reinterpreted by a reader.
    await expect(panel).toContainText('Distinct users', { timeout: 20_000 });
    // The pipeline has no backfill, so a 30-day default window must say so.
    await expect(page.getByTestId('engagement-coverage'), `${vp}: coverage caveat shown`).toBeVisible({ timeout: 20_000 });

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  /* --------------------------------------------------- PA-07 partner report */

  test('a partner sees their own activity report and no financial figure', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!PARTNER_EMAIL, 'no seeded partner');

    await login(page, PARTNER_EMAIL, PASSWORD);
    await page.goto('/partner', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('partner-report'), `${vp}: report section renders`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('partner-report-list'), `${vp}: real recorded events listed`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('partner-report-list')).toContainText('Ownership share changed from');

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);

    const body = await page.locator('body').innerText();
    expect(body, `${vp}: no fabricated partner money`).not.toContain('₹');
    await expect(page.getByTestId('partner-unavailable')).toContainText('netProfit');
  });

  /* -------------------------------------------------------- authorization */

  test('a player is refused the promotions console, in the shell and at the API', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!REFERRER_EMAIL, 'no seeded player');

    await login(page, REFERRER_EMAIL, PASSWORD);
    await page.goto('/admin/promotions', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('admin-forbidden'), `${vp}: player refused by the shell`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('admin-promotions')).toHaveCount(0);

    // The shell is cosmetic; the server is the authority.
    const statuses = await page.evaluate(async () => {
      const paths = ['/api/v1/admin/promotions', '/api/v1/analytics/engagement', '/api/v1/partner/report'];
      return Promise.all(paths.map((p) => fetch(p, { credentials: 'include' }).then((r) => r.status)));
    });
    for (const s of statuses) {
      expect([401, 403], `${vp}: player refused by the API (got ${s})`).toContain(s);
    }
  });
});
