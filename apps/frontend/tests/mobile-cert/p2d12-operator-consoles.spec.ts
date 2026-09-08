import { createHmac } from 'node:crypto';
import { execSync } from 'node:child_process';

import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 2D.12 — mobile certification of the four operator consoles at 375 / 390 / 412.
 *
 * These screens closed the "guarded backend, no UI" gap. The cashier console is the important one:
 * with the payment gateway deferred, operator credit IS the deposit rail, so this is the screen a
 * real operator will live in.
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

test.describe('Phase 2D.12 — operator consoles (mobile + E2E)', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try { window.sessionStorage.setItem('gp-intro-seen', '1'); } catch { /* ignore */ }
    });
  });

  test('the cashier console renders the real queue with no horizontal overflow', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/')) calls.push(r.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0]!);
    });

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/cashier', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-cashier'), `${vp}: console renders`).toBeVisible({ timeout: 20_000 });
    await expect.poll(
      () => calls.some((c) => c.endsWith('/admin/finance/cashier/queue')),
      { timeout: 20_000 },
    ).toBe(true);

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('the queue count matches the database, and both tabs work', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/cashier', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('admin-cashier')).toBeVisible({ timeout: 20_000 });

    // The number on screen is the number of rows genuinely awaiting a decision.
    const pendingDeposits = db(
      "SELECT count(*) FROM deposit_requests WHERE status IN ('PENDING','PROCESSING')",
    );
    await expect(page.locator('body'), `${vp}: deposit backlog shown`)
      .toContainText(`${pendingDeposits} awaiting a decision`, { timeout: 20_000 });

    const withdrawTab = page.getByTestId('cashier-tab-withdrawals');
    const box = await withdrawTab.boundingBox();
    expect(box!.height, `${vp}: tab >= 44px`).toBeGreaterThanOrEqual(44);
    await withdrawTab.click();

    const pendingWithdrawals = db(
      "SELECT count(*) FROM withdrawal_requests WHERE status IN ('PENDING','UNDER_REVIEW','APPROVED')",
    );
    await expect(page.locator('body'), `${vp}: withdrawal backlog shown`)
      .toContainText(`${pendingWithdrawals} awaiting a decision`, { timeout: 20_000 });
  });

  test('the cashier console offers NO amount input — only a decision', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/cashier', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('admin-cashier')).toBeVisible({ timeout: 20_000 });

    // An editable amount would let an operator credit a figure the player never requested.
    const numericInputs = await page.locator('input[type="number"], input[inputmode="decimal"]').count();
    expect(numericInputs, `${vp}: no amount field on the cashier console`).toBe(0);
  });

  test('a large backlog is paged, not silently truncated', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/cashier', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('cashier-tab-withdrawals').click();
    await expect(page.getByTestId('cashier-table')).toBeVisible({ timeout: 20_000 });

    const total = Number(db(
      "SELECT count(*) FROM withdrawal_requests WHERE status IN ('PENDING','UNDER_REVIEW','APPROVED')",
    ));
    if (total > 50) {
      // The defect this replaced: a capped, unpaged queue hid newly-created work entirely.
      await expect(page.getByTestId('cashier-paging'), `${vp}: paging offered`).toBeVisible({ timeout: 20_000 });
      const next = page.getByTestId('cashier-next');
      const box = await next.boundingBox();
      expect(box!.height, `${vp}: next >= 44px`).toBeGreaterThanOrEqual(44);
    }
  });

  test('the KYC console renders and states the document-storage gap', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/kyc', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-kyc'), `${vp}: console renders`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('kyc-upload-unavailable'), `${vp}: storage gap stated`)
      .toContainText('Document images are not stored', { timeout: 20_000 });

    const filter = page.getByTestId('kyc-status-filter');
    const box = await filter.boundingBox();
    expect(box!.height, `${vp}: filter >= 44px`).toBeGreaterThanOrEqual(44);

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('the users console lists real accounts and search works', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/users', { waitUntil: 'domcontentloaded' });

    await expect(page.getByTestId('admin-users'), `${vp}: console renders`).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('users-table'), `${vp}: real accounts listed`).toBeVisible({ timeout: 20_000 });

    // The admin account itself must be findable.
    await page.getByTestId('users-search').fill('admin@money.local');
    await page.getByTestId('users-search-submit').click();
    await expect(page.locator('body'), `${vp}: search finds the admin`)
      .toContainText('admin@money.local', { timeout: 20_000 });

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('UI expense → API → DATABASE, with no profit figure anywhere', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!TOTP_SECRET, 'no CERT_TOTP_SECRET supplied');

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, TOTP_SECRET);
    await page.goto('/admin/expenses', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('admin-expenses'), `${vp}: console renders`).toBeVisible({ timeout: 20_000 });

    // A category unique to this viewport, so the three projects do not collide.
    const code = `MOB${vp.replace(/[^A-Z0-9]/gi, '').slice(0, 8).toUpperCase()}${Date.now() % 100000}`;
    await page.getByTestId('category-code').fill(code);
    await page.getByTestId('category-name').fill('Mobile certification');
    await page.getByTestId('category-submit').click();
    await expect(page.getByTestId('expenses-notice'), `${vp}: category created`).toBeVisible({ timeout: 20_000 });

    await expect.poll(
      () => db(`SELECT count(*) FROM expense_categories WHERE code='${code}'`),
      { timeout: 20_000 },
    ).toBe('1');

    // Record an expense against it and follow the value into the database.
    await page.getByTestId('expense-category').selectOption({ label: `${code} — Mobile certification` });
    await page.getByTestId('expense-description').fill('Mobile certification spend');
    await page.getByTestId('expense-amount').fill('321.50');
    const submit = page.getByTestId('expense-submit');
    const box = await submit.boundingBox();
    expect(box!.height, `${vp}: submit >= 44px`).toBeGreaterThanOrEqual(44);
    await submit.click();
    await expect(page.getByTestId('expenses-notice')).toBeVisible({ timeout: 20_000 });

    await expect.poll(
      () => db(
        `SELECT count(*) FROM expenses e JOIN expense_categories c ON c.id=e.category_id `
        + `WHERE c.code='${code}' AND e.amount::numeric = 321.50`,
      ),
      { timeout: 20_000 },
    ).toBe('1');

    // Recording business spending must never be presented as profit.
    const body = await page.locator('body').innerText();
    expect(body, `${vp}: no profit figure`).not.toMatch(/profit[^.]{0,20}[0-9]/i);
    await expect(page.getByTestId('expenses-unavailable')).toBeVisible();

    const o = await noOverflow(page);
    expect(o.ok, `${vp}: no horizontal overflow (${o.scrollW}>${o.clientW})`).toBe(true);
  });

  test('a player is refused every new console, in the shell and at the API', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    test.skip(!PLAYER_EMAIL, 'no seeded player');

    await login(page, PLAYER_EMAIL, PASSWORD);
    for (const route of ['/admin/cashier', '/admin/kyc', '/admin/users', '/admin/expenses']) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('admin-forbidden'), `${vp}: player refused ${route}`).toBeVisible({ timeout: 20_000 });
    }

    const statuses = await page.evaluate(async () => {
      const paths = [
        '/api/v1/admin/finance/cashier/queue',
        '/api/v1/admin/kyc',
        '/api/v1/admin/users',
        '/api/v1/admin/finance/expenses',
      ];
      return Promise.all(paths.map((p) => fetch(p, { credentials: 'include' }).then((r) => r.status)));
    });
    for (const s of statuses) {
      expect([401, 403], `${vp}: API refuses a player (got ${s})`).toContain(s);
    }
  });
});
