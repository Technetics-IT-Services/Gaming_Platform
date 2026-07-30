'use client';

import type { GameId, IBetResult, IGameHistoryProvider, PlayerId } from '@gaming-platform/types';

import { useDemoWallet } from '@/stores/demo-wallet';
import { useGameStats } from '@/stores/game-stats';
import { usePlayerProfile } from '@/stores/player-profile';
import { RuntimeError, RuntimeErrorCode } from '../errors';

/**
 * History providers (Phase 2.2).
 *
 * `DemoHistoryProvider` writes to the EXISTING stores — `useDemoWallet.recordBet`
 * (bet ledger → Bet History page) and `useGameStats.record` (per-game stats →
 * the in-game history strip). So a migrated game's history/stats surfaces stay
 * byte-for-byte the same. Presentation fields (`gameName`, `displayLabel`,
 * `displayValue`) are optional extras the runtime supplies; they extend — never
 * break — the `IGameHistoryProvider` contract.
 */
export type DemoHistoryRecord = IBetResult & {
  playerId: PlayerId;
  gameId: GameId;
  /** Human game name for the bet ledger, e.g. `'Crash'`. */
  gameName?: string;
  /** Label shown in the game's history strip, e.g. `'2.45×'`. */
  displayLabel?: string;
  /** Numeric value used for highest/streak stats (final multiplier). */
  displayValue?: number;
  /** XP to award for this round (game-supplied via the descriptor's rewards). */
  xp?: number;
  /** Generic settlement metadata (Phase 2.3C) — carried for display/audit; the
   * demo store only surfaces label/value, a real backend persists these. */
  settlementType?: string;
  reason?: string;
  /** Per-round stats key override (Phase 3) — the generic slot renderer keys stats
   * by title; absent → the gameId (existing games unchanged). */
  statsKey?: string;
};

export class DemoHistoryProvider implements IGameHistoryProvider {
  async record(entry: DemoHistoryRecord): Promise<void> {
    const stake = Number(entry.stake);
    const net = Number(entry.netProfit);
    const win = entry.outcome === 'win';

    useDemoWallet.getState().recordBet({
      game: entry.gameName ?? entry.gameId,
      stake,
      win,
      net,
      multiplier: win ? entry.multiplier : 0,
    });

    useGameStats.getState().record(entry.statsKey ?? entry.gameId, {
      label: entry.displayLabel ?? `${entry.multiplier.toFixed(2)}×`,
      win,
      payout: net,
      value: entry.displayValue ?? entry.multiplier,
    });

    // XP / progression (game-supplied) — mirrors the legacy `settleRound` award so
    // migrated games keep leveling. Absent (e.g. crash), no XP is granted.
    if (entry.xp && entry.xp > 0) {
      usePlayerProfile.getState().addXp(entry.xp);
    }
  }

  async list(input: { playerId: PlayerId; gameId?: GameId; limit?: number }): Promise<{
    items: IBetResult[];
    nextCursor?: string;
  }> {
    const bets = useDemoWallet.getState().bets;
    const items: IBetResult[] = bets.slice(0, input.limit ?? 20).map((b) => ({
      betId: b.id,
      roundId: b.roundId,
      outcome: b.win ? ('win' as IBetResult['outcome']) : ('loss' as IBetResult['outcome']),
      stake: String(b.stake),
      payout: String(b.win ? b.stake + b.net : 0),
      netProfit: String(b.net),
      multiplier: b.multiplier,
      settledAt: new Date(b.ts).toISOString(),
    }));
    return { items };
  }
}

/** Real history provider — backend transactions/bet history. Inactive in 2.2. */
export class RealHistoryProvider implements IGameHistoryProvider {
  async record(): Promise<void> {
    throw new RuntimeError(
      RuntimeErrorCode.FEATURE_DISABLED,
      'Real history provider is not active in Phase 2.2 (demo mode).',
    );
  }
  async list(): Promise<{ items: IBetResult[]; nextCursor?: string }> {
    throw new RuntimeError(
      RuntimeErrorCode.FEATURE_DISABLED,
      'Real history provider is not active in Phase 2.2 (demo mode).',
    );
  }
}
