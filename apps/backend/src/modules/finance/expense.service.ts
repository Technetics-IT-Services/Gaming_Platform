import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ExpenseStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../security/audit.service';

/**
 * Operating expenses (F-03).
 *
 * WHAT THIS IS: a record of what the business spent — category, amount, currency, business date,
 * status, attribution.
 *
 * WHAT THIS IS NOT:
 *   * **A wallet movement.** An accounting expense and a player money movement are different things.
 *     No ledger entry, no wallet transaction, no reservation. `WalletEngine`, the ledger and
 *     settlement are untouched, and a test asserts this service has no wallet collaborator at all.
 *   * **Profit.** Profit is `revenue − expenses`, and revenue has no agreed definition on this
 *     platform. `totals()` deliberately returns expense sums ONLY, per currency, and says so.
 *
 * MULTI-CURRENCY: totals are per currency and never combined — there is no FX source, exactly as in
 * analytics (2D.6).
 */

export interface ExpenseView {
  id: string;
  category: { id: string; code: string; name: string };
  description: string;
  /** Decimal string. Never a float. */
  amount: string;
  currency: string;
  incurredOn: string;
  status: ExpenseStatus;
  reference: string | null;
  createdByUserId: string;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

/** Statuses that count toward aggregation. VOID and DRAFT deliberately do not. */
export const COUNTED_STATUSES: ExpenseStatus[] = [ExpenseStatus.CONFIRMED];

@Injectable()
export class ExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------- categories */

  async listCategories(includeInactive = false) {
    const rows = await this.prisma.expenseCategory.findMany({
      where: { deletedAt: null, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { code: 'asc' },
    });
    return rows.map((c) => ({ id: c.id, code: c.code, name: c.name, isActive: c.isActive }));
  }

  async createCategory(input: { code: string; name: string; actorUserId: string }) {
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z0-9_]{2,40}$/.test(code)) {
      throw new BadRequestException('Category code must be 2–40 characters of A–Z, 0–9 or underscore.');
    }
    const existing = await this.prisma.expenseCategory.findUnique({ where: { code } });
    if (existing) throw new BadRequestException(`Category ${code} already exists.`);

