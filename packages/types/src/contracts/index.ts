/**
 * Platform Contracts (Phase 2.1) — the single architectural direction.
 *
 * These interfaces are the canonical foundation every future module (25+ games,
 * sportsbook, portals, referral, VIP, analytics) is written against. They are
 * type-only: no business logic, no IO, no gameplay behavior. See
 * `docs/PLATFORM_ARCHITECTURE.md` for the runtime/wallet/bet/settlement flows and
 * extension guidelines.
 *
 * Import as: `import type { IGameRuntime, IWalletProvider } from '@gaming-platform/types';`
 */
export * from './common';
export * from './betting';
export * from './game';
export * from './runtime';
export * from './providers';
