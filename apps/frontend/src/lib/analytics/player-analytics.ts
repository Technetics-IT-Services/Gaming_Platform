/**
 * Player analytics (Phase 6D, STEP 4).
 *
 * Session analytics, game popularity, player behaviour, retention cohorts, funnels,
 * VIP and responsible-gaming metrics — all derived from the read-only event stream.
 * No money movement, no PII beyond ids the caller already holds.
 */
import { type AnalyticsService } from './analytics-service';
import { type CohortRetention, type FunnelResult, type GamePopularity, type SessionAnalytics, EventType } from './types';

const DAY_MS = 24 * 3_600_000;

export class PlayerAnalytics {
  constructor(private readonly analytics: AnalyticsService) {}

  /** Session counts + average duration (from session_start/end pairs by sessionId). */
  sessions(tenantId?: string): SessionAnalytics {
    const starts = new Map<string, number>();
    const durations: number[] = [];
    const players = new Set<string>();
    for (const e of this.analytics.query({ tenantId })) {
      if (e.type === EventType.SessionStart && e.sessionId) {
        starts.set(e.sessionId, e.at);
        if (e.playerId) players.add(e.playerId);
      } else if (e.type === EventType.SessionEnd && e.sessionId) {
        const s = starts.get(e.sessionId);
        if (s !== undefined) durations.push(e.at - s);
      }
    }
    const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    return { sessions: starts.size, uniquePlayers: players.size, avgSessionMs: avg };
  }

  /** Most-played games by rounds, ranked. */
  gamePopularity(tenantId?: string): GamePopularity[] {
    const byGame = new Map<string, { rounds: number; players: Set<string>; wagered: number }>();
    for (const e of this.analytics.query({ tenantId })) {
      if ((e.type === EventType.Bet || e.type === EventType.GameRound) && e.gameId) {
        const g = byGame.get(e.gameId) ?? { rounds: 0, players: new Set<string>(), wagered: 0 };
        g.rounds += 1;
        if (e.playerId) g.players.add(e.playerId);
        g.wagered += e.amount ?? 0;
        byGame.set(e.gameId, g);
      }
    }
    return [...byGame.entries()]
      .map(([gameId, g]) => ({ gameId, rounds: g.rounds, players: g.players.size, wagered: g.wagered }))
      .sort((a, b) => b.rounds - a.rounds);
  }

  /**
   * Day-N retention cohort for players registered in a given day. `retainedByDay[n]`
   * = how many of the cohort were active n days after registration.
   */
  retentionCohort(cohortDayStart: number, days = 7, tenantId?: string): CohortRetention {
    const cohort = new Set<string>();
    for (const e of this.analytics.query({ type: EventType.Registration, tenantId, from: cohortDayStart, to: cohortDayStart + DAY_MS })) {
      if (e.playerId) cohort.add(e.playerId);
    }
    const retainedByDay: number[] = [];
    for (let n = 0; n < days; n += 1) {
      const from = cohortDayStart + n * DAY_MS;
      const active = new Set<string>();
      for (const e of this.analytics.query({ tenantId, from, to: from + DAY_MS })) {
        if (e.playerId && cohort.has(e.playerId) && (e.type === EventType.Login || e.type === EventType.Bet || e.type === EventType.SessionStart)) active.add(e.playerId);
      }
      retainedByDay.push(active.size);
    }
    return { cohort: new Date(cohortDayStart).toISOString().slice(0, 10), size: cohort.size, retainedByDay };
  }

  /** Ordered event-type funnel with distinct-player conversion. */
  funnel(steps: { name: string; type: EventType }[], tenantId?: string): FunnelResult {
    const counts = steps.map((step) => {
      const players = new Set<string>();
      for (const e of this.analytics.query({ type: step.type, tenantId })) if (e.playerId) players.add(e.playerId);
      return { name: step.name, count: players.size };
    });
    const first = counts[0]?.count ?? 0;
    const last = counts[counts.length - 1]?.count ?? 0;
    return { steps: counts, overallConversion: first ? last / first : 0 };
  }

  /** Behaviour summary: bets/wins/deposits per active player. */
  behaviour(tenantId?: string): { activePlayers: number; betsPerPlayer: number; depositsPerPlayer: number } {
    const active = new Set<string>();
    let bets = 0;
    let deposits = 0;
    for (const e of this.analytics.query({ tenantId })) {
      if (e.playerId && (e.type === EventType.Bet || e.type === EventType.Login || e.type === EventType.SessionStart)) active.add(e.playerId);
      if (e.type === EventType.Bet) bets += 1;
      if (e.type === EventType.Deposit) deposits += 1;
    }
    const n = active.size || 1;
    return { activePlayers: active.size, betsPerPlayer: Math.round((bets / n) * 100) / 100, depositsPerPlayer: Math.round((deposits / n) * 100) / 100 };
  }
}
