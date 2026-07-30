/**
 * Runtime feature flags (Phase 2.2).
 *
 * A single, typed config object the Runtime reads to enable/disable capabilities
 * WITHOUT code changes. Future features (real wallet, VIP, referral, multiplayer,
 * live dealer, crypto, AI) flip a flag rather than requiring a rewrite.
 *
 * Phase 2.2 ships DEMO providers active and the real wallet OFF, per the brief.
 */
export interface RuntimeFeatureFlags {
  /** Use the client-side demo providers (true) vs the real backend providers (false). */
  demoMode: boolean;
  /** Route wallet through the backend double-entry ledger. Off in 2.2. */
  realWallet: boolean;
  /** Derive outcomes from the provably-fair provider (vs a plain RNG). */
  provablyFair: boolean;
  analytics: boolean;
  notifications: boolean;
  leaderboard: boolean;
  // forward-compatible — not implemented in 2.2
  vip: boolean;
  referral: boolean;
  multiplayer: boolean;
  liveDealer: boolean;
  crypto: boolean;
  ai: boolean;
}

export const DEFAULT_FEATURE_FLAGS: RuntimeFeatureFlags = {
  demoMode: true,
  realWallet: false,
  provablyFair: true,
  analytics: true,
  notifications: true,
  leaderboard: true,
  vip: false,
  referral: false,
  multiplayer: false,
  liveDealer: false,
  crypto: false,
  ai: false,
};

let flags: RuntimeFeatureFlags = { ...DEFAULT_FEATURE_FLAGS };

/** Read the (immutable copy of) current flags. */
export function getFeatureFlags(): Readonly<RuntimeFeatureFlags> {
  return flags;
}

/** Merge-in overrides (e.g. from env / remote config) once at bootstrap. */
export function configureFeatureFlags(overrides: Partial<RuntimeFeatureFlags>): void {
  flags = { ...flags, ...overrides };
}

export function isFeatureEnabled(name: keyof RuntimeFeatureFlags): boolean {
  return flags[name] === true;
}
