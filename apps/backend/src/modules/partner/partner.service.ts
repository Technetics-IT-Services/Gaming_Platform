import { randomBytes } from 'node:crypto';

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PartnerStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { RbacService } from '../authorization/rbac.service';
import { ROLE_SLUGS } from '../authorization/rbac.constants';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { AuditService } from '../security/audit.service';

/**
 * Partner principal (PA-01).
 *
 * WHAT THIS IS: who a partner is, which users belong to them, and what ownership share they hold.
 *
 * WHAT THIS DELIBERATELY IS NOT: money. There is no partner wallet, balance, commission or payout
 * here, because the platform has no definition of "revenue" and no expense model — so profit,
 * available balance and partner withdrawals cannot be computed without fabricating the semantics.
 * Those requirements are reported as BLOCKED, with the missing definition named, rather than faked.
 *
 * ISOLATION: a partner-scoped read resolves the caller's partner from `PartnerUser.userId` (unique),
 * never from anything the client sends. There is no route that takes a partner id from a partner.
 */

/** Percentage bounds. A share of 0–100, stored with 4 decimal places. */
const MAX_TOTAL_SHARE = new Prisma.Decimal(100);

export interface PartnerView {
  id: string;
  code: string;
  name: string;
  status: PartnerStatus;
  /** Decimal string — a SHARE, not an amount. */
  revenueSharePercent: string;
  memberCount: number;
  createdAt: string;
}

/** Everything a partner's own dashboard can truthfully show today. */
export interface PartnerDashboard {
  partner: PartnerView;
  /**
   * Figures the platform CANNOT produce, each naming the missing dependency.
   * Rendered as "not available" — never as 0.
   */
  unavailable: { metric: string; reason: string }[];
}

const BLOCKED_FINANCIALS = [
  {
    metric: 'netProfit',
    reason:
      'NOT AVAILABLE — BUSINESS DEFINITION MISSING: the platform has no agreed definition of revenue ' +
      'and no expense model, so "daily revenue − daily expenses" has no computable source. This is a ' +
      'client decision, not a missing integration.',
  },
  {
    metric: 'partnerProfit',
    reason:
      'NOT AVAILABLE: blocked by netProfit. A share percentage without a defined profit figure ' +
      'cannot produce an amount.',
  },
  {
    metric: 'availableBalance',
    reason:
      'NOT AVAILABLE: no partner balance exists, because no profit has been defined or distributed. ' +
      'Reporting 0 would imply a balance was calculated and found empty.',
  },
  {
    metric: 'withdrawals',
    reason:
      'NOT AVAILABLE: a partner withdrawal requires a partner balance, which is blocked above.',
  },
];

/** Audit fields a partner must never be shown: they identify other accounts. */
const IDENTITY_KEYS = new Set(['actorUserId', 'memberUserId', 'addedUserId', 'userId']);

