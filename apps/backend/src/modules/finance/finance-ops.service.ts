import { BadRequestException, Injectable } from '@nestjs/common';
import { DepositStatus, GameRoundStatus, Prisma, WithdrawalStatus } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';

/**
 * Finance operations (Phase 2D.10) — F-01 portal, F-06 cash flow, F-07 transaction search and
 * failed-transaction view.
 *
 * STRICTLY READ-ONLY. Nothing here credits, debits, reserves, settles or adjusts. It is the finance
 * team's window onto money that has already moved, built from the authoritative tables.
 *
 * TWO RULES THIS FILE OBEYS ABSOLUTELY:
 *
 *   1. **Never a combined currency total.** There is no FX source, so every monetary figure is
 *      returned in a per-currency bucket. A cross-currency sum would be a fabricated number.
 *   2. **Never the word "revenue", and never a profit.** Cash flow here is exactly what it says:
 *      money that entered minus money that left, per currency. It is NOT revenue, NOT gross gaming
 *      revenue and NOT profit — those require the accounting definition that blocks F-02, and this
 *      service deliberately refuses to imply one.
 */

const FAILED_DEPOSIT_STATUSES: DepositStatus[] = [
  DepositStatus.FAILED, DepositStatus.CANCELLED, DepositStatus.EXPIRED,
];
const FAILED_WITHDRAWAL_STATUSES: WithdrawalStatus[] = [
  WithdrawalStatus.FAILED, WithdrawalStatus.REJECTED, WithdrawalStatus.CANCELLED,
];
const FAILED_ROUND_STATUSES: GameRoundStatus[] = [
  GameRoundStatus.FAILED, GameRoundStatus.RECOVERY_FAILED,
];

const REVENUE_BLOCKED = {
  metric: 'revenue',
  reason:
    'NOT AVAILABLE — BUSINESS DEFINITION MISSING: this platform has no agreed accounting definition ' +
    'of revenue. Cash flow below is money in minus money out per currency, which is a movement ' +
    'figure and NOT revenue. See CLIENT_DECISIONS_REQUIRED.md, decision D-01.',
};
const PROFIT_BLOCKED = {
  metric: 'profit',
  reason:
    'NOT AVAILABLE: profit is revenue minus expenses. Expenses are recorded (F-03); revenue is not ' +
    'defined, so no profit figure is produced. It will not be inferred from deposits minus ' +
    'withdrawals, nor from stakes minus payouts.',
};
const FX_BLOCKED = {
  metric: 'consolidatedCurrencyTotal',
  reason:
    'NOT AVAILABLE: exchange_rates is empty, so no FX source exists. Totals are reported per ' +
    'currency and are never combined.',
};

export interface CurrencyMovement {
  currency: string;
  moneyIn: string;
  moneyOut: string;
  /** moneyIn − moneyOut for THIS currency only. A movement figure, never called revenue. */
  netMovement: string;
  depositCount: number;
  withdrawalCount: number;
}

@Injectable()
export class FinanceOpsService {
  constructor(private readonly prisma: PrismaService) {}

