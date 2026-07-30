'use client';

import type {
  IAnalyticsProvider,
  IGameHistoryProvider,
  ILeaderboardProvider,
  INotificationProvider,
  IProvablyFairProvider,
  ISettlementProvider,
  IWalletProvider,
} from '@gaming-platform/types';

import { getFeatureFlags, type RuntimeFeatureFlags } from '../feature-flags';
import { DemoAnalyticsProvider, DemoLeaderboardProvider, DemoNotificationProvider } from './observability';
import { DemoHistoryProvider } from './history';
import { DemoProvablyFairProvider } from './provably-fair';
import { DemoSettlementProvider } from './settlement';
import { DemoWalletProvider } from './wallet';

/**
 * The full provider set the Runtime depends on. The Runtime is provider-agnostic:
 * it only sees these interfaces, so swapping demo → real is a flag change, not a
 * code change. Phase 2.2 wires the DEMO set (real wallet off).
 */
export interface ProviderSet {
  wallet: IWalletProvider;
  settlement: ISettlementProvider;
  history: IGameHistoryProvider;
  provablyFair: IProvablyFairProvider;
  analytics: IAnalyticsProvider;
  notifications: INotificationProvider;
  leaderboard: ILeaderboardProvider;
}

/**
 * Build the active provider set from the feature flags. Only the demo
 * implementations are constructed in Phase 2.2 (`realWallet` is false); the real
 * providers exist as inactive stubs and are intentionally NOT imported here so
 * they tree-shake out of the demo bundle.
 */
export function createProviderSet(flags: RuntimeFeatureFlags = { ...getFeatureFlags() }): ProviderSet {
  // Phase 2.2: demo set. When `flags.realWallet` is enabled (Phase 2.3+), this is
  // where the real providers are swapped in behind the same interfaces.
  void flags;
  return {
    wallet: new DemoWalletProvider(),
    settlement: new DemoSettlementProvider(),
    history: new DemoHistoryProvider(),
    provablyFair: new DemoProvablyFairProvider(),
    analytics: new DemoAnalyticsProvider(),
    notifications: new DemoNotificationProvider(),
    leaderboard: new DemoLeaderboardProvider(),
  };
}

export * from './wallet';
export * from './settlement';
export * from './history';
export * from './provably-fair';
export * from './observability';
