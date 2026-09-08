import { test, expect, type Page } from '@playwright/test';

/**
 * Phase 2C.15 — DEMO AUTH REDIRECT-LOOP certification (mobile, 375/390/412).
 *
 * Runs against a DEMO-MODE frontend (`next dev`, or a build with NEXT_PUBLIC_DEMO_MODE=true) with the
 * real backend reachable — that combination is what produced the loop: demo login → /dashboard →
 * user-scoped queries → backend 401 → /auth/refresh 401 → setUnauthenticated() → /login → repeat.
 *
 * Asserts:
 *   A. A demo login lands on /dashboard and STAYS there.
 *   B. A demo session survives backend 401s (no /auth/refresh, no bounce).
 *   C. No user-scoped request is fired at all while in demo mode.
 *   F. Real-money routes refuse a demo session instead of pretending it is authenticated.
 *   G. Demo logout works.
 *
 * Point it at the demo origin with DEMO_BASE_URL (default http://localhost:3100).
 */

const BASE = process.env.DEMO_BASE_URL ?? 'http://localhost:3100';
const DEMO_EMAIL = 'demo.player@example.com';
const DEMO_PASSWORD = 'demo-password-123';

/**
 * Requests a demo session must never make ONCE IT EXISTS. Note that `/auth/refresh` fired while the
 * player is still on /login is legitimate — that is the real-session bootstrap, which must keep
 * working in demo-mode builds so a real login in development still restores. Every assertion below
 * therefore only inspects traffic recorded AFTER the demo session is established.
 */
const FORBIDDEN = [
  '/auth/refresh',
  '/wallet',
  '/wallet-engine',
  '/cashier',
  '/users/me',
  '/recently-played',
  '/games/history',
  '/games/recommended',
  '/ai/for-you',
  '/favorites',
  '/play',
];

function isForbidden(url: string): boolean {
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0] ?? '';
  if (!path.includes('/api/')) return false;
  return FORBIDDEN.some((f) => path.includes(f));
}

/** Record every API request the page makes, so we can prove which ones never happen. */
function recordApiCalls(page: Page): { all: string[]; since: (mark: number) => string[]; mark: () => number } {
  const all: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/api/')) all.push(u);
  });
  return { all, since: (mark: number) => all.slice(mark), mark: () => all.length };
}

async function dismissIntro(page: Page) {
  const skip = page.getByRole('button', { name: /skip intro/i });
  try {
    if (await skip.isVisible({ timeout: 1500 })) {
      await skip.click();
      await page.waitForTimeout(400);
    }
  } catch {
    /* no intro on this route */
  }
}

async function demoLogin(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await dismissIntro(page);
  await page.locator('#email').fill(DEMO_EMAIL);
  await page.locator('#password').fill(DEMO_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname.startsWith('/dashboard'), { timeout: 30_000 });
  await dismissIntro(page);
}

test.describe('demo auth isolation (Phase 2C.15)', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try {
        window.sessionStorage.setItem('gp-intro-seen', '1');
      } catch {
        /* ignore */
      }
    });
  });

  test('A/B/C — demo login lands on /dashboard, stays there, and fires no user-scoped request', async ({
    page,
  }, testInfo) => {
    const vp = testInfo.project.name;
    const calls = recordApiCalls(page);

    await demoLogin(page);
    const afterLogin = calls.mark(); // ignore the pre-login real-session bootstrap on /login

    // A — landed on the dashboard.
    expect(page.url(), `${vp}: demo login must land on /dashboard`).toContain('/dashboard');

    // B — hold there. Pre-hotfix the 401 → refresh → unauthenticated chain bounced within ~1–2s.
    await page.waitForTimeout(6_000);
    expect(page.url(), `${vp}: demo session must NOT be bounced to /login`).toContain('/dashboard');

    // The client must still consider itself signed in (the bottom nav only renders when authed).
    await expect(page.locator('nav[aria-label="Primary"]').first(), `${vp}: still authenticated`).toBeVisible({
      timeout: 15_000,
    });

    // C/F — once the demo session exists, nothing user-scoped and crucially no /auth/refresh is
    // requested. Pre-hotfix this list contained /games/recommended, /recently-played and the
    // /auth/refresh whose 401 destroyed the session.
    const violations = calls.since(afterLogin).filter(isForbidden);
    expect(violations, `${vp}: demo session made forbidden requests: ${violations.join(', ')}`).toEqual([]);
  });

  test('B — a reload keeps the demo session (no redirect loop on session restore)', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await demoLogin(page);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await dismissIntro(page);
    await page.waitForTimeout(4_000);
    expect(page.url(), `${vp}: reload must keep the demo session on /dashboard`).toContain('/dashboard');
  });

  test('F — real-money routes refuse a demo session', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    const calls = recordApiCalls(page);
    await demoLogin(page);
    const afterLogin = calls.mark();

    for (const route of ['/dice-money', '/deposit', '/withdraw', '/wallet', '/game-history', '/profile']) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
      await dismissIntro(page);
      await expect(
        page.getByTestId('real-money-blocked'),
        `${vp}: ${route} must refuse a demo session`,
      ).toBeVisible({ timeout: 15_000 });
      // Not bounced to /login either — the demo session is intact.
      expect(page.url(), `${vp}: ${route} must not redirect to /login`).not.toContain('/login');
    }

    const violations = calls.since(afterLogin).filter(isForbidden);
    expect(violations, `${vp}: demo session hit real-money APIs: ${violations.join(', ')}`).toEqual([]);
  });

  test('G — demo logout works', async ({ page }, testInfo) => {
    const vp = testInfo.project.name;
    await demoLogin(page);

    // Clear the session the way the app does, then confirm the guard sends us to /login.
    await page.evaluate(() => window.localStorage.removeItem('gp-demo-session'));
    await page.goto(`${BASE}/wallet`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL((url) => url.pathname.startsWith('/login'), { timeout: 20_000 });
    expect(page.url(), `${vp}: after logout a guarded route must go to /login`).toContain('/login');
  });
});
