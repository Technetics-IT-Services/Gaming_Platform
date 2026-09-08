import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LotteryDrawStatus, Prisma } from '@prisma/client';
import { LOTTERY_DEFAULT_CONFIG, drawNumbers } from '@gaming-platform/lottery-engine';
import { SeededRng } from '@gaming-platform/game-sdk';

import { PrismaService } from '../database/prisma.service';
import { ProvablyFairService } from '../runtime/services/provably-fair.service';
import { GameMoneyBridgeService, type LotteryDrawRow } from './game-money-bridge.service';

const POOL = LOTTERY_DEFAULT_CONFIG.pool; // 49
const PICK = LOTTERY_DEFAULT_CONFIG.pick; // 6
const PRIZE_TIERS = LOTTERY_DEFAULT_CONFIG.prizeTiers; // { '3':5, '4':50, '5':500, '6':50000 }
const TICKET_PRICE = process.env.LOTTERY_TICKET_PRICE ?? '10';
const DRAW_INTERVAL_MS = Number(process.env.LOTTERY_DRAW_INTERVAL_MS ?? 300_000); // 5 min default
const CURRENCY = process.env.LOTTERY_CURRENCY ?? 'INR';

export interface DrawExecutionSummary {
  scanned: number;
  executed: number;
  settledTickets: number;
  pendingTickets: number;
}

export interface LotteryHealth {
  openDraws: number;
  drawnUnsettled: number;
  pendingTickets: number;
  nextDrawAt: string | null;
}

/**
 * Number-Lottery scheduled-draw lifecycle (Phase 2C.3). Owns the SHARED authoritative draw:
 * every ticket for a draw is evaluated against the SAME winning numbers. The draw is
 * provably-fair (seed committed at creation) and **execute-once** via a guarded status
 * transition — two workers can never publish two different draws. Durable + restart-safe:
 * all state lives in `lottery_draws` + `game_rounds`. Ticket money always settles through the
 * shared {@link GameMoneyBridgeService} (`settleLotteryTicket`); this service never touches the
 * wallet or ledger directly.
 */
@Injectable()
export class LotteryDrawService {
  private readonly logger = new Logger(LotteryDrawService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fair: ProvablyFairService,
    private readonly bridge: GameMoneyBridgeService,
  ) {}

  get config() {
    return { pool: POOL, pick: PICK, ticketPrice: TICKET_PRICE, prizeTiers: PRIZE_TIERS, currency: CURRENCY, drawIntervalMs: DRAW_INTERVAL_MS };
  }

  private async currencyId(): Promise<string> {
    const c = await this.prisma.currency.findUnique({ where: { code: CURRENCY.toUpperCase() } });
    if (!c) throw new NotFoundException(`Currency ${CURRENCY} not configured`);
    return c.id;
  }

  /** The current OPEN draw accepting sales, creating one if none exists / the last has closed. */
  async currentOpenDraw(): Promise<LotteryDrawRow> {
    const existing = await this.prisma.lotteryDraw.findFirst({
      where: { status: LotteryDrawStatus.OPEN, drawAt: { gt: new Date() } },
      orderBy: { drawAt: 'asc' },
    });
    if (existing) return existing as LotteryDrawRow;
    return this.openDraw();
  }

  /** Create a new OPEN draw with a committed provably-fair seed. */
  async openDraw(drawAtMs?: number): Promise<LotteryDrawRow> {
    const commit = this.fair.createCommit();
    const draw = await this.prisma.lotteryDraw.create({
      data: {
        status: LotteryDrawStatus.OPEN,
        poolSize: POOL,
        pick: PICK,
        ticketPrice: TICKET_PRICE,
        currencyId: await this.currencyId(),
        serverSeed: commit.serverSeed,
        serverSeedHash: commit.serverSeedHash,
        clientSeed: commit.serverSeedHash,
        nonce: commit.nonce,
        winningNumbers: [],
        drawAt: new Date(drawAtMs ?? Date.now() + DRAW_INTERVAL_MS),
      },
    });
    return draw as LotteryDrawRow;
  }

