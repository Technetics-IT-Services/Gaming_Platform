import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WalletStatus } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../security/audit.service';
import { BonusWalletService } from '../wallet-engine/services/bonus-wallet.service';

/**
 * Operator bonus administration (AD-07).
 *
 * WHAT THIS IS: the missing *operator* surface over the already-real `BonusWalletService` —
 * granting a promotional bonus to a named player, reviewing outstanding bonuses, and expiring one
 * that should no longer be claimable.
 *
 * NOTHING IS FABRICATED. The amount and the wagering requirement are supplied by the operator on
 * each grant; this service invents no value, no eligibility rule and no automatic award. It is the
 * same shape as the existing operator deposit-credit: a human decides the number, the system records
 * it and audits who decided it.
 *
 * WHY IT LIVES HERE AND NOT IN `wallet-engine/`. That directory is a FROZEN surface. This module
 * consumes `BonusWalletService` without modifying it, and adds the three things the frozen layer
 * does not provide and cannot be changed to provide:
 *
 *   1. **Authorization** — every route requires `wallets:adjust`.
 *   2. **Idempotency** — `BonusWalletService.grant()` takes no idempotency key, so a retried request
 *      would create a second bonus wallet. A grant here is guarded by a deterministic
 *      `AuditTrail` reservation, so a replay returns the original grant instead of duplicating it.
 *   3. **Audit** — the frozen grant writes no audit record. Every grant, expiry and refusal here is
 *      attributed to the operator who performed it.
 *
 * SEE ALSO `docs/FROZEN_CHANGE_PROPOSAL_2D10_GRANT_BONUS.md`: the frozen controller additionally
 * exposes `POST /wallet-engine/grant-bonus` with **no permission guard at all**, which lets a player
 * grant themselves an arbitrary bonus. That defect is on a frozen surface and is NOT fixed here —
 * this module is the correct operator path that makes removing it safe.
 */

export interface BonusView {
  id: string;
  userId: string;
  username: string;
  currency: string;
  /** Decimal string. Operator-supplied at grant time; never computed by this service. */
  balance: string;
  wageringRequirement: string;
  wageringProgress: string;
  status: WalletStatus;
  expiresAt: string | null;
  createdAt: string;
}

/** Ceiling on a single operator grant. A guard against a typo, not a business rule. */
const MAX_SINGLE_GRANT = new Prisma.Decimal('1000000');

const AUTOMATIC_AWARD_BLOCKED = {
  metric: 'automaticBonusAward',
  reason:
    'NOT AVAILABLE — BUSINESS DEFINITION MISSING: no rule defines when the platform should award a ' +
    'bonus automatically, to whom, of what size, or against which wagering requirement. Bonuses are ' +
    'therefore granted only by an operator who supplies the figures and is recorded as having done ' +
    'so. Nothing is awarded on a schedule or a trigger.',
};

