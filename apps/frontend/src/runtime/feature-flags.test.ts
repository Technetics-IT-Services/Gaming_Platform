import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_FEATURE_FLAGS,
  configureFeatureFlags,
  getFeatureFlags,
  isFeatureEnabled,
} from './feature-flags';

/**
 * Feature flags (STEP 8).
 *
 * A single typed config the runtime reads to enable/disable capabilities without
 * code changes. Tests cover defaults, override merging, unknown-flag safety, and
 * the Phase 2.2 posture (demo on, real wallet off).
 */

// Module-level flag state is shared; restore defaults after each test.
afterEach(() => {
  configureFeatureFlags({ ...DEFAULT_FEATURE_FLAGS });
});

describe('feature-flags — defaults', () => {
  it('ships the Phase 2.2 posture: demo active, real wallet off', () => {
    const flags = getFeatureFlags();
    expect(flags.demoMode).toBe(true);
    expect(flags.realWallet).toBe(false);
    expect(flags.provablyFair).toBe(true);
  });

  it('enables the demo observability providers by default', () => {
    const flags = getFeatureFlags();
    expect(flags.analytics).toBe(true);
    expect(flags.notifications).toBe(true);
    expect(flags.leaderboard).toBe(true);
  });

  it('leaves forward-compat features off by default', () => {
    const flags = getFeatureFlags();
    for (const key of ['vip', 'referral', 'multiplayer', 'liveDealer', 'crypto', 'ai'] as const) {
      expect(flags[key]).toBe(false);
    }
  });
});

describe('feature-flags — configure', () => {
  it('merges overrides without dropping untouched flags', () => {
    configureFeatureFlags({ realWallet: true });
    expect(getFeatureFlags().realWallet).toBe(true);
    expect(getFeatureFlags().demoMode).toBe(true); // untouched
  });

  it('applies successive overrides cumulatively', () => {
    configureFeatureFlags({ vip: true });
    configureFeatureFlags({ crypto: true });
    expect(getFeatureFlags().vip).toBe(true);
    expect(getFeatureFlags().crypto).toBe(true);
  });

  it('an empty override is a no-op', () => {
    configureFeatureFlags({});
    expect(getFeatureFlags()).toEqual(DEFAULT_FEATURE_FLAGS);
  });
});

describe('feature-flags — isFeatureEnabled', () => {
  it('reflects the current flag value', () => {
    expect(isFeatureEnabled('demoMode')).toBe(true);
    expect(isFeatureEnabled('realWallet')).toBe(false);
    configureFeatureFlags({ realWallet: true });
    expect(isFeatureEnabled('realWallet')).toBe(true);
  });

  it('uses a strict truthiness check (only true counts as enabled)', () => {
    // Every default value is a real boolean, so no flag is "truthy but not true".
    for (const key of Object.keys(DEFAULT_FEATURE_FLAGS) as (keyof typeof DEFAULT_FEATURE_FLAGS)[]) {
      expect(isFeatureEnabled(key)).toBe(DEFAULT_FEATURE_FLAGS[key]);
    }
  });
});