  /** Ensure at least one future OPEN draw exists (called by the poller). */
  async ensureOpenDraw(): Promise<void> {
    const open = await this.prisma.lotteryDraw.count({ where: { status: LotteryDrawStatus.OPEN, drawAt: { gt: new Date() } } });
    if (open === 0) await this.openDraw();
  }

  /** One sweep: execute due draws + settle any DRAWN draws with pending tickets. */
  async sweep(): Promise<DrawExecutionSummary> {
    await this.ensureOpenDraw();
    const summary: DrawExecutionSummary = { scanned: 0, executed: 0, settledTickets: 0, pendingTickets: 0 };

    // 1) Execute draws whose time has come.
    const due = await this.prisma.lotteryDraw.findMany({
      where: { status: { in: [LotteryDrawStatus.OPEN, LotteryDrawStatus.CLOSED] }, drawAt: { lte: new Date() } },
      orderBy: { drawAt: 'asc' },
      take: 25,
      select: { id: true },
    });
    summary.scanned = due.length;
    for (const d of due) {
      const res = await this.executeDraw(d.id);
      if (res.executed) summary.executed += 1;
      summary.settledTickets += res.settledTickets;
      summary.pendingTickets += res.pendingTickets;
    }

    // 2) Re-settle any DRAWN draws that still have pending tickets (e.g. after a restart).
    const drawn = await this.prisma.lotteryDraw.findMany({ where: { status: LotteryDrawStatus.DRAWN }, take: 25, select: { id: true } });
    for (const d of drawn) {
      const res = await this.settleDrawTickets(d.id);
      summary.settledTickets += res.settled;
      summary.pendingTickets += res.pending;
    }
    return summary;
  }

  /**
   * Execute a single draw exactly once: derive the authoritative winning numbers from the
   * committed seed (deterministic — any worker computes the same), claim the draw via a guarded
   * transition, then settle its tickets. Safe to call concurrently.
   */
  async executeDraw(drawId: string): Promise<{ executed: boolean; settledTickets: number; pendingTickets: number }> {
    const draw = await this.prisma.lotteryDraw.findUnique({ where: { id: drawId } });
    if (!draw) throw new NotFoundException('Draw not found');
    if (draw.status === LotteryDrawStatus.DRAWN || draw.status === LotteryDrawStatus.SETTLED) {
      const s = await this.settleDrawTickets(drawId);
      return { executed: false, settledTickets: s.settled, pendingTickets: s.pending };
    }

    // Deterministic winning numbers from the committed seed (provably fair, replayable).
    const seed = this.fair.deriveSeed(draw.serverSeed, draw.clientSeed, draw.nonce);
    const winning = drawNumbers(new SeededRng(seed), draw.poolSize, draw.pick);

    // Execute-once: only one worker transitions OPEN/CLOSED → DRAWN.
    const claim = await this.prisma.lotteryDraw.updateMany({
      where: { id: drawId, status: { in: [LotteryDrawStatus.OPEN, LotteryDrawStatus.CLOSED] } },
      data: { status: LotteryDrawStatus.DRAWN, winningNumbers: winning, executedAt: new Date() },
    });
    if (claim.count === 0) {
      // Another worker executed it — settle whatever is pending.
      const s = await this.settleDrawTickets(drawId);
      return { executed: false, settledTickets: s.settled, pendingTickets: s.pending };
    }
    this.logger.log(`Lottery draw ${draw.drawNumber} executed → winning [${winning.join(',')}]`);
    const s = await this.settleDrawTickets(drawId);
    return { executed: true, settledTickets: s.settled, pendingTickets: s.pending };
  }

