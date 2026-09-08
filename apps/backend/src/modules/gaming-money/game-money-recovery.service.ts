import { Injectable, Logger } from '@nestjs/common';
import { GameRoundStatus } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { GameMoneyBridgeService } from './game-money-bridge.service';

export type RecoveryOutcome = 'recovered' | 'retry' | 'failed' | 'skipped';

export interface SweepSummary {
  scanned: number;
  claimed: number;
  recovered: number;
  retried: number;
  failed: number;
}

export interface RecoveryHealth {
  pending: number;
  recovering: number;
  recoveryFailed: number;
  oldestPendingAgeMs: number | null;
  lastRecoveryAt: string | null;
}

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 5_000;
const LOCK_TTL_MS = 30_000;
const BATCH = 25;
/** Grace after a crash round's curve busts before a sweep finalizes it as a loss. */
const CRASH_EXPIRY_GRACE_MS = 3_000;

/**
 * Automatic recovery for PENDING_SETTLEMENT rounds (Phase 2C.1).
 *
 * Discovers recoverable rounds and drives the EXISTING idempotent
 * `GameMoneyBridgeService.recover()` — it NEVER touches wallet balances or the ledger and
 * never bypasses the bridge. Double-settlement is prevented AUTHORITATIVELY by a
 * database state transition (`PENDING_SETTLEMENT → RECOVERING` via a guarded `updateMany`,
 * so only one worker/process claims a round) plus a best-effort Redis lock and the bridge's
 * own idempotent `commitReservation`. Durable + restart-safe: state lives in `game_rounds`,
 * so a restarted process simply re-discovers due rounds. Bounded retries with exponential
 * backoff; a permanently failed round becomes `RECOVERY_FAILED` (never silently dropped).
 */