@Injectable()
export class PartnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly notifications: NotificationEventsService,
  ) {}

  /** Every member of a partner, for notifying the organisation of a change that affects them. */
  private async memberUserIds(partnerId: string): Promise<string[]> {
    const rows = await this.prisma.partnerUser.findMany({ where: { partnerId }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  private code(): string {
    return `PTR-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  private view(p: {
    id: string; code: string; name: string; status: PartnerStatus;
    revenueSharePercent: Prisma.Decimal; createdAt: Date;
    _count?: { users: number };
  }): PartnerView {
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      revenueSharePercent: p.revenueSharePercent.toString(),
      memberCount: p._count?.users ?? 0,
      createdAt: p.createdAt.toISOString(),
    };
  }

  /* ----------------------------------------------------------- partner self */

  /**
   * Resolve the partner the CALLER belongs to.
   *
   * The only input is the authenticated user id. No route accepts a partner id from a partner, so
   * one partner cannot address another — isolation is structural, not a check.
   */
  async myPartner(userId: string): Promise<PartnerView> {
    const membership = await this.prisma.partnerUser.findUnique({
      where: { userId },
      include: { partner: { include: { _count: { select: { users: true } } } } },
    });
    if (!membership || membership.partner.deletedAt) {
      throw new ForbiddenException('This account is not linked to a partner.');
    }
    return this.view(membership.partner);
  }

  /** The partner's own dashboard: real identity data plus honest gaps. */
  async myDashboard(userId: string): Promise<PartnerDashboard> {
    return { partner: await this.myPartner(userId), unavailable: BLOCKED_FINANCIALS };
  }

  /**
   * The partner's own activity report (PA-07).
   *
   * WHAT IT IS: every recorded change to the caller's OWN partner record — creation, ownership-share
   * changes, status changes, member additions — read from the existing `audit_trails` store. It is
   * real recorded history, not a derived or reconstructed narrative.
   *
   * WHAT IT DELIBERATELY IS NOT: a financial report. Partner revenue, profit, balance and payouts
   * remain blocked on the missing revenue definition (F-02), so this report contains no monetary
   * column at all and repeats the blocked reasons rather than presenting an empty money table.
   *
   * ISOLATION, BY CONSTRUCTION: the partner id comes from `myPartner(userId)` — the authenticated
   * caller's own membership — and is placed INSIDE the where clause. No route accepts a partner id
   * from a partner, so one partner cannot request another's history.
   *
   * ACTOR IDENTITY IS WITHHELD ON PURPOSE: an audit row names the operator who made the change.
   * A partner is not an operator and has no business learning which staff account acted, so the
   * report states that a change was made by the operator, without the account behind it.
   */
  async myActivityReport(
    userId: string,
    query: { from?: string; to?: string; limit?: number } = {},
  ): Promise<{
    partner: PartnerView;
    from: string;
    to: string;
    events: { at: string; action: string; changed: string[]; summary: string }[];
    truncated: boolean;
    unavailable: typeof BLOCKED_FINANCIALS;
  }> {
    const partner = await this.myPartner(userId);

    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 90 * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('from and to must be valid dates.');
    }
    if (to <= from) throw new BadRequestException('to must be after from.');
    const limit = Math.min(500, Math.max(1, query.limit ?? 200));

    // One extra row is fetched so truncation can be reported honestly instead of silently.
    const rows = await this.prisma.auditTrail.findMany({
      where: { entityType: 'partner', entityId: partner.id, createdAt: { gte: from, lt: to } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      select: { action: true, changes: true, createdAt: true },
    });
    const truncated = rows.length > limit;

    const events = rows.slice(0, limit).map((r) => {
      const changes = (r.changes ?? {}) as Record<string, unknown>;
      // Identities are stripped: neither the operator who acted nor the user id of a member is
      // the partner's business. The partner learns WHAT changed, not WHO is behind the id.
      const changed = Object.keys(changes).filter((k) => !IDENTITY_KEYS.has(k));
      return {
        at: r.createdAt.toISOString(),
        action: r.action,
        changed,
        summary: this.describeChange(r.action, changes),
      };
    });

    return {
      partner,
      from: from.toISOString(),
      to: to.toISOString(),
      events,
      truncated,
      unavailable: BLOCKED_FINANCIALS,
    };
  }

  /**
   * A one-line description of a recorded change, built ONLY from fields the audit row actually
   * carries. Nothing is inferred: an unrecognised change lists its changed fields rather than
   * inventing a sentence about what happened.
   */
  private describeChange(action: string, changes: Record<string, unknown>): string {
    const field = typeof changes.field === 'string' ? changes.field : null;
    if (field === 'status') return `Status changed from ${String(changes.from)} to ${String(changes.to)}.`;
    if (field === 'revenueSharePercent') {
      return `Ownership share changed from ${String(changes.from)}% to ${String(changes.to)}%.`;
    }
    if (action === 'CREATE') return 'Partner organisation created.';
    if (typeof changes.addedUserId === 'string' || typeof changes.memberUserId === 'string') {
      return 'A member was added to the organisation.';
    }
    const keys = Object.keys(changes).filter((k) => !IDENTITY_KEYS.has(k));
    return keys.length > 0 ? `Updated: ${keys.join(', ')}.` : 'Recorded change.';
  }

  /**
   * The caller's own colleagues (PA-07).
   *
   * A partner may see who else belongs to THEIR organisation — the partner id is resolved from the
   * authenticated caller, so this cannot reach another organisation. User ids are deliberately NOT
   * returned: a partner needs to know who their colleagues are, not to be handed an identifier they
   * could use against another surface.
   */
  async myMembers(userId: string): Promise<{ username: string; isPrimary: boolean; joinedAt: string }[]> {
    const partner = await this.myPartner(userId);
    const rows = await this.prisma.partnerUser.findMany({
      where: { partnerId: partner.id },
      orderBy: { createdAt: 'asc' },
      select: { isPrimary: true, createdAt: true, user: { select: { username: true } } },
    });
    return rows.map((r) => ({
      username: r.user.username,
      isPrimary: r.isPrimary,
      joinedAt: r.createdAt.toISOString(),
    }));
  }

  /* ---------------------------------------------------------------- operator */

  async list(query: { status?: PartnerStatus; page?: number; limit?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const where: Prisma.PartnerWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total, allocated] = await Promise.all([
      this.prisma.partner.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
        include: { _count: { select: { users: true } } },
      }),
      this.prisma.partner.count({ where }),
      this.allocatedShare(),
    ]);

    return {
      items: rows.map((r) => this.view(r)),
      total, page, limit,
      /** Share allocated across ACTIVE partners, and what is left. Never implied to be zero. */
      allocation: {
        allocatedPercent: allocated.toString(),
        unallocatedPercent: MAX_TOTAL_SHARE.minus(allocated).toString(),
        note:
          'The sum across ACTIVE partners may not exceed 100. It is NOT required to equal 100 — ' +
          'requiring that would assume the house retains nothing, which no requirement states.',
      },
    };
  }

  async getById(id: string): Promise<PartnerView> {
    const p = await this.prisma.partner.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { users: true } } },
    });
    if (!p) throw new NotFoundException('Partner not found.');
    return this.view(p);
  }

  /** Total share currently allocated to ACTIVE partners. */
  private async allocatedShare(tx?: Prisma.TransactionClient, excludePartnerId?: string): Promise<Prisma.Decimal> {
    const client = tx ?? this.prisma;
    const agg = await client.partner.aggregate({
      where: {
        deletedAt: null,
        status: PartnerStatus.ACTIVE,
        ...(excludePartnerId ? { id: { not: excludePartnerId } } : {}),
      },
      _sum: { revenueSharePercent: true },
    });
    return agg._sum.revenueSharePercent ?? new Prisma.Decimal(0);
  }

  async create(input: { name: string; revenueSharePercent?: string; notes?: string; actorUserId: string }): Promise<PartnerView> {
    const share = new Prisma.Decimal(input.revenueSharePercent ?? '0');
    this.assertShareRange(share);

    // A partner is created PENDING, and only ACTIVE partners consume allocation, so creation does
    // NOT enforce the Σ ≤ 100 invariant. Enforcing it here would be inconsistent with
    // `allocatedShare()` (which counts ACTIVE only) and would stop an operator from staging a
    // partner before rebalancing the existing ones. The invariant is enforced where it actually
    // binds: on ACTIVATION and on a share change to an ACTIVE partner.
    const created = await this.prisma.partner.create({
      data: {
        code: this.code(),
        name: input.name.trim(),
        revenueSharePercent: share,
        notes: input.notes?.trim() ?? null,
        status: PartnerStatus.PENDING,
      },
      include: { _count: { select: { users: true } } },
    });

    await this.audit.record({
      userId: input.actorUserId,
      action: 'CREATE',
      entityType: 'partner',
      entityId: created.id,
      changes: { code: created.code, name: created.name, revenueSharePercent: share.toString() },
    });

    return this.view(created);
  }

  private assertShareRange(share: Prisma.Decimal): void {
    if (!share.isFinite() || share.isNegative() || share.greaterThan(MAX_TOTAL_SHARE)) {
      throw new BadRequestException('Revenue share must be between 0 and 100.');
    }
  }

  /**
   * Change a partner's ownership percentage.
   *
   * The Σ ≤ 100 invariant is re-checked INSIDE the transaction, excluding this partner's own current
   * value, so two concurrent updates cannot combine to push the total over 100.
   */
  async setShare(id: string, percent: string, actorUserId: string): Promise<PartnerView> {
    const share = new Prisma.Decimal(percent);
    this.assertShareRange(share);

    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await tx.partner.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new NotFoundException('Partner not found.');

      // Only ACTIVE partners consume allocation, so the check applies when this one is (or becomes) active.
      if (before.status === PartnerStatus.ACTIVE) {
        const others = await this.allocatedShare(tx, id);
        if (others.plus(share).greaterThan(MAX_TOTAL_SHARE)) {
          throw new BadRequestException(
            `Total revenue share would become ${others.plus(share).toString()}%, above 100%. ` +
              `Other active partners hold ${others.toString()}%.`,
          );
        }
      }

      const row = await tx.partner.update({
        where: { id },
        data: { revenueSharePercent: share },
        include: { _count: { select: { users: true } } },
      });
      return { row, from: before.revenueSharePercent.toString() };
    });

    await this.audit.record({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'partner',
      entityId: id,
      changes: { field: 'revenueSharePercent', from: updated.from, to: share.toString() },
    });

    // Notify every member that their share changed. Deduplicated by (partner, new value).
    for (const memberId of await this.memberUserIds(id)) {
      await this.notifications.partnerShareChanged({
        userId: memberId, partnerId: id, partnerName: updated.row.name, percent: share.toString(),
      });
    }

    return this.view(updated.row);
  }

  /** Change lifecycle status. Activating re-checks the allocation invariant. */
  async setStatus(id: string, status: PartnerStatus, actorUserId: string): Promise<PartnerView> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await tx.partner.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new NotFoundException('Partner not found.');
      if (before.status === status) return { row: null, from: before.status };

      if (status === PartnerStatus.ACTIVE) {
        const others = await this.allocatedShare(tx, id);
        if (others.plus(before.revenueSharePercent).greaterThan(MAX_TOTAL_SHARE)) {
          throw new BadRequestException(
            `Activating this partner would take the total revenue share to ` +
              `${others.plus(before.revenueSharePercent).toString()}%, above 100%.`,
          );
        }
      }

      const row = await tx.partner.update({
        where: { id },
        data: { status },
        include: { _count: { select: { users: true } } },
      });
      return { row, from: before.status };
    });

    if (!updated.row) return this.getById(id);

    await this.audit.record({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'partner',
      entityId: id,
      changes: { field: 'status', from: updated.from, to: status },
    });

    for (const memberId of await this.memberUserIds(id)) {
      await this.notifications.partnerStatusChanged({
        userId: memberId, partnerId: id, partnerName: updated.row.name, status,
      });
    }

    return this.view(updated.row);
  }

  /**
   * Link an existing platform user to a partner and grant them the `partner` role.
   *
   * Reuses the EXISTING identity system — no second auth. The role grant goes through
   * `RbacService.invalidate` so the user's cached authorization is refreshed immediately.
   */
  async addMember(partnerId: string, userId: string, actorUserId: string, isPrimary = false): Promise<PartnerView> {
    const partner = await this.prisma.partner.findFirst({ where: { id: partnerId, deletedAt: null } });
    if (!partner) throw new NotFoundException('Partner not found.');

    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } });
    if (!user) throw new NotFoundException('User not found.');

    const existing = await this.prisma.partnerUser.findUnique({ where: { userId } });
    if (existing) {
      throw new BadRequestException(
        existing.partnerId === partnerId
          ? 'This user already belongs to this partner.'
          : 'This user already belongs to another partner.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.partnerUser.create({ data: { partnerId, userId, isPrimary } });
      const role = await tx.role.findUnique({ where: { slug: ROLE_SLUGS.PARTNER }, select: { id: true } });
      if (role) {
        await tx.userRole.createMany({
          data: [{ userId, roleId: role.id }],
          skipDuplicates: true,
        });
      }
    });

    // The permission cache is keyed per user and must be dropped, or the new role is invisible for
    // up to its TTL. (This is exactly the trap that produced a false 403 in Phase 2D.3 testing.)
    await this.rbac.invalidate(userId);

    await this.audit.record({
      userId: actorUserId,
      action: 'UPDATE',
      entityType: 'partner',
      entityId: partnerId,
      changes: { event: 'member_added', memberUserId: userId, isPrimary },
    });

    await this.notifications.partnerMemberAdded({
      userId, partnerId, partnerName: partner.name,
    });

    return this.getById(partnerId);
  }

  /** Members of one partner. Operator-facing; returns ids, never credentials. */
  async members(partnerId: string) {
    const partner = await this.prisma.partner.findFirst({ where: { id: partnerId, deletedAt: null }, select: { id: true } });
    if (!partner) throw new NotFoundException('Partner not found.');

    const rows = await this.prisma.partnerUser.findMany({
      where: { partnerId },
      orderBy: { createdAt: 'asc' },
      select: {
        userId: true, isPrimary: true, createdAt: true,
        user: { select: { username: true, status: true } },
      },
    });
    return rows.map((r) => ({
      userId: r.userId,
      username: r.user.username,
      status: r.user.status,
      isPrimary: r.isPrimary,
      joinedAt: r.createdAt.toISOString(),
    }));
  }
}