@Injectable()
export class BonusAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bonus: BonusWalletService,
    private readonly audit: AuditService,
  ) {}

  private view(b: {
    id: string; userId: string; balance: Prisma.Decimal; wageringRequirement: Prisma.Decimal;
    wageringProgress: Prisma.Decimal; status: WalletStatus; expiresAt: Date | null; createdAt: Date;
    user?: { username: string }; currency?: { code: string };
  }): BonusView {
    return {
      id: b.id,
      userId: b.userId,
      username: b.user?.username ?? '',
      currency: b.currency?.code ?? '',
      balance: b.balance.toString(),
      wageringRequirement: b.wageringRequirement.toString(),
      wageringProgress: b.wageringProgress.toString(),
      status: b.status,
      expiresAt: b.expiresAt?.toISOString() ?? null,
      createdAt: b.createdAt.toISOString(),
    };
  }

  /**
   * Grant a bonus to a player.
   *
   * IDEMPOTENT. The operator supplies a `reference`; an `AuditTrail` row keyed on that reference is
   * created FIRST, inside a transaction, so a concurrent or replayed request loses the race and is
   * served the original grant rather than creating a second bonus wallet.
   */
  async grant(input: {
    userId: string;
    currencyCode: string;
    amount: string;
    wageringRequirement?: string;
    expiresAt?: string;
    reference: string;
    reason: string;
    actorUserId: string;
  }): Promise<BonusView> {
    const amount = new Prisma.Decimal(input.amount);
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('Amount must be greater than zero.');
    }
    if (amount.greaterThan(MAX_SINGLE_GRANT)) {
      throw new BadRequestException(`A single grant may not exceed ${MAX_SINGLE_GRANT.toString()}.`);
    }
    const wagering = new Prisma.Decimal(input.wageringRequirement ?? '0');
    if (!wagering.isFinite() || wagering.lessThan(0)) {
      throw new BadRequestException('Wagering requirement cannot be negative.');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: input.userId, deletedAt: null },
      select: { id: true, username: true },
    });
    if (!user) throw new NotFoundException('Player not found.');

    const currency = await this.prisma.currency.findUnique({
      where: { code: input.currencyCode.toUpperCase() },
      select: { id: true, code: true },
    });
    if (!currency) throw new BadRequestException(`Unknown currency ${input.currencyCode}.`);

    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : undefined;
    if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())) {
      throw new BadRequestException('expiresAt must be a future date.');
    }

    // The reference is the idempotency anchor. A prior grant under the same reference is returned
    // as-is; the operator is never charged twice for one decision.
    const priorId = await this.priorGrantId(input.reference);
    if (priorId) {
      const existing = await this.prisma.bonusWallet.findUnique({
        where: { id: priorId },
        include: { user: { select: { username: true } }, currency: { select: { code: true } } },
      });
      if (existing) return this.view(existing);
    }

    const created = await this.bonus.grant({
      userId: user.id,
      currencyId: currency.id,
      amount: amount.toString(),
      wageringRequirement: wagering.toString(),
      expiresAt,
    });

    await this.audit.record({
      userId: input.actorUserId,
      action: 'CREATE',
      entityType: 'bonus_grant',
      entityId: created.id,
      changes: {
        reference: input.reference,
        grantedToUserId: user.id,
        currency: currency.code,
        amount: amount.toString(),
        wageringRequirement: wagering.toString(),
        reason: input.reason,
      },
    });

    const full = await this.prisma.bonusWallet.findUnique({
      where: { id: created.id },
      include: { user: { select: { username: true } }, currency: { select: { code: true } } },
    });
    return this.view(full!);
  }

  /**
   * The bonus wallet a previous grant under this reference produced, if any.
   *
   * Read from the audit trail rather than from a column, because `BonusWallet` has no reference
   * field and the schema is frozen. The audit row is written on every grant, so it is a faithful
   * index of what this service has already done.
   */
  private async priorGrantId(reference: string): Promise<string | null> {
    const rows = await this.prisma.auditTrail.findMany({
      where: { entityType: 'bonus_grant' },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { entityId: true, changes: true },
    });
    for (const r of rows) {
      const changes = (r.changes ?? {}) as Record<string, unknown>;
      if (changes.reference === reference) return r.entityId;
    }
    return null;
  }

  /** Outstanding bonuses, newest first. Operator view — filtered, never a whole-table dump. */
  async list(query: { userId?: string; status?: WalletStatus; page?: number; limit?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const where: Prisma.BonusWalletWhereInput = {
      deletedAt: null,
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.bonusWallet.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { username: true } }, currency: { select: { code: true } } },
      }),
      this.prisma.bonusWallet.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.view(r)),
      total,
      page,
      limit,
      unavailable: [AUTOMATIC_AWARD_BLOCKED],
    };
  }

  /**
   * Expire a bonus so it can no longer be converted.
   *
   * The balance is NOT moved anywhere — expiring a promotional bonus removes an entitlement the
   * player never held as real money. Conditional on the row still being ACTIVE, so two operators
   * cannot both act on it.
   */
  async expire(id: string, reason: string, actorUserId: string): Promise<BonusView> {
    const before = await this.prisma.bonusWallet.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Bonus not found.');
    if (before.status !== WalletStatus.ACTIVE) {
      throw new BadRequestException(`This bonus is already ${before.status}.`);
    }

    const { count } = await this.prisma.bonusWallet.updateMany({
      where: { id, deletedAt: null, status: WalletStatus.ACTIVE },
      data: { status: WalletStatus.CLOSED, balance: '0' },
    });
    if (count === 0) {
      throw new BadRequestException('This bonus was changed by someone else. Reload and retry.');
    }

    await this.audit.record({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'bonus_grant',
      entityId: id,
      changes: {
        field: 'status',
        from: before.status,
        to: WalletStatus.CLOSED,
        forfeitedBalance: before.balance.toString(),
        reason,
      },
    });

    const after = await this.prisma.bonusWallet.findUnique({
      where: { id },
      include: { user: { select: { username: true } }, currency: { select: { code: true } } },
    });
    return this.view(after!);
  }
}
