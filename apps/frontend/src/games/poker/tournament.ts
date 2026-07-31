/**
 * Texas Hold'em — reusable tournament extension points (Sprint 5, STEP 7).
 *
 * HOOKS ONLY. Tournaments are intentionally NOT implemented; the table engine simply
 * carries `TournamentHooks` so a future tournament layer can drive blind escalation,
 * table balancing, player elimination and leaderboard integration without any change to
 * the table engine or the frozen platform. These helpers are pure, side-effect-free
 * readers/builders of that hook surface.
 */
import type { BlindLevel, TournamentHooks } from './types';

/** No-op hooks — the default for a cash-game table (no tournament attached). */
export const NOOP_TOURNAMENT_HOOKS: TournamentHooks = {};

/** Build a standard escalating blind schedule (extension point for a future MTT/SNG). */
export function createBlindSchedule(input: {
  startSmallBlind: number;
  levels: number;
  /** Multiplier applied each level (e.g. 1.5). */
  growth?: number;
  levelDurationMs?: number;
  ante?: boolean;
}): BlindLevel[] {
  const growth = input.growth ?? 1.5;
  const out: BlindLevel[] = [];
  let sb = input.startSmallBlind;
  for (let level = 1; level <= input.levels; level += 1) {
    const smallBlind = Math.round(sb);
    const bigBlind = smallBlind * 2;
    out.push({ level, smallBlind, bigBlind, ante: input.ante ? Math.round(smallBlind / 2) : undefined, durationMs: input.levelDurationMs });
    sb *= growth;
  }
  return out;
}

/** The blind level active after `elapsedMs`, given each level's duration. */
export function currentBlindLevel(schedule: BlindLevel[], elapsedMs: number): BlindLevel | null {
  if (schedule.length === 0) return null;
  let acc = 0;
  for (const level of schedule) {
    acc += level.durationMs ?? Infinity;
    if (elapsedMs < acc) return level;
  }
  return schedule[schedule.length - 1] ?? null;
}

/**
 * Table-balancing extension point: given seat counts per table, suggest how many
 * players to move off the most-populated table toward the least. A real tournament
 * layer implements the actual moves; this only computes the imbalance.
 */
export function suggestRebalance(seatCounts: number[]): { from: number; to: number; count: number } | null {
  if (seatCounts.length < 2) return null;
  let max = 0;
  let min = 0;
  for (let i = 1; i < seatCounts.length; i += 1) {
    if (seatCounts[i]! > seatCounts[max]!) max = i;
    if (seatCounts[i]! < seatCounts[min]!) min = i;
  }
  const count = Math.floor((seatCounts[max]! - seatCounts[min]!) / 2);
  return count > 0 ? { from: max, to: min, count } : null;
}