  private window(from?: string, to?: string): { from: Date; to: Date } {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86_400_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('from and to must be valid dates.');
    }
    if (end <= start) throw new BadRequestException('to must be after from.');
    const days = (end.getTime() - start.getTime()) / 86_400_000;
    // Rejected, never clamped — a silently narrowed window would report real numbers for a period
    // the caller did not ask about.
    if (days > 366) {
      throw new BadRequestException(
        `Range must not exceed 366 days (requested ${Math.ceil(days)}). The range was NOT truncated.`,
      );
    }
    return { from: start, to: end };
  }

  private async currencyCodes(ids: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return {};
    const rows = await this.prisma.currency.findMany({
      where: { id: { in: unique } }, select: { id: true, code: true },
    });
    return Object.fromEntries(rows.map((r) => [r.id, r.code]));
  }

  /* ------------------------------------------------------------- F-06 cash flow */

  /**
   * Cash flow — completed money in and out, per currency.
   *
   * "In" is a COMPLETED deposit; "out" is a COMPLETED withdrawal. Pending, failed and rejected
   * requests are excluded because they moved no money. Nothing here is netted across currencies.
   */
  async cashFlow(query: { from?: string; to?: string }) {
    const range = this.window(query.from, query.to);
    const inRange = { createdAt: { gte: range.from, lt: range.to } };

    const [deposits, withdrawals] = await Promise.all([
      this.prisma.depositRequest.groupBy({
        by: ['currencyId'],
        where: { ...inRange, status: DepositStatus.COMPLETED },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.withdrawalRequest.groupBy({
        by: ['currencyId'],
        where: { ...inRange, status: WithdrawalStatus.COMPLETED },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    const codes = await this.currencyCodes([
      ...deposits.map((d) => d.currencyId),
      ...withdrawals.map((w) => w.currencyId),
    ]);

    const byCurrency = new Map<string, CurrencyMovement>();
    const bucket = (currencyId: string): CurrencyMovement => {
      const code = codes[currencyId] ?? currencyId;
      let b = byCurrency.get(code);
      if (!b) {
        b = { currency: code, moneyIn: '0', moneyOut: '0', netMovement: '0', depositCount: 0, withdrawalCount: 0 };
        byCurrency.set(code, b);
      }
      return b;
    };

    for (const d of deposits) {
      const b = bucket(d.currencyId);
      b.moneyIn = (d._sum.amount ?? new Prisma.Decimal(0)).toString();
      b.depositCount = d._count._all;
    }
    for (const w of withdrawals) {
      const b = bucket(w.currencyId);
      b.moneyOut = (w._sum.amount ?? new Prisma.Decimal(0)).toString();
      b.withdrawalCount = w._count._all;
    }
    for (const b of byCurrency.values()) {
      b.netMovement = new Prisma.Decimal(b.moneyIn).minus(new Prisma.Decimal(b.moneyOut)).toString();
    }

    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      definition:
        'Money in = COMPLETED deposits. Money out = COMPLETED withdrawals. Net movement is per ' +
        'currency and is a cash movement figure — it is not revenue and not profit.',
      byCurrency: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
      unavailable: [REVENUE_BLOCKED, PROFIT_BLOCKED, FX_BLOCKED],
    };
  }

  /* --------------------------------------------------- F-07 transaction search */

  /**
   * Global transaction search.
   *
   * The pre-existing operator surface could only list ONE user's transactions at a time
   * (`admin/wallet/users/:id/transactions`). This is the platform-wide, filterable view the finance
   * requirement asks for. Filters are all optional and combine with AND.
   */
  async searchTransactions(query: {
    userId?: string; typeCode?: string; statusCode?: string; currencyCode?: string;
    reference?: string; minAmount?: string; maxAmount?: string;
    from?: string; to?: string; page?: number; limit?: number;
  }) {
    const range = this.window(query.from, query.to);
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));

    const [type, status, currency] = await Promise.all([
      query.typeCode
        ? this.prisma.transactionType.findUnique({ where: { code: query.typeCode.toUpperCase() }, select: { id: true } })
        : null,
      query.statusCode
        ? this.prisma.transactionStatus.findUnique({ where: { code: query.statusCode.toUpperCase() }, select: { id: true } })
        : null,
      query.currencyCode
        ? this.prisma.currency.findUnique({ where: { code: query.currencyCode.toUpperCase() }, select: { id: true } })
        : null,
    ]);

    // An unknown filter value must match NOTHING rather than being silently ignored — otherwise the
    // caller would receive platform-wide results under a filter label they believe was applied.
    const NO_MATCH = '00000000-0000-0000-0000-000000000000';

    const amountFilter: Prisma.DecimalFilter = {};
    if (query.minAmount !== undefined) amountFilter.gte = new Prisma.Decimal(query.minAmount);
    if (query.maxAmount !== undefined) amountFilter.lte = new Prisma.Decimal(query.maxAmount);

    const where: Prisma.WalletTransactionWhereInput = {
      createdAt: { gte: range.from, lt: range.to },
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.typeCode ? { typeId: type?.id ?? NO_MATCH } : {}),
      ...(query.statusCode ? { statusId: status?.id ?? NO_MATCH } : {}),
      ...(query.currencyCode ? { currencyId: currency?.id ?? NO_MATCH } : {}),
      ...(query.reference ? { reference: { contains: query.reference, mode: 'insensitive' } } : {}),
      ...(Object.keys(amountFilter).length > 0 ? { amount: amountFilter } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { username: true } },
          type: { select: { code: true } },
          status: { select: { code: true } },
          currency: { select: { code: true } },
        },
      }),
      this.prisma.walletTransaction.count({ where }),
    ]);

    return {
      items: rows.map((t) => ({
        id: t.id,
        userId: t.userId,
        username: t.user.username,
        type: t.type.code,
        status: t.status.code,
        currency: t.currency.code,
        amount: t.amount.toString(),
        balanceAfter: t.balanceAfter?.toString() ?? null,
        reference: t.reference,
        description: t.description,
        createdAt: t.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
      unavailable: [FX_BLOCKED],
    };
  }

  /* ------------------------------------------------ F-07 failed transactions */

  /**
   * Where money actually failed.
   *
   * IMPORTANT AND DELIBERATE: `wallet_transactions` carries **no failure status** — every posted
   * transaction is terminal-successful by construction, because the engine writes a transaction only
   * once its ledger entries are committed. Rendering an empty "failed transactions" table over that
   * source would be misleading, so this view reports the three places failure is genuinely recorded:
   * failed deposits, rejected/failed withdrawals, and game rounds that failed or failed recovery.
   */
  async failures(query: { from?: string; to?: string; limit?: number }) {
    const range = this.window(query.from, query.to);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const inRange = { createdAt: { gte: range.from, lt: range.to } };

    const [depositRows, withdrawalRows, roundRows, postedStatuses] = await Promise.all([
      this.prisma.depositRequest.findMany({
        where: { ...inRange, status: { in: FAILED_DEPOSIT_STATUSES } },
        orderBy: { createdAt: 'desc' }, take: limit,
        include: { user: { select: { username: true } }, currency: { select: { code: true } } },
      }),
      this.prisma.withdrawalRequest.findMany({
        where: { ...inRange, status: { in: FAILED_WITHDRAWAL_STATUSES } },
        orderBy: { createdAt: 'desc' }, take: limit,
        include: { user: { select: { username: true } }, currency: { select: { code: true } } },
      }),
      this.prisma.gameRound.groupBy({
        by: ['status', 'gameKey'],
        where: { ...inRange, status: { in: FAILED_ROUND_STATUSES } },
        _count: { _all: true },
      }),
      this.prisma.transactionStatus.findMany({ select: { code: true } }),
    ]);

    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      failedDeposits: depositRows.map((d) => ({
        id: d.id, username: d.user.username, currency: d.currency.code,
        amount: d.amount.toString(), status: d.status, reference: d.reference,
        createdAt: d.createdAt.toISOString(),
      })),
      failedWithdrawals: withdrawalRows.map((w) => ({
        id: w.id, username: w.user.username, currency: w.currency.code,
        amount: w.amount.toString(), status: w.status, reference: w.reference,
        createdAt: w.createdAt.toISOString(),
      })),
      failedRounds: roundRows.map((r) => ({
        status: r.status, gameKey: r.gameKey, count: r._count._all,
      })),
      ledgerNote:
        'wallet_transactions has no failure status by design — the engine posts a transaction only ' +
        `after its ledger entries commit. Statuses present in this deployment: ` +
        `${postedStatuses.map((s) => s.code).sort().join(', ')}. Failures are therefore reported ` +
        'from the request and round tables above, where they are genuinely recorded.',
    };
  }

  /* -------------------------------------------- F-01 cashier work queues */

  /**
   * The deposits and withdrawals waiting for an operator decision (Phase 2D.12).
   *
   * WHY THIS EXISTS: `/admin/cashier/*` can complete, approve or reject a request **by id**, but
   * nothing listed the ids. An operator could act only on a request they already knew about, which
   * in practice meant no operator could work the queue at all. With the payment gateway
   * deliberately deferred, operator credit IS the deposit rail, so this is the difference between
   * a working cashier and a theoretical one.
   *
   * READ-ONLY, and separately permissioned: seeing the queue needs `transactions:read` (a finance
   * operator may review it); ACTING on an entry still needs `wallets:adjust` on the existing
   * `/admin/cashier/*` routes. Reading a queue is not authority to move money.
   *
   * Amounts are rendered per request in its own currency — never summed, because there is no FX
   * source and a queue total across currencies would be a fabricated number.
   *
   * PAGINATED, AND THE TOTAL IS RETURNED. The first version capped the result and ordered
   * oldest-first, which meant that once the backlog exceeded the cap a newly-created request was
   * silently invisible — the operator could not find the very work they needed to action. A queue
   * that hides work is worse than no queue, so the count is always reported and the caller can page.
   */
  async cashierQueue(query: {
    kind?: 'deposits' | 'withdrawals';
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const page = Math.max(1, query.page ?? 1);
    const skip = (page - 1) * limit;
    const kind = query.kind ?? 'deposits';

    if (kind === 'deposits') {
      // Default to the states that genuinely await a decision.
      const statuses = query.status
        ? [query.status as DepositStatus]
        : [DepositStatus.PENDING, DepositStatus.PROCESSING];
      const [rows, total] = await Promise.all([
        this.prisma.depositRequest.findMany({
          where: { status: { in: statuses } },
          orderBy: { createdAt: 'asc' }, // oldest first: a queue, not a feed
          skip,
          take: limit,
          include: {
            user: { select: { id: true, username: true, email: true } },
            currency: { select: { code: true } },
          },
        }),
        this.prisma.depositRequest.count({ where: { status: { in: statuses } } }),
      ]);
      return {
        kind,
        statuses,
        total,
        page,
        limit,
        items: rows.map((d) => ({
          id: d.id,
          userId: d.user.id,
          username: d.user.username,
          currency: d.currency.code,
          amount: d.amount.toString(),
          netAmount: d.netAmount.toString(),
          status: d.status,
          reference: d.reference,
          requestedAt: d.createdAt.toISOString(),
        })),
        note:
          'Oldest first. Completing a deposit credits the player wallet through the ledger and is '
          + 'the authoritative money movement — it requires wallets:adjust and is audited.',
      };
    }

    const statuses = query.status
      ? [query.status as WithdrawalStatus]
      : [WithdrawalStatus.PENDING, WithdrawalStatus.UNDER_REVIEW, WithdrawalStatus.APPROVED];
    const [rows, total] = await Promise.all([
      this.prisma.withdrawalRequest.findMany({
        where: { status: { in: statuses } },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
        include: {
          user: { select: { id: true, username: true, email: true } },
          currency: { select: { code: true } },
        },
      }),
      this.prisma.withdrawalRequest.count({ where: { status: { in: statuses } } }),
    ]);
    return {
      kind,
      statuses,
      total,
      page,
      limit,
      items: rows.map((w) => ({
        id: w.id,
        userId: w.user.id,
        username: w.user.username,
        currency: w.currency.code,
        amount: w.amount.toString(),
        netAmount: w.netAmount.toString(),
        status: w.status,
        reference: w.reference,
        rejectionReason: w.rejectionReason,
        requestedAt: w.createdAt.toISOString(),
        approvedAt: w.approvedAt?.toISOString() ?? null,
      })),
      note:
        'Funds were already held when the player requested the withdrawal, so approving moves no '
        + 'money; rejecting refunds the held funds. Both require wallets:adjust and are audited.',
    };
  }

  /* ------------------------------------------------------------ F-01 portal */

  /**
   * The finance portal's landing figures: what is waiting for a human decision right now.
   *
   * Counts only — no money is summed here, because a queue length is a workload figure and mixing
   * it with amounts invites reading it as an exposure.
   */
  async reviewQueues() {
    const [pendingDeposits, pendingWithdrawals, underReview, approvedNotPaid] = await Promise.all([
      this.prisma.depositRequest.count({ where: { status: DepositStatus.PENDING } }),
      this.prisma.withdrawalRequest.count({ where: { status: WithdrawalStatus.PENDING } }),
      this.prisma.withdrawalRequest.count({ where: { status: WithdrawalStatus.UNDER_REVIEW } }),
      this.prisma.withdrawalRequest.count({ where: { status: WithdrawalStatus.APPROVED } }),
    ]);

    return {
      pendingDeposits,
      pendingWithdrawals,
      withdrawalsUnderReview: underReview,
      withdrawalsApprovedAwaitingPayment: approvedNotPaid,
      note:
        'Queue lengths only. Deposit and withdrawal decisions are taken on the existing operator ' +
        'cashier surface, which already enforces its own authorization and audit.',
    };
  }
}
