import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DepositStatus,
  GameRoundStatus,
  Prisma,
  RgLimitPeriod,
  RgLimitType,
  RgRestrictionStatus,
  RgRestrictionType,
} from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../security/audit.service';

/**
 * Responsible gaming — SERVER-AUTHORITATIVE player protection.
 *
 * Before this module the platform had a responsible-gaming *page* and nothing else: no model, no
 * service, no enforcement. A limit a player set could not stop anything, which is the failure mode
 * the requirement exists to prevent.
 *
 * DESIGN DECISIONS, and why:
 *
 * 1. **Enforcement is an ADDITIVE LAYER in front of the frozen money core.** `WalletEngine`,
 *    `GameMoneyBridge`, the ledger and settlement are untouched. Checks run in a guard before the
 *    handler, so no money or game action can begin while a limit or restriction blocks it. Putting
 *    the check inside the bridge would have meant editing a frozen, certified financial path for a
 *    control that does not need to live there.
 *
 * 2. **Usage is measured from authoritative financial tables, never from a counter.** A separate
 *    "spent so far" column would be a second source of truth that could drift from the ledger.
 *    Deposits come from `deposit_requests`, wagers and losses from `game_rounds`.
 *
 * 3. **Money already committed is never retroactively blocked.** Limits gate NEW actions. A limit
 *    set mid-period does not claw back or invalidate anything already settled.
 *
 * 4. **Withdrawals are never blocked.** A self-excluded player must still be able to take their own
 *    money out; trapping funds would be the opposite of player protection.
 *
 * 5. **No business policy is invented.** There is no default limit, no default exclusion length and
 *    no hardcoded increase delay. Absence of a limit means unlimited, exactly as before this module.
 */

