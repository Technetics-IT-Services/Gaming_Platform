import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { GameMoneyRecoveryService } from './game-money-recovery.service';

/**
 * Durable, restart-safe recovery poller (Phase 2C.1).
 *
 * Mirrors the repository's existing lightweight `setInterval` worker pattern (see
 * operations `QueueService`) rather than adding a new dependency. The DURABLE state is the
 * `game_rounds` table — this only polls it, so a restarted process re-discovers due rounds
 * automatically. Disabled under `NODE_ENV=test` (tests call `sweep()` directly) and via
 * `RECOVERY_SWEEP_DISABLED=true`. Non-overlapping ticks; the timer is `unref`-ed so it never
 * blocks shutdown.
 */
@Injectable()
export class GameMoneyRecoveryScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GameMoneyRecoveryScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly intervalMs = Number(process.env.RECOVERY_SWEEP_INTERVAL_MS ?? 15_000);

  constructor(private readonly recovery: GameMoneyRecoveryService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.RECOVERY_SWEEP_DISABLED === 'true') return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.logger.log(`Settlement-recovery sweep scheduled every ${this.intervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return; // never overlap sweeps
    this.running = true;
    try {
      const summary = await this.recovery.sweep();
      if (summary.claimed > 0) this.logger.log(`Recovery sweep: ${JSON.stringify(summary)}`);
      // Finalize abandoned (busted) crash rounds — settle-as-loss through the bridge.
      const crash = await this.recovery.finalizeExpiredCrash();
      if (crash.finalized > 0) this.logger.log(`Crash finalize sweep: ${JSON.stringify(crash)}`);
    } catch (err) {
      this.logger.error(`Recovery sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
