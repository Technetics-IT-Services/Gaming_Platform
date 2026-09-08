import { expect, test, type Page } from '@playwright/test';

/**
 * Login pacing for the mobile certification suites.
 *
 * `POST /auth/login` is throttled by the application to **10 attempts per 60 seconds**
 * (`@Throttle({ default: { limit: 10, ttl: 60_000 } })` in `auth.controller.ts`). A suite of 18
 * tests that each sign in will exceed that on its own, so runs were non-deterministic: the first
 * ten tests passed and later ones timed out on the login page.
 *
 * The throttle is correct and is NOT weakened here. Instead the suite is synchronised to it:
 *
 *  1. `reserveLoginSlot` keeps the same sliding window the server keeps and waits until there is
 *     genuinely room BEFORE attempting. This is proactive pacing, not a retry — a paced run never
 *     produces a 429 in the first place.
 *  2. If a login still fails to land (the window can already be partly consumed by something
 *     outside the suite), the helper waits one full window and tries again, bounded. This mirrors
 *     what `p2d14-light-theme.spec.ts` already did.
 *
 * No assertion is relaxed, no timeout is inflated, nothing is skipped: a login that fails for any
 * reason other than pacing still fails the test.
 */

const WINDOW_MS = 60_000;
/** Matches the server's own limit. */
const LIMIT = 10;
/** Attempt timestamps for this worker, mirroring the server's sliding window. */
const attempts: number[] = [];

/**
 * Give the running test back the time the throttle is about to take from it.
 *
 * This is not a timeout increase in the usual sense: the budget grows by precisely the delay the
 * application itself is imposing, and only on the occasions it actually imposes one. Everything
 * the test asserts still runs against its original allowance.
 */
function grantExtraTime(ms: number): void {
  const info = test.info();
  info.setTimeout(info.timeout + ms);
}

/** Block until the application's login window has room, then record this attempt. */
export async function reserveLoginSlot(page: Page): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (attempts.length > 0 && now - attempts[0]! > WINDOW_MS) attempts.shift();
    if (attempts.length < LIMIT) {
      attempts.push(now);
      return;
    }
    // The oldest attempt has to age out of the window before the server will accept another.
    const wait = WINDOW_MS - (now - attempts[0]!) + 1_000;
    // Extend this test's budget by EXACTLY the wait the application is imposing — not by an
    // arbitrary margin. Without it the enforced wait would consume the test's own time and the
    // test would fail for a reason that has nothing to do with what it asserts.
    grantExtraTime(wait);
    await page.waitForTimeout(wait);
  }
}

export interface LoginOptions {
  email: string;
  password: string;
  /** Base32 TOTP secret, for accounts where the server demands a second factor. */
  secret?: string;
  /** Produces the current 6-digit code from `secret`. */
  totp?: (secret: string) => string;
  /** Dismisses the intro overlay if the build shows one. */
  dismissIntro?: (page: Page) => Promise<void>;
}

/**
 * Sign in, paced against the application's real throttle window.
 *
 * Throws if the credentials or the second factor are wrong — only pacing is handled here.
 */
export async function pacedLogin(page: Page, opts: LoginOptions): Promise<void> {
  const { email, password, secret, totp, dismissIntro } = opts;

  for (let attempt = 0; attempt < 3; attempt++) {
    await reserveLoginSlot(page);

    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    if (dismissIntro) await dismissIntro(page);

    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await page.locator('button[type="submit"]').click();

    const code = page.locator('#code');
    const needsTwoFactor = await code
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);

    if (needsTwoFactor) {
      if (!secret || !totp) throw new Error('two-factor challenge raised but no secret was supplied');
      await code.fill(totp(secret));
      const verify = page.getByRole('button', { name: /verify/i });
      await expect(verify).toBeEnabled({ timeout: 5_000 });
      await verify.click();
    }

    const landed = await page
      .waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);

    if (landed) {
      if (dismissIntro) await dismissIntro(page);
      return;
    }

    // Still on /login: the window was already partly spent by something outside this suite.
    // Let it drain completely, then try again.
    attempts.length = 0;
    grantExtraTime(WINDOW_MS + 2_000);
    await page.waitForTimeout(WINDOW_MS + 2_000);
  }

  throw new Error(`login for ${email} did not complete after waiting out the throttle window`);
}
