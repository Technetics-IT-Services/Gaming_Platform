import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the database package (Phase 2A). Runs the bootstrap-seed tests in a
 * Node environment. Integration cases are gated on a reachable `DATABASE_URL` and skip
 * cleanly when no database is present, so the default suite never requires one.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['prisma/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
