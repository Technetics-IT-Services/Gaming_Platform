import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for the frontend (Phase 2.3A — Runtime Stabilization).
 *
 * Scope: the game Runtime (`src/runtime/**`) and the demo stores it delegates to.
 * The Runtime is pure TS with no DOM, so tests run in the fast `node` environment;
 * a tiny in-memory `localStorage` shim (see `test/setup.ts`) lets the Zustand demo
 * stores import without pulling in jsdom. Coverage is scoped to the runtime so the
 * thresholds reflect the code under stabilization, not the whole UI.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts'],
    // The runtime is deterministic; keep the reporter quiet + fast for CI.
    reporters: process.env.CI ? ['default'] : ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/runtime/**/*.ts'],
      exclude: [
        'src/runtime/**/*.test.ts',
        'src/runtime/react/**', // React binding — covered by e2e, needs DOM
        'src/runtime/index.ts', // singleton wiring — exercised via integration tests
        'src/runtime/testing/**', // reference mock engines — proof scaffolding, not product
      ],
      // Phase 2.3A quality targets. CI fails if runtime coverage regresses below these.
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