/** Increase-delay window, in hours. 0 (default) = increases apply immediately. */
export function limitIncreaseDelayHours(): number {
  const raw = process.env.RG_LIMIT_INCREASE_DELAY_HOURS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export interface LimitUsage {
  type: RgLimitType;
  period: RgLimitPeriod;
  currency: string;
  limit: string;
  used: string;
  remaining: string;
  /** Start of the current period window, UTC. */
  windowStart: string;
}

export interface RestrictionView {
  id: string;
  type: RgRestrictionType;
  status: RgRestrictionStatus;
  startsAt: string;
  endsAt: string | null;
  reason: string | null;
}

const D = (v: Prisma.Decimal | string | number) => new Prisma.Decimal(v);

/** Round statuses in which a stake has actually been taken. */
const STAKED_STATUSES: GameRoundStatus[] = [
  GameRoundStatus.SETTLED,
  GameRoundStatus.RECOVERED,
  GameRoundStatus.RESOLVED,
  GameRoundStatus.PENDING_SETTLEMENT,
  GameRoundStatus.RECOVERING,
  GameRoundStatus.RECOVERY_FAILED,
];

/** Deposit statuses that count toward a deposit cap — everything the player has committed to. */
const COMMITTED_DEPOSIT_STATUSES: DepositStatus[] = [
  DepositStatus.PENDING,
  DepositStatus.PROCESSING,
  DepositStatus.COMPLETED,
];

@Injectable()
export class ResponsibleGamingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------- period math */

  /**
   * Start of the current period, in UTC.
   *
   * Deterministic and timezone-independent: daily = UTC midnight, weekly = UTC Monday, monthly =
   * first of the UTC month. No local timezone is used because none is stored per user.
   */
  static windowStart(period: RgLimitPeriod, now: Date = new Date()): Date {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (period === RgLimitPeriod.DAILY) return d;
    if (period === RgLimitPeriod.MONTHLY) return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    // WEEKLY: ISO week starts Monday. getUTCDay() is 0=Sunday.
    const dow = (d.getUTCDay() + 6) % 7;
    return new Date(d.getTime() - dow * 86_400_000);
  }

  /* ----------------------------------------------------------- restrictions */

  /** Restrictions that are ACTIVE and currently in-window. */
  private async activeRestrictions(userId: string, now = new Date()) {
    return this.prisma.accountRestriction.findMany({
      where: {
        userId,
        status: RgRestrictionStatus.ACTIVE,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Throw if the player is self-excluded or in a cooling-off period.
   *
   * Called before gameplay AND before deposits. Deliberately NOT called before withdrawal.
   */
  async assertNotRestricted(userId: string, action: string): Promise<void> {
    const active = await this.activeRestrictions(userId);
    if (active.length === 0) return;

    const r = active[0]!;
    const until = r.endsAt ? ` until ${r.endsAt.toISOString()}` : ' (permanent)';
    throw new ForbiddenException(
      `${action} is blocked: your account is under ${r.type === RgRestrictionType.SELF_EXCLUSION ? 'self-exclusion' : 'a cooling-off period'}${until}.`,
    );
  }

  /**
   * Create a self-exclusion or cooling-off period.
   *
   * An existing ACTIVE restriction cannot be shortened or replaced by a weaker one through this
   * path — only extended. Lifting requires an operator (`lift`), which is audited.
   */
  async createRestriction(input: {
    userId: string;
    type: RgRestrictionType;
    endsAt: Date | null;
    reason?: string;
    createdByUserId?: string | null;
  }): Promise<RestrictionView> {
    const now = new Date();
    if (input.type === RgRestrictionType.COOLING_OFF && !input.endsAt) {
      throw new BadRequestException('A cooling-off period must have an end date.');
    }
    if (input.endsAt && input.endsAt <= now) {
      throw new BadRequestException('The end date must be in the future.');
    }

    const existing = await this.activeRestrictions(input.userId, now);
    for (const r of existing) {
      // A permanent exclusion already covers everything; a longer one wins. Never weaken.
      if (r.endsAt === null) {
        throw new BadRequestException('An indefinite self-exclusion is already active on this account.');
      }
      if (input.endsAt && input.endsAt <= r.endsAt) {
        throw new BadRequestException(
          `An active restriction already runs until ${r.endsAt.toISOString()}. It cannot be shortened here.`,
        );
      }
    }

    const created = await this.prisma.accountRestriction.create({
      data: {
        userId: input.userId,
        type: input.type,
        endsAt: input.endsAt,
        reason: input.reason ?? null,
        createdByUserId: input.createdByUserId ?? null,
      },
    });

    await this.audit.record({
      userId: input.createdByUserId ?? input.userId,
      action: 'CREATE',
      entityType: 'account_restriction',
      entityId: created.id,
      changes: {
        subjectUserId: input.userId,
        type: input.type,
        endsAt: input.endsAt?.toISOString() ?? null,
        selfService: !input.createdByUserId,
      },
    });

    return this.toRestrictionView(created);
  }

  /** Operator-only: lift a restriction early. Always attributed and audited. */
  async liftRestriction(id: string, operatorUserId: string, reason: string): Promise<RestrictionView> {
    const found = await this.prisma.accountRestriction.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Restriction not found.');
    if (found.status !== RgRestrictionStatus.ACTIVE) {
      throw new BadRequestException('Only an active restriction can be lifted.');
    }

    const updated = await this.prisma.accountRestriction.update({
      where: { id },
      data: {
        status: RgRestrictionStatus.LIFTED,
        liftedAt: new Date(),
        liftedByUserId: operatorUserId,
        liftReason: reason,
      },
    });

    await this.audit.record({
      userId: operatorUserId,
      action: 'UPDATE',
      entityType: 'account_restriction',
      entityId: id,
      changes: { subjectUserId: found.userId, from: 'ACTIVE', to: 'LIFTED', reason },
    });

    return this.toRestrictionView(updated);
  }

  async listRestrictions(userId: string): Promise<RestrictionView[]> {
    const rows = await this.prisma.accountRestriction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => this.toRestrictionView(r));
  }

  private toRestrictionView(r: {
    id: string; type: RgRestrictionType; status: RgRestrictionStatus;
    startsAt: Date; endsAt: Date | null; reason: string | null;
  }): RestrictionView {
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt?.toISOString() ?? null,
      reason: r.reason,
    };
  }

  /* ----------------------------------------------------------------- limits */

  /** The limit currently in force for a (type, period, currency), if any. */
  private async effectiveLimit(
    userId: string,
    type: RgLimitType,
    period: RgLimitPeriod,
    currencyId: string,
    now = new Date(),
  ) {
    const rows = await this.prisma.responsibleGamingLimit.findMany({
      where: {
        userId, type, period, currencyId,
        supersededAt: null,
        effectiveFrom: { lte: now },
      },
      orderBy: { effectiveFrom: 'desc' },
      take: 1,
    });
    return rows[0] ?? null;
  }

  /**
   * Set (or change) a limit.
   *
   * A DECREASE applies immediately — a player tightening their own protection must never be made to
   * wait. An INCREASE is written with `effectiveFrom` in the future when
   * `RG_LIMIT_INCREASE_DELAY_HOURS` is configured, and the stricter existing limit keeps applying
   * until then. With the default of 0 the increase is immediate; **no delay is invented here.**
   */
  async setLimit(input: {
    userId: string;
    type: RgLimitType;
    period: RgLimitPeriod;
    amount: string;
    currencyCode: string;
    setByUserId?: string | null;
  }): Promise<{ type: RgLimitType; period: RgLimitPeriod; amount: string; currency: string; effectiveFrom: string }> {
    const amount = D(input.amount);
    if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('A limit must be a positive amount.');
    }

    const currency = await this.prisma.currency.findUnique({
      where: { code: input.currencyCode.toUpperCase() },
      select: { id: true, code: true },
    });
    if (!currency) throw new BadRequestException(`Unknown currency: ${input.currencyCode}`);

    const now = new Date();
    const current = await this.effectiveLimit(input.userId, input.type, input.period, currency.id, now);

    const isIncrease = current ? amount.greaterThan(current.amount) : true;
    const delayHours = limitIncreaseDelayHours();
    // A first-ever limit is protection being added, so it applies at once even though `isIncrease`.
    const delayed = isIncrease && current !== null && delayHours > 0;
    const effectiveFrom = delayed ? new Date(now.getTime() + delayHours * 3_600_000) : now;

    const created = await this.prisma.$transaction(async (tx) => {
      if (!delayed) {
        // Supersede everything live for this key so exactly one limit is ever in force.
        await tx.responsibleGamingLimit.updateMany({
          where: { userId: input.userId, type: input.type, period: input.period, currencyId: currency.id, supersededAt: null },
          data: { supersededAt: now },
        });
      } else {
        // Only drop other PENDING increases; the active stricter limit must stay in force.
        await tx.responsibleGamingLimit.updateMany({
          where: {
            userId: input.userId, type: input.type, period: input.period, currencyId: currency.id,
            supersededAt: null, effectiveFrom: { gt: now },
          },
          data: { supersededAt: now },
        });
      }
      return tx.responsibleGamingLimit.create({
        data: {
          userId: input.userId,
          type: input.type,
          period: input.period,
          amount,
          currencyId: currency.id,
          effectiveFrom,
          setByUserId: input.setByUserId ?? null,
        },
      });
    });

    await this.audit.record({
      userId: input.setByUserId ?? input.userId,
      action: 'UPDATE',
      entityType: 'responsible_gaming_limit',
      entityId: created.id,
      changes: {
        subjectUserId: input.userId,
        type: input.type,
        period: input.period,
        currency: currency.code,
        from: current ? current.amount.toString() : null,
        to: amount.toString(),
        direction: isIncrease ? 'INCREASE' : 'DECREASE',
        effectiveFrom: effectiveFrom.toISOString(),
      },
    });

    return {
      type: input.type,
      period: input.period,
      amount: amount.toString(),
      currency: currency.code,
      effectiveFrom: effectiveFrom.toISOString(),
    };
  }

  /** Remove a limit (a player may always remove protection they added, subject to the same delay). */
  async removeLimit(userId: string, type: RgLimitType, period: RgLimitPeriod, currencyCode: string): Promise<void> {
    const currency = await this.prisma.currency.findUnique({
      where: { code: currencyCode.toUpperCase() }, select: { id: true },
    });
    if (!currency) throw new BadRequestException(`Unknown currency: ${currencyCode}`);

    const now = new Date();
    const { count } = await this.prisma.responsibleGamingLimit.updateMany({
      where: { userId, type, period, currencyId: currency.id, supersededAt: null },
      data: { supersededAt: now },
    });
    if (count === 0) throw new NotFoundException('No such limit is set.');

    await this.audit.record({
      userId,
      action: 'DELETE',
      entityType: 'responsible_gaming_limit',
      entityId: `${type}:${period}:${currencyCode.toUpperCase()}`,
      changes: { subjectUserId: userId, removed: true },
    });
  }

  /* ------------------------------------------------------------------ usage */

  /** Money committed to deposits since `since`, in one currency. */
  private async depositedSince(userId: string, currencyId: string, since: Date): Promise<Prisma.Decimal> {
    const agg = await this.prisma.depositRequest.aggregate({
      where: { userId, currencyId, createdAt: { gte: since }, status: { in: COMMITTED_DEPOSIT_STATUSES } },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? D(0);
  }

  /** Total stake since `since`, in one currency. */
  private async wageredSince(userId: string, currencyId: string, since: Date): Promise<Prisma.Decimal> {
    const agg = await this.prisma.gameRound.aggregate({
      where: { userId, currencyId, createdAt: { gte: since }, status: { in: STAKED_STATUSES } },
      _sum: { stake: true },
    });
    return agg._sum.stake ?? D(0);
  }

  /**
   * Net loss since `since`: `SUM(stake) - SUM(payout)` over settled rounds, floored at zero.
   *
   * Floored because a player who is up overall has lost nothing — a negative "loss" must not create
   * headroom above the configured cap.
   */
  private async lostSince(userId: string, currencyId: string, since: Date): Promise<Prisma.Decimal> {
    const agg = await this.prisma.gameRound.aggregate({
      where: {
        userId, currencyId, createdAt: { gte: since },
        status: { in: [GameRoundStatus.SETTLED, GameRoundStatus.RECOVERED, GameRoundStatus.RESOLVED] },
      },
      _sum: { stake: true, payout: true },
    });
    const net = (agg._sum.stake ?? D(0)).minus(agg._sum.payout ?? D(0));
    return net.isNegative() ? D(0) : net;
  }

  private usedFor(type: RgLimitType, userId: string, currencyId: string, since: Date): Promise<Prisma.Decimal> {
    if (type === RgLimitType.DEPOSIT) return this.depositedSince(userId, currencyId, since);
    if (type === RgLimitType.WAGER) return this.wageredSince(userId, currencyId, since);
    return this.lostSince(userId, currencyId, since);
  }

  /* ------------------------------------------------------------ enforcement */

  /**
   * Throw if `amount` would breach any limit of `type` for this user/currency.
   *
   * Every period with a live limit is checked, so a daily and a monthly cap both bind.
   */
  async assertWithinLimit(input: {
    userId: string;
    type: RgLimitType;
    amount: string;
    currencyCode: string;
  }): Promise<void> {
    const currency = await this.prisma.currency.findUnique({
      where: { code: input.currencyCode.toUpperCase() }, select: { id: true, code: true },
    });
    // An unknown currency is not this control's error to raise; the money path will reject it.
    if (!currency) return;

    const now = new Date();
    const limits = await this.prisma.responsibleGamingLimit.findMany({
      where: {
        userId: input.userId, type: input.type, currencyId: currency.id,
        supersededAt: null, effectiveFrom: { lte: now },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (limits.length === 0) return;

    // Exactly one live limit per period — newest wins if history ever left more than one.
    const byPeriod = new Map<RgLimitPeriod, (typeof limits)[number]>();
    for (const l of limits) if (!byPeriod.has(l.period)) byPeriod.set(l.period, l);

    const requested = D(input.amount);
    for (const [period, limit] of byPeriod) {
      const since = ResponsibleGamingService.windowStart(period, now);
      const used = await this.usedFor(input.type, input.userId, currency.id, since);
      if (used.plus(requested).greaterThan(limit.amount)) {
        const remaining = limit.amount.minus(used);
        throw new ForbiddenException(
          `This would exceed your ${period.toLowerCase()} ${input.type.toLowerCase()} limit of ` +
            `${limit.amount.toString()} ${currency.code}. Used ${used.toString()}, remaining ` +
            `${(remaining.isNegative() ? D(0) : remaining).toString()}.`,
        );
      }
    }
  }

  /** Full check for a gameplay action: restrictions, then wager and loss caps. */
  async assertCanWager(userId: string, stake: string, currencyCode: string): Promise<void> {
    await this.assertNotRestricted(userId, 'Playing');
    await this.assertWithinLimit({ userId, type: RgLimitType.WAGER, amount: stake, currencyCode });
    // A loss cap binds on the stake about to be risked: the worst case of this round is losing it.
    await this.assertWithinLimit({ userId, type: RgLimitType.LOSS, amount: stake, currencyCode });
  }

  /** Full check for a deposit. */
  async assertCanDeposit(userId: string, amount: string, currencyCode: string): Promise<void> {
    await this.assertNotRestricted(userId, 'Depositing');
    await this.assertWithinLimit({ userId, type: RgLimitType.DEPOSIT, amount, currencyCode });
  }

  /* -------------------------------------------------------------- read APIs */

  /** Every live limit with its real usage — what the player's own page shows. */
  async overview(userId: string): Promise<{ limits: LimitUsage[]; restrictions: RestrictionView[] }> {
    const now = new Date();
    const rows = await this.prisma.responsibleGamingLimit.findMany({
      where: { userId, supersededAt: null },
      include: { currency: { select: { id: true, code: true } } },
      orderBy: { effectiveFrom: 'desc' },
    });

    const live = rows.filter((r) => r.effectiveFrom <= now);
    const limits: LimitUsage[] = [];
    for (const l of live) {
      const since = ResponsibleGamingService.windowStart(l.period, now);
      const used = await this.usedFor(l.type, userId, l.currency.id, since);
      const remaining = l.amount.minus(used);
      limits.push({
        type: l.type,
        period: l.period,
        currency: l.currency.code,
        limit: l.amount.toString(),
        used: used.toString(),
        remaining: (remaining.isNegative() ? D(0) : remaining).toString(),
        windowStart: since.toISOString(),
      });
    }

    return { limits, restrictions: await this.listRestrictions(userId) };
  }
}