  /** Settle every RESERVED ticket of a DRAWN draw against its winning numbers (idempotent). */
  async settleDrawTickets(drawId: string): Promise<{ settled: number; pending: number }> {
    const draw = await this.prisma.lotteryDraw.findUnique({ where: { id: drawId } });
    if (!draw || draw.status === LotteryDrawStatus.OPEN || draw.status === LotteryDrawStatus.CLOSED) return { settled: 0, pending: 0 };

    const tickets = await this.prisma.gameRound.findMany({ where: { drawId, status: 'RESERVED' }, select: { id: true } });
    let settled = 0;
    let pending = 0;
    for (const t of tickets) {
      const out = await this.bridge.settleLotteryTicket(t.id, draw.winningNumbers, PRIZE_TIERS);
      if (out === 'settled') settled += 1;
      else if (out === 'pending') pending += 1;
    }

    // Mark the draw SETTLED once no tickets remain unresolved (RESERVED or PENDING).
    const unresolved = await this.prisma.gameRound.count({ where: { drawId, status: { in: ['RESERVED', 'PENDING_SETTLEMENT', 'RECOVERING'] } } });
    if (unresolved === 0 && draw.status === LotteryDrawStatus.DRAWN) {
      await this.prisma.lotteryDraw.update({ where: { id: drawId }, data: { status: LotteryDrawStatus.SETTLED, settledAt: new Date() } });
    }
    return { settled, pending };
  }

  /** Resolve the draw a purchase targets — an explicit OPEN draw id, else the current open draw. */
  async getDrawForPurchase(drawId?: string): Promise<LotteryDrawRow> {
    if (!drawId) return this.currentOpenDraw();
    const draw = await this.prisma.lotteryDraw.findUnique({ where: { id: drawId } });
    if (!draw) throw new NotFoundException('Draw not found');
    if (draw.status !== LotteryDrawStatus.OPEN || draw.drawAt <= new Date()) {
      throw new NotFoundException('Draw is not open for sales');
    }
    return draw as LotteryDrawRow;
  }

  /** The caller's recent lottery tickets, each with its draw context (server-authoritative). */
  async myTickets(userId: string, limit = 20) {
    const tickets = await this.prisma.gameRound.findMany({
      where: { userId, gameKey: 'number-lottery' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const drawIds = [...new Set(tickets.map((t) => t.drawId).filter((x): x is string => !!x))];
    const draws = await this.prisma.lotteryDraw.findMany({ where: { id: { in: drawIds } } });
    const byId = new Map(draws.map((d) => [d.id, d]));
    return tickets.map((t) => {
      const meta = (t.result ?? {}) as { picks?: number[]; matches?: number; tier?: string | null; winningNumbers?: number[]; won?: boolean };
      const draw = t.drawId ? byId.get(t.drawId) : undefined;
      const settled = t.status === 'SETTLED' || t.status === 'RECOVERED';
      return {
        ticketId: t.id,
        drawNumber: draw?.drawNumber ?? null,
        drawStatus: draw?.status ?? null,
        drawAt: draw?.drawAt.toISOString() ?? null,
        picks: meta.picks ?? [],
        ticketPrice: t.stake.toString(),
        status: t.status,
        settled,
        matches: meta.matches ?? null,
        tier: meta.tier ?? null,
        winningNumbers: settled ? meta.winningNumbers ?? draw?.winningNumbers ?? [] : [],
        payout: t.payout.toString(),
        won: settled ? !!meta.won : null,
      };
    });
  }

  /** Operational health (durable — from the DB). */
  async health(): Promise<LotteryHealth> {
    const [openDraws, drawnUnsettled, pendingTickets, next] = await Promise.all([
      this.prisma.lotteryDraw.count({ where: { status: LotteryDrawStatus.OPEN } }),
      this.prisma.lotteryDraw.count({ where: { status: LotteryDrawStatus.DRAWN } }),
      this.prisma.gameRound.count({ where: { gameKey: 'number-lottery', status: 'PENDING_SETTLEMENT' } }),
      this.prisma.lotteryDraw.findFirst({ where: { status: LotteryDrawStatus.OPEN }, orderBy: { drawAt: 'asc' }, select: { drawAt: true } }),
    ]);
    return { openDraws, drawnUnsettled, pendingTickets, nextDrawAt: next ? next.drawAt.toISOString() : null };
  }

  toJsonDraw(draw: LotteryDrawRow) {
    return {
      drawId: draw.id,
      drawNumber: draw.drawNumber,
      status: draw.status,
      poolSize: draw.poolSize,
      pick: draw.pick,
      ticketPrice: draw.ticketPrice.toString(),
      drawAt: draw.drawAt.toISOString(),
      serverSeedHash: draw.serverSeedHash,
      prizeTiers: PRIZE_TIERS as unknown as Prisma.JsonValue,
    };
  }
}