    const created = await this.prisma.expenseCategory.create({ data: { code, name: input.name.trim() } });
    await this.audit.record({
      userId: input.actorUserId,
      action: 'CREATE',
      entityType: 'expense_category',
      entityId: created.id,
      changes: { code, name: created.name },
    });
    return { id: created.id, code: created.code, name: created.name, isActive: created.isActive };
  }

  /* --------------------------------------------------------------- expenses */

  private view(e: {
    id: string; description: string; amount: Prisma.Decimal; incurredOn: Date;
    status: ExpenseStatus; reference: string | null; createdByUserId: string; createdAt: Date;
    voidedAt: Date | null; voidReason: string | null;
    category: { id: string; code: string; name: string };
    currency: { code: string };
  }): ExpenseView {
    return {
      id: e.id,
      category: { id: e.category.id, code: e.category.code, name: e.category.name },
      description: e.description,
      amount: e.amount.toString(),
      currency: e.currency.code,
      incurredOn: e.incurredOn.toISOString().slice(0, 10),
      status: e.status,
      reference: e.reference,
      createdByUserId: e.createdByUserId,
      createdAt: e.createdAt.toISOString(),
      voidedAt: e.voidedAt?.toISOString() ?? null,
      voidReason: e.voidReason,
    };
  }

  private readonly include = {
    category: { select: { id: true, code: true, name: true } },
    currency: { select: { code: true } },
  };

  async create(input: {
    categoryId: string;
    description: string;
    amount: string;
    currencyCode: string;
    incurredOn: string;
    reference?: string;
    notes?: string;
    actorUserId: string;
  }): Promise<ExpenseView> {
    const amount = new Prisma.Decimal(input.amount);
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Expense amount must be a positive decimal.');
    }

    const [category, currency] = await Promise.all([
      this.prisma.expenseCategory.findFirst({ where: { id: input.categoryId, deletedAt: null } }),
      this.prisma.currency.findUnique({ where: { code: input.currencyCode.toUpperCase() }, select: { id: true, code: true } }),
    ]);
    if (!category) throw new NotFoundException('Expense category not found.');
    if (!currency) throw new BadRequestException(`Unknown currency: ${input.currencyCode}`);

    const incurredOn = new Date(`${input.incurredOn}T00:00:00.000Z`);
    if (Number.isNaN(incurredOn.getTime())) {
      throw new BadRequestException('incurredOn must be a valid YYYY-MM-DD date.');
    }
    // A business date in the future is almost always a typo, and would silently distort a future
    // period's aggregation.
    if (incurredOn.getTime() > Date.now() + 86_400_000) {
      throw new BadRequestException('incurredOn cannot be in the future.');
    }

    const reference = input.reference?.trim() || null;
    if (reference) {
      const dup = await this.prisma.expense.findUnique({ where: { reference } });
      if (dup) {
        throw new BadRequestException(`Reference ${reference} is already recorded — this looks like a duplicate.`);
      }
    }

    const created = await this.prisma.expense.create({
      data: {
        categoryId: category.id,
        description: input.description.trim(),
        amount,
        currencyId: currency.id,
        incurredOn,
        reference,
        notes: input.notes?.trim() ?? null,
        // Always DRAFT on creation. Nothing a client sends can make an expense count immediately.
        status: ExpenseStatus.DRAFT,
        createdByUserId: input.actorUserId,
      },
      include: this.include,
    });

    await this.audit.record({
      userId: input.actorUserId,
      action: 'CREATE',
      entityType: 'expense',
      entityId: created.id,
      changes: {
        category: category.code, amount: amount.toString(), currency: currency.code,
        incurredOn: input.incurredOn, reference,
      },
    });

    return this.view(created);
  }

  /** Move DRAFT → CONFIRMED. Only a confirmed expense counts toward aggregation. */
  async confirm(id: string, actorUserId: string): Promise<ExpenseView> {
    const before = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Expense not found.');
    if (before.status !== ExpenseStatus.DRAFT) {
      throw new BadRequestException(`Only a DRAFT expense can be confirmed. This one is ${before.status}.`);
    }

    // Conditional update: two concurrent confirms cannot both win.
    const { count } = await this.prisma.expense.updateMany({
      where: { id, status: ExpenseStatus.DRAFT, deletedAt: null },
      data: { status: ExpenseStatus.CONFIRMED },
    });
    if (count === 0) throw new BadRequestException('This expense was already updated. Reload and retry.');

    await this.audit.record({
      userId: actorUserId, action: 'APPROVE', entityType: 'expense', entityId: id,
      changes: { from: ExpenseStatus.DRAFT, to: ExpenseStatus.CONFIRMED, amount: before.amount.toString() },
    });
    return this.getById(id);
  }

  /**
   * Void an expense.
   *
   * Deliberately NOT a delete: financial records are retained for audit. A voided expense is
   * excluded from aggregation but stays queryable, with who voided it and why.
   */
  async void(id: string, reason: string, actorUserId: string): Promise<ExpenseView> {
    if (!reason?.trim()) throw new BadRequestException('Voiding an expense requires a reason.');

    const before = await this.prisma.expense.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Expense not found.');
    if (before.status === ExpenseStatus.VOID) {
      throw new BadRequestException('This expense is already void.');
    }

    const { count } = await this.prisma.expense.updateMany({
      where: { id, deletedAt: null, status: { not: ExpenseStatus.VOID } },
      data: {
        status: ExpenseStatus.VOID,
        voidedAt: new Date(),
        voidedByUserId: actorUserId,
        voidReason: reason.trim(),
      },
    });
    if (count === 0) throw new BadRequestException('This expense was already updated. Reload and retry.');

    await this.audit.record({
      userId: actorUserId, action: 'UPDATE', entityType: 'expense', entityId: id,
      changes: { from: before.status, to: ExpenseStatus.VOID, reason: reason.trim(), amount: before.amount.toString() },
    });
    return this.getById(id);
  }

  async getById(id: string): Promise<ExpenseView> {
    const e = await this.prisma.expense.findFirst({ where: { id, deletedAt: null }, include: this.include });
    if (!e) throw new NotFoundException('Expense not found.');
    return this.view(e);
  }

  async list(query: {
    status?: ExpenseStatus; categoryId?: string; currency?: string;
    from?: string; to?: string; page?: number; limit?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    let currencyId: string | undefined;
    if (query.currency) {
      const c = await this.prisma.currency.findUnique({
        where: { code: query.currency.toUpperCase() }, select: { id: true },
      });
      // An unknown currency filters everything out rather than being ignored — the same rule
      // analytics uses, so a typo can never silently report platform-wide figures.
      currencyId = c?.id ?? '00000000-0000-0000-0000-000000000000';
    }

    const where: Prisma.ExpenseWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(currencyId ? { currencyId } : {}),
      ...(query.from || query.to
        ? {
            incurredOn: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.expense.findMany({
        where, orderBy: [{ incurredOn: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit, take: limit, include: this.include,
      }),
      this.prisma.expense.count({ where }),
    ]);

    return { items: rows.map((r) => this.view(r)), total, page, limit };
  }

  /**
   * Expense totals per currency for a period.
   *
   * **This is NOT profit.** It is the expense side only. Profit requires a revenue figure, and no
   * definition of revenue exists on this platform — so the response says so explicitly rather than
   * leaving a consumer to assume the missing half is zero.
   */
  async totals(query: { from?: string; to?: string }) {
    const where: Prisma.ExpenseWhereInput = {
      deletedAt: null,
      status: { in: COUNTED_STATUSES },
      ...(query.from || query.to
        ? {
            incurredOn: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T00:00:00.000Z`) } : {}),
            },
          }
        : {}),
    };

    const grouped = await this.prisma.expense.groupBy({
      by: ['currencyId'], where, _sum: { amount: true }, _count: { _all: true },
    });
    const codes = await this.prisma.currency.findMany({
      where: { id: { in: grouped.map((g) => g.currencyId) } }, select: { id: true, code: true },
    });
    const byId = Object.fromEntries(codes.map((c) => [c.id, c.code]));

    return {
      // Per currency, never combined: there is no FX source.
      byCurrency: grouped.map((g) => ({
        currency: byId[g.currencyId] ?? g.currencyId,
        total: (g._sum.amount ?? new Prisma.Decimal(0)).toString(),
        count: g._count._all,
      })),
      basis: 'CONFIRMED expenses only. DRAFT and VOID are excluded.',
      unavailable: [
        {
          metric: 'profit',
          reason:
            'NOT AVAILABLE — BUSINESS DEFINITION MISSING: profit is revenue − expenses. Expenses are ' +
            'now recorded, but the platform has no agreed definition of revenue, so profit cannot be ' +
            'computed. This is a client decision, not a missing integration.',
        },
      ],
    };
  }
}
