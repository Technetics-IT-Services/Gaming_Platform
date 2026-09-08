import { defineConfig } from '@playwright/test';

/**
 * Phase 2C.13 — mobile device-emulation certification config. Runs against an ALREADY-RUNNING
 * production build (demo OFF, same-origin real backend) on :3100. Three mobile viewports; screenshots
 * captured as release evidence. Physical-device testing is NOT emulated here (documented limitation).
 */
export default defineConfig({
  testDir: './tests/mobile-cert',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './mobile-cert-results',
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'off',
    hasTouch: true,
    isMobile: true,
  },
  projects: [
    { name: 'iphone-375x812', use: { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) Mobile' } },
    { name: 'iphone-390x844', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Mobile' } },
    { name: 'android-412x915', use: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2.6, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile' } },
  ],
});
