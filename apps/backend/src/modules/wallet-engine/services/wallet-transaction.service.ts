import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';

export interface TransactionView {
  id: string;
  reference: string;
  type: string;
  status: string;
  amount: string;
  fee: string;
  balanceBefore: string;
  balanceAfter: string;
  currency: string;
  description: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface TransactionQuery {
  page?: number;
  limit?: number;
  type?: string;
  status?: string;
  /** Currency code filter (e.g. INR). */
  currency?: string;
  /** ISO-8601 lower bound on createdAt (inclusive). */
  from?: string;
  /** ISO-8601 upper bound on createdAt (inclusive). */
  to?: string;
}

/**
 * Append-only transaction ledger access. Transactions are written exclusively by
 * {@link import('./wallet-engine.service').WalletEngineService}; this service is
 * read-only history with filtering and pagination.
 */
@Injectable()
export class WalletTransactionService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: TransactionQuery = {}) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const createdAt = this.dateRange(query.from, query.to);
    const where = {
      userId,
      ...(query.type ? { type: { code: query.type } } : {}),
      ...(query.status ? { status: { code: query.status } } : {}),
      ...(query.currency ? { currency: { code: query.currency.toUpperCase() } } : {}),
      ...(createdAt ? { createdAt } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        include: { type: true, status: true, currency: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.walletTransaction.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toView(r)),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  async findById(userId: string, id: string): Promise<TransactionView> {
    const row = await this.prisma.walletTransaction.findFirst({
      where: { id, userId },
      include: { type: true, status: true, currency: true },
    });
    if (!row) throw new NotFoundException('Transaction not found');
    return this.toView(row);
  }

  /** Build an inclusive createdAt range from ISO-8601 bounds; throws on an invalid date. */
  private dateRange(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
    const parse = (v: string, label: string): Date => {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid ${label} date (expected ISO-8601)`);
      return d;
    };
    if (!from && !to) return undefined;
    return { ...(from ? { gte: parse(from, 'from') } : {}), ...(to ? { lte: parse(to, 'to') } : {}) };
  }

  private toView(row: {
    id: string;
    reference: string;
    amount: { toString(): string };
    fee?: { toString(): string };
    balanceBefore?: { toString(): string };
    balanceAfter: { toString(): string };
    description: string | null;
    metadata?: unknown;
    createdAt: Date;
    type: { code: string };
    status: { code: string };
    currency?: { code: string };
  }): TransactionView {
    return {
      id: row.id,
      reference: row.reference,
      type: row.type.code,
      status: row.status.code,
      amount: row.amount.toString(),
      fee: row.fee ? row.fee.toString() : '0',
      balanceBefore: row.balanceBefore ? row.balanceBefore.toString() : '0',
      balanceAfter: row.balanceAfter.toString(),
      currency: row.currency?.code ?? '',
      description: row.description,
      metadata: row.metadata ?? null,
      createdAt: row.createdAt,
    };
  }
}
