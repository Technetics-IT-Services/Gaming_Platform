import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';

export interface GameHistoryQuery {
  page?: number;
  limit?: number;
  gameKey?: string;
  status?: string;
  from?: string;
  to?: string;
}

/** Statuses at which a round is finished and its provably-fair secret is safe to reveal. */
const TERMINAL = new Set(['SETTLED', 'RECOVERED', 'FAILED', 'RECOVERY_FAILED']);
/** Keys stripped from `result`/`fairness` while a round is still in flight (never leak secrets). */
const SECRET_KEYS = ['serverSeed', 'seed', 'crashPoint'];

/**
 * Read-only player + operator traceability over the EXISTING financial records (Phase 2C.4).
 *
 * This service performs NO money movement and writes NO financial data — it only reads
 * `GameRound`, `WalletTransaction`, `Ledger`/`LedgerEntry` and `LockedFunds` and joins them via the
 * already-persisted links (`reservationId`, `betTransactionId`, and the `round:{id}` reference
 * convention). Balances and amounts are returned straight from the stored rows — never recomputed.
 */
@Injectable()
export class GameMoneyHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's game rounds (paginated, filterable). */
  async listRounds(userId: string, query: GameHistoryQuery = {}) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const createdAt = this.dateRange(query.from, query.to);
    const where: Prisma.GameRoundWhereInput = {
      userId,
      ...(query.gameKey ? { gameKey: query.gameKey } : {}),
      ...(query.status ? { status: query.status as Prisma.GameRoundWhereInput['status'] } : {}),
      ...(createdAt ? { createdAt } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.gameRound.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.gameRound.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toRoundSummary(r)),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 0,
    };
  }

  /** Full player-facing traceability bundle for one owned round. */
  async roundDetails(userId: string, roundId: string) {
    const round = await this.prisma.gameRound.findUnique({ where: { id: roundId } });
    if (!round) throw new NotFoundException('Round not found');
    if (round.userId !== userId) throw new ForbiddenException('Not your round');
    return this.assemble(round, false);
  }

  /** Operator-facing bundle (no ownership restriction) with the player + wallet + recovery state. */
  async adminRoundDetails(roundId: string) {
    const round = await this.prisma.gameRound.findUnique({ where: { id: roundId } });
    if (!round) throw new NotFoundException('Round not found');
    const bundle = await this.assemble(round, true);

    const [user, wallet] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: round.userId }, select: { id: true, email: true, username: true, status: true, createdAt: true } }),
      this.prisma.wallet.findFirst({ where: { userId: round.userId, currencyId: round.currencyId, type: 'MAIN' }, include: { balance: true } }),
    ]);

    return {
      ...bundle,
      player: user
        ? { id: user.id, email: user.email, username: user.username, status: user.status, createdAt: user.createdAt }
        : null,
      wallet: wallet
        ? { id: wallet.id, type: wallet.type, status: wallet.status, available: wallet.balance?.available.toString() ?? '0', locked: wallet.balance?.locked.toString() ?? '0', total: wallet.balance?.total.toString() ?? '0' }
        : null,
      recovery: {
        status: round.status,
        recoveryAttempts: round.recoveryAttempts,
        lastRecoveryAt: round.lastRecoveryAt,
        nextRecoveryAt: round.nextRecoveryAt,
        error: round.error,
      },
    };
  }

  /* --------------------------------- helpers -------------------------------- */

  /** Assemble round → reservation → transactions → ledger from the persisted links. */
  private async assemble(round: RoundRow, admin: boolean) {
    // All wallet transactions for this round (RESERVE + bet + win, incl. a doubled hand's `:2`).
    const txns = await this.prisma.walletTransaction.findMany({
      where: { userId: round.userId, reference: { startsWith: `round:${round.id}` } },
      include: { type: true, status: true, currency: true },
      orderBy: { createdAt: 'asc' },
    });
    const txnIds = txns.map((t) => t.id);

    const [reservation, ledgers] = await Promise.all([
      round.reservationId ? this.prisma.lockedFunds.findUnique({ where: { id: round.reservationId } }) : Promise.resolve(null),
      this.prisma.ledger.findMany({
        where: { OR: [{ walletTransactionId: { in: txnIds.length ? txnIds : ['00000000-0000-0000-0000-000000000000'] } }, { reference: { startsWith: `round:${round.id}` } }] },
        include: { entries: true },
        orderBy: { postedAt: 'asc' },
      }),
    ]);

    const settlement = txns.find((t) => t.id === round.betTransactionId) ?? null;
    const isTerminal = TERMINAL.has(round.status);

    return {
      round: {
        id: round.id,
        gameKey: round.gameKey,
        variant: round.variant,
        betType: round.betType,
        stake: round.stake.toString(),
        payout: round.payout.toString(),
        netResult: this.netResult(round.stake, round.payout),
        status: round.status,
        idempotencyKey: round.idempotencyKey,
        result: this.redact(round.result, isTerminal),
        fairness: this.redact(round.fairness, isTerminal),
        createdAt: round.createdAt,
        settledAt: round.settledAt,
        reference: round.betTransactionId ?? round.id,
      },
      reservation: reservation
        ? { id: reservation.id, amount: reservation.amount.toString(), status: reservation.status, reason: reservation.reason, createdAt: reservation.createdAt, releasedAt: reservation.releasedAt }
        : null,
      settlement: settlement ? this.txView(settlement) : null,
      walletTransactions: txns.map((t) => this.txView(t)),
      ledger: ledgers.map((l) => ({
        id: l.id,
        reference: l.reference,
        status: l.status,
        postedAt: l.postedAt,
        entries: l.entries.map((e) => ({ id: e.id, direction: e.direction, amount: e.amount.toString(), balanceAfter: e.balanceAfter?.toString() ?? null, walletId: admin ? e.walletId : undefined, status: e.status })),
      })),
    };
  }

  private toRoundSummary(r: RoundRow) {
    return {
      roundId: r.id,
      gameKey: r.gameKey,
      betType: r.betType,
      stake: r.stake.toString(),
      payout: r.payout.toString(),
      netResult: this.netResult(r.stake, r.payout),
      status: r.status,
      createdAt: r.createdAt,
      settledAt: r.settledAt,
      reference: r.betTransactionId ?? r.id,
    };
  }

  private txView(t: { id: string; reference: string; amount: Prisma.Decimal; fee: Prisma.Decimal; balanceBefore: Prisma.Decimal; balanceAfter: Prisma.Decimal; description: string | null; createdAt: Date; type: { code: string }; status: { code: string }; currency: { code: string } }) {
    return {
      id: t.id,
      type: t.type.code,
      status: t.status.code,
      amount: t.amount.toString(),
      fee: t.fee.toString(),
      balanceBefore: t.balanceBefore.toString(),
      balanceAfter: t.balanceAfter.toString(),
      currency: t.currency.code,
      reference: t.reference,
      description: t.description,
      createdAt: t.createdAt,
    };
  }

  /** Decimal net = payout − stake (string; no floating-point money math). */
  private netResult(stake: Prisma.Decimal, payout: Prisma.Decimal): string {
    return new Prisma.Decimal(payout).minus(stake).toString();
  }

  /** Strip provably-fair secrets from a JSON blob unless the round is finished. */
  private redact(value: Prisma.JsonValue | null, terminal: boolean): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    if (terminal) return value;
    const clone: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const k of SECRET_KEYS) if (k in clone) delete clone[k];
    if ('settled' in clone) delete clone.settled; // may embed the crash point
    return clone;
  }

  private dateRange(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
    if (!from && !to) return undefined;
    return { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };
  }
}

type RoundRow = {
  id: string;
  userId: string;
  gameKey: string;
  variant: string;
  betType: string;
  currencyId: string;
  stake: Prisma.Decimal;
  payout: Prisma.Decimal;
  status: string;
  idempotencyKey: string;
  reservationId: string | null;
  betTransactionId: string | null;
  result: Prisma.JsonValue | null;
  fairness: Prisma.JsonValue | null;
  recoveryAttempts: number;
  lastRecoveryAt: Date | null;
  nextRecoveryAt: Date | null;
  error: string | null;
  createdAt: Date;
  settledAt: Date | null;
};
