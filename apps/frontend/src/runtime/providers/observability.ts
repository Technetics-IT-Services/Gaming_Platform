'use client';

import type {
  GameId,
  IAnalyticsProvider,
  ILeaderboardProvider,
  INotificationProvider,
  PlayerId,
} from '@gaming-platform/types';

import { RuntimeError, RuntimeErrorCode } from '../errors';

/**
 * Observability providers (Phase 2.2): analytics, notifications, leaderboard.
 *
 * Demo implementations are best-effort no-ops (they never fail a settled bet).
 * Real implementations are inactive stubs. Phase 2.2 does NOT build analytics or
 * notifications — these exist only so the runtime pipeline has something to call.
 */

export class DemoAnalyticsProvider implements IAnalyticsProvider {
  track(): void {
    /* no-op in demo; real impl forwards to modules/analytics */
  }
}

export class DemoNotificationProvider implements INotificationProvider {
  async notify(): Promise<void> {
    /* no-op in demo; real impl forwards to modules/notifications */
  }
}

export class DemoLeaderboardProvider implements ILeaderboardProvider {
  async submit(): Promise<void> {
    /* no-op in demo */
  }
  async top(): Promise<Array<{ playerId: PlayerId; value: number; rank: number }>> {
    return [];
  }
}

/* ------------------------------- real stubs ------------------------------- */

export class RealAnalyticsProvider implements IAnalyticsProvider {
  track(): void {
    throw new RuntimeError(RuntimeErrorCode.FEATURE_DISABLED, 'Real analytics provider inactive in Phase 2.2.');
  }
}
export class RealNotificationProvider implements INotificationProvider {
  async notify(): Promise<void> {
    throw new RuntimeError(RuntimeErrorCode.FEATURE_DISABLED, 'Real notification provider inactive in Phase 2.2.');
  }
}
export class RealLeaderboardProvider implements ILeaderboardProvider {
  async submit(): Promise<void> {
    throw new RuntimeError(RuntimeErrorCode.FEATURE_DISABLED, 'Real leaderboard provider inactive in Phase 2.2.');
  }
  async top(): Promise<Array<{ playerId: PlayerId; value: number; rank: number; gameId?: GameId }>> {
    throw new RuntimeError(RuntimeErrorCode.FEATURE_DISABLED, 'Real leaderboard provider inactive in Phase 2.2.');
  }
}