@Injectable()
export class GameMoneyRecoveryService {
  private readonly logger = new Logger(GameMoneyRecoveryService.name);
  private lastRecoveryAt: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bridge: GameMoneyBridgeService,
    private readonly redis: RedisService,
  ) {}

  /** Rounds eligible for a recovery attempt right now. */
  async findDue(limit = BATCH): Promise<Array<{ id: string; recoveryAttempts: number }>> {
    return this.prisma.gameRound.findMany({
      where: {
        status: GameRoundStatus.PENDING_SETTLEMENT,
        recoveryAttempts: { lt: MAX_ATTEMPTS },
        OR: [{ nextRecoveryAt: null }, { nextRecoveryAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true, recoveryAttempts: true },
    });
  }

  /** One recovery pass over all due rounds. */
  async sweep(): Promise<SweepSummary> {
    const due = await this.findDue();
    const summary: SweepSummary = { scanned: due.length, claimed: 0, recovered: 0, retried: 0, failed: 0 };
    for (const r of due) {
      const outcome = await this.recoverOne(r.id);
      if (outcome === 'skipped') continue;
      summary.claimed += 1;
      if (outcome === 'recovered') summary.recovered += 1;
      else if (outcome === 'retry') summary.retried += 1;
      else if (outcome === 'failed') summary.failed += 1;
    }
    return summary;
  }

  /** Recover a single round. Safe to call concurrently — the DB claim serializes it. */
  async recoverOne(roundId: string): Promise<RecoveryOutcome> {
    const lockKey = `gamemoney:recover:${roundId}`;
    const token = `${process.pid}-${Date.now()}`;
    const gotLock = await this.acquireLock(lockKey, token);
    try {
      // Authoritative claim: only the transition from PENDING_SETTLEMENT succeeds (count === 1).
      const claim = await this.prisma.gameRound.updateMany({
        where: { id: roundId, status: GameRoundStatus.PENDING_SETTLEMENT },
        data: { status: GameRoundStatus.RECOVERING, lastRecoveryAt: new Date(), recoveryAttempts: { increment: 1 } },
      });
      if (claim.count === 0) return 'skipped'; // another worker claimed it, or it is no longer pending

      const round = await this.prisma.gameRound.findUnique({ where: { id: roundId }, select: { id: true, userId: true, recoveryAttempts: true } });
      const attempt = round?.recoveryAttempts ?? 1;
      const started = Date.now();
      try {
        await this.bridge.recover(roundId); // idempotent settlement via the existing bridge
        this.lastRecoveryAt = new Date();
        this.observe({ roundId, userId: round?.userId, attempt, from: 'RECOVERING', to: 'RECOVERED', durationMs: Date.now() - started });
        return 'recovered';
      } catch (err) {
        const category = this.classify(err);
        if (attempt >= MAX_ATTEMPTS) {
          await this.prisma.gameRound.update({ where: { id: roundId }, data: { status: GameRoundStatus.RECOVERY_FAILED, error: this.msg(err), nextRecoveryAt: null } });
          this.observe({ roundId, userId: round?.userId, attempt, from: 'RECOVERING', to: 'RECOVERY_FAILED', errorCategory: category, durationMs: Date.now() - started });
          this.logger.error(`ALERT: game round ${roundId} RECOVERY_FAILED after ${attempt} attempts (${category}) — MANUAL settlement recovery required`);
          return 'failed';
        }
        const backoffMs = BASE_BACKOFF_MS * 2 ** (attempt - 1);
        await this.prisma.gameRound.update({ where: { id: roundId }, data: { status: GameRoundStatus.PENDING_SETTLEMENT, nextRecoveryAt: new Date(Date.now() + backoffMs), error: this.msg(err) } });
        this.observe({ roundId, userId: round?.userId, attempt, from: 'RECOVERING', to: 'PENDING_SETTLEMENT', errorCategory: category, durationMs: Date.now() - started });
        return 'retry';
      }
    } finally {
      if (gotLock) await this.releaseLock(lockKey, token);
    }
  }

  /**
   * Finalize abandoned crash rounds whose curve has already busted (player never cashed out).
   * Settlement is centralized in the bridge (`settleCrash(id, null)`) — the guarded
   * `RESERVED → RESOLVED` claim makes this safe against a concurrent live cash-out, and
   * `commitReservation` is idempotent. Returns the number of rounds finalized.
   */
  async finalizeExpiredCrash(): Promise<{ scanned: number; finalized: number }> {
    const ids = await this.bridge.findExpiredCrashRounds(CRASH_EXPIRY_GRACE_MS);
    let finalized = 0;
    for (const id of ids) {
      const lockKey = `gamemoney:crash-expire:${id}`;
      const token = `${process.pid}-${Date.now()}`;
      const gotLock = await this.acquireLock(lockKey, token);
      try {
        await this.bridge.settleCrash(id, null);
        finalized += 1;
        this.observe({ roundId: id, attempt: 0, from: 'RESERVED', to: 'SETTLED(expired-loss)', durationMs: 0 });
      } catch (err) {
        // A concurrent cash-out won the claim, or settlement is now PENDING_SETTLEMENT
        // (picked up by the normal recovery sweep). Non-fatal.
        this.logger.warn(`crash finalize round=${id} deferred: ${this.msg(err)}`);
      } finally {
        if (gotLock) await this.releaseLock(lockKey, token);
      }
    }
    return { scanned: ids.length, finalized };
  }

  /** Operational health for monitoring (durable — computed from the DB). */
  async health(): Promise<RecoveryHealth> {
    const [pending, recovering, recoveryFailed, oldest] = await Promise.all([
      this.prisma.gameRound.count({ where: { status: GameRoundStatus.PENDING_SETTLEMENT } }),
      this.prisma.gameRound.count({ where: { status: GameRoundStatus.RECOVERING } }),
      this.prisma.gameRound.count({ where: { status: GameRoundStatus.RECOVERY_FAILED } }),
      this.prisma.gameRound.findFirst({ where: { status: GameRoundStatus.PENDING_SETTLEMENT }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ]);
    return {
      pending,
      recovering,
      recoveryFailed,
      oldestPendingAgeMs: oldest ? Date.now() - oldest.createdAt.getTime() : null,
      lastRecoveryAt: this.lastRecoveryAt ? this.lastRecoveryAt.toISOString() : null,
    };
  }

  /* --------------------------------- helpers -------------------------------- */

  private observe(e: { roundId: string; userId?: string; attempt: number; from: string; to: string; errorCategory?: string; durationMs: number }): void {
    // Structured, secret-free operational log line (no PII beyond ids, no tokens/seeds).
    this.logger.log(`recovery round=${e.roundId} user=${e.userId ?? '-'} attempt=${e.attempt} ${e.from}->${e.to}${e.errorCategory ? ` category=${e.errorCategory}` : ''} durationMs=${e.durationMs}`);
  }

  private classify(err: unknown): string {
    const m = this.msg(err).toLowerCase();
    if (m.includes('not found')) return 'reservation-missing';
    if (m.includes('insufficient')) return 'insufficient';
    if (m.includes('conflict') || m.includes('version')) return 'contention';
    return 'unknown';
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private async acquireLock(key: string, token: string): Promise<boolean> {
    try {
      const ok = await this.redis.raw.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
      return ok === 'OK';
    } catch {
      return false; // Redis best-effort; the DB claim is authoritative
    }
  }

  private async releaseLock(key: string, token: string): Promise<void> {
    try {
      const current = await this.redis.get<string>(key);
      if (current === token) await this.redis.del(key);
    } catch {
      /* ignore */
    }
  }
}
