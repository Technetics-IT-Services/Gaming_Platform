import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { LotteryDrawService } from './lottery-draw.service';

/**
 * Durable, restart-safe Number-Lottery draw poller (Phase 2C.3).
 *
 * Mirrors the repository's lightweight `setInterval` worker pattern (recovery scheduler /
 * operations QueueService) — no new dependency. The DURABLE state is `lottery_draws` +
 * `game_rounds`; this only polls, so a restarted process re-discovers due draws and pending
 * tickets automatically. Draw execution is execute-once (guarded status transition in the
 * service). Disabled under `NODE_ENV=test` (tests drive the service directly) and via
 * `LOTTERY_SWEEP_DISABLED=true`. Non-overlapping ticks; the timer is `unref`-ed.
 */
@Injectable()
export class LotteryDrawScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LotteryDrawScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly intervalMs = Number(process.env.LOTTERY_SWEEP_INTERVAL_MS ?? 10_000);

  constructor(private readonly draws: LotteryDrawService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test' || process.env.LOTTERY_SWEEP_DISABLED === 'true') return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.logger.log(`Lottery draw sweep scheduled every ${this.intervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return; // never overlap sweeps
    this.running = true;
    try {
      const summary = await this.draws.sweep();
      if (summary.executed > 0 || summary.settledTickets > 0 || summary.pendingTickets > 0) {
        this.logger.log(`Lottery draw sweep: ${JSON.stringify(summary)}`);
      }
    } catch (err) {
      this.logger.error(`Lottery draw sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
