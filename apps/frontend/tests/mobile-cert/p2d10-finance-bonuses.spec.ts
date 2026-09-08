import { createHmac } from 'node:crypto';
import { execSync } from 'node:child_process';

import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 2D.10 — mobile + end-to-end certification at 375 / 390 / 412.
 *
 * Covers what this phase shipped: the finance console (F-01 queues, F-06 cash flow, F-07 search and
 * failures), operator bonus administration (AD-07), and the partner team panel (PA-07).
 *
 * The bonus test follows a grant all the way to a database row and proves the idempotency
 * reference by submitting it twice.
 */

const ADMIN_EMAIL = process.env.CERT_EMAIL ?? 'admin@money.local';
const ADMIN_PASSWORD = process.env.CERT_PASSWORD ?? 'Adm1n!Passw0rd';
const TOTP_SECRET = process.env.CERT_TOTP_SECRET ?? '';

const PASSWORD = process.env.P2D9_PASSWORD ?? '';
const PLAYER_EMAIL = process.env.P2D9_REFERRER_EMAIL ?? '';
const PLAYER_ID = process.env.P2D10_PLAYER_ID ?? '';
const PARTNER_EMAIL = process.env.P2D9_PARTNER_EMAIL ?? '';

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

test.describe('Phase 2D.10 — finance, bonuses, partner team (mobile + E2E)', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try { window.sessionStorage.setItem('gp-intro-seen', '1'); } catch { /* ignore */ }
    });
  });

  /* ------------------------------------------------------- F-01/06/07 */

  test('the finance console renders real server data with no horizontal overflow', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/')) calls.push(r.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0]!);
    });

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/finance', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-finance'), `${vp}: console renders`).toBeVisible({ timeout: 20_000 });
    for (const route of ['/admin/finance/queues', '/admin/finance/cash-flow', '/admin/finance/transactions', '/admin/finance/failures']) {
      // Recorded paths keep the `/api/v1` prefix the same-origin proxy adds.
      await expect.poll(() => calls.some((c) => c.endsWith(route)), { timeout: 20_000 }).toBe(true);
    }

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('cash flow shows a per-currency row that matches the database', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/finance', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('finance-cashflow')).toBeVisible({ timeout: 20_000 });

    const inrRow = page.getByTestId('cashflow-INR');
    await expect(inrRow, `${vp}: INR row present`).toBeVisible({ timeout: 20_000 });

    // The number on screen is the number in Postgres for the same window (default 30 days).
    const dbIn = db(
      "SELECT COALESCE(SUM(d.amount),0)::numeric FROM deposit_requests d JOIN currencies c ON c.id=d.currency_id "
      + "WHERE d.status='COMPLETED' AND c.code='INR' AND d.created_at >= (now() - interval '30 days')",
    );
    const shown = (await inrRow.locator('td').nth(1).innerText()).trim();
    expect(Number(shown), `${vp}: money-in matches SQL`).toBeCloseTo(Number(dbIn), 2);

    // And the page never calls it revenue.
    const body = await page.locator('body').innerText();
    expect(body, `${vp}: states it is not revenue`).toContain('not revenue');
  });

  test('the failure view explains why it does not read the ledger', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/finance', { waitUntil: 'domcontentloaded' });

    const note = page.getByTestId('failures-note');
    await expect(note, `${vp}: ledger note shown`).toBeVisible({ timeout: 20_000 });
    await expect(note).toContainText('no failure status by design');
  });

  test('transaction search filters are usable at phone width', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/finance', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('finance-search')).toBeVisible({ timeout: 20_000 });

    for (const id of ['search-type', 'search-reference', 'search-submit']) {
      const el = page.getByTestId(id);
      await expect(el, `${vp}: ${id} visible`).toBeVisible({ timeout: 20_000 });
      const box = await el.boundingBox();
      expect(box!.height, `${vp}: ${id} >= 44px`).toBeGreaterThanOrEqual(44);
      expect(box!.x, `${vp}: ${id} not clipped`).toBeGreaterThanOrEqual(0);
    }

    await page.getByTestId('search-type').selectOption('GAME_BET');
    await page.getByTestId('search-submit').click();
    await expect(page.getByTestId('search-table').or(page.getByTestId('search-empty')))
      .toBeVisible({ timeout: 20_000 });
  });

  /* ------------------------------------------------------------ AD-07 */

  test('UI bonus grant → API → DATABASE, and a replay does not double-grant', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET || !PLAYER_ID, 'no seeded player id');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/bonuses', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('admin-bonuses'), `${vp}: console renders`).toBeVisible({ timeout: 20_000 });

    // A reference unique to this viewport, so the three projects do not collide.
    const reference = `mobcert-${vp}-${Date.now()}`;
    await page.getByTestId('bonus-user').fill(PLAYER_ID);
    await page.getByTestId('bonus-amount').fill('12.50');
    await page.getByTestId('bonus-wagering').fill('25');
    await page.getByTestId('bonus-reference').fill(reference);
    await page.getByTestId('bonus-reason').fill('Mobile certification grant');

    const submit = page.getByTestId('bonus-submit');
    const box = await submit.boundingBox();
    expect(box!.height, `${vp}: submit >= 44px`).toBeGreaterThanOrEqual(44);
    await submit.click();
    await expect(page.getByTestId('bonuses-notice'), `${vp}: grant confirmed`).toBeVisible({ timeout: 20_000 });

    // 1. The DATABASE holds the operator's figures, audited to this reference.
    await expect.poll(
      () => db(`SELECT count(*) FROM audit_trails WHERE entity_type='bonus_grant' AND changes->>'reference'='${reference}'`),
      { timeout: 20_000 },
    ).toBe('1');
    const bonusId = db(`SELECT entity_id FROM audit_trails WHERE entity_type='bonus_grant' AND changes->>'reference'='${reference}' LIMIT 1`);
    expect(db(`SELECT balance FROM bonus_wallets WHERE id='${bonusId}'`)).toContain('12.5');

    // 2. Submitting the SAME reference again must not create a second bonus.
    await page.getByTestId('bonus-user').fill(PLAYER_ID);
    await page.getByTestId('bonus-amount').fill('12.50');
    await page.getByTestId('bonus-reference').fill(reference);
    await page.getByTestId('bonus-reason').fill('Replay of the same decision');
    await page.getByTestId('bonus-submit').click();
    await expect(page.getByTestId('bonuses-notice')).toBeVisible({ timeout: 20_000 });
    await expect.poll(
      () => db(`SELECT count(*) FROM audit_trails WHERE entity_type='bonus_grant' AND changes->>'reference'='${reference}'`),
      { timeout: 20_000 },
    ).toBe('1');

    // 3. Clean up so the player is not left holding a certification bonus.
    await page.getByTestId(`bonus-expire-${bonusId}`).click();
    await expect.poll(
      () => db(`SELECT status FROM bonus_wallets WHERE id='${bonusId}'`),
      { timeout: 20_000 },
    ).toBe('CLOSED');

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('the bonus console states that nothing is awarded automatically', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/bonuses', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('bonuses-unavailable'), `${vp}: notice shown`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('bonuses-unavailable')).toContainText('BUSINESS DEFINITION MISSING');
  });

  /* ------------------------------------------------------------ PA-07 */

  test('a partner sees their own team, with no user ids', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!PARTNER_EMAIL, 'no seeded partner');

    await login(page, PARTNER_EMAIL, PASSWORD);
    await page.goto('/partner', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('partner-members-panel'), `${vp}: team panel renders`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('partner-members-list')).toBeVisible({ timeout: 20_000 });

    // A username is a colleague's name; a user id is an identifier for another surface.
    const listText = await page.getByTestId('partner-members-list').innerText();
    expect(listText, `${vp}: no uuid rendered`).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  /* --------------------------------------------------------- authorization */

  test('a player is refused finance and bonuses, in the shell and at the API', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!PLAYER_EMAIL, 'no seeded player');

    await login(page, PLAYER_EMAIL, PASSWORD);
    for (const route of ['/admin/finance', '/admin/bonuses']) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('admin-forbidden'), `${vp}: player refused ${route}`).toBeVisible({ timeout: 20_000 });
    }
    await expect(page.getByTestId('admin-finance')).toHaveCount(0);
    await expect(page.getByTestId('admin-bonuses')).toHaveCount(0);

    const statuses = await page.evaluate(async () => {
      const paths = ['/api/v1/admin/finance/cash-flow', '/api/v1/admin/bonuses', '/api/v1/partner/members'];
      return Promise.all(paths.map((p) => fetch(p, { credentials: 'include' }).then((r) => r.status)));
    });
    for (const s of statuses) {
      expect([401, 403], `${vp}: API refuses a player (got ${s})`).toContain(s);
    }
  });
});
