import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReferralStatus } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../security/audit.service';

/**
 * Referral attribution (P-17).
 *
 * SCOPE, split honestly:
 *   IMPLEMENTED — referral code, the referrer↔referred relationship, attribution, duplicate and
 *   self-referral prevention, ownership isolation, player and admin visibility.
 *
 *   **BLOCKED — qualification and reward.** The requirement says "qualifying deposit", but no
 *   threshold amount, currency or window is defined anywhere, and no reward amount is defined.
 *   Crediting a wallet on an undefined trigger for an undefined amount would fabricate money, so
 *   this service **never credits anything** and every relationship stays `PENDING`.
 *
 * NO SCHEMA CHANGE. `User.referralCode` is already unique and generated at signup, and
 * `ReferralHistory.referredId` is already **UNIQUE** — which is what makes a second attribution for
 * the same player impossible at the database level rather than by a check that could be raced.
 */

export interface ReferralView {
  id: string;
  referredUsername: string;
  status: ReferralStatus;
  createdAt: string;
  qualifiedAt: string | null;
  rewardedAt: string | null;
}

export interface MyReferralSummary {
  /** The caller's own code. Generated at signup; never taken from the client. */
  code: string | null;
  /** Total relationships where the caller is the referrer. */
  totalReferred: number;
  referrals: ReferralView[];
  /** Who referred the caller, if anyone. */
  referredBy: { username: string; since: string } | null;
  /** What this platform cannot yet do, with the reason. Never rendered as a zero reward. */
  unavailable: { metric: string; reason: string }[];
}

const BLOCKED_REWARDS = [
  {
    metric: 'referralQualification',
    reason:
      'NOT AVAILABLE — BUSINESS DEFINITION MISSING: the requirement refers to a "qualifying deposit", ' +
      'but no threshold amount, currency or qualifying window is defined. Relationships are recorded ' +
      'and stay PENDING rather than being marked qualified on an invented rule.',
  },
  {
    metric: 'referralReward',
    reason:
      'NOT AVAILABLE — BUSINESS DEFINITION MISSING: no reward amount or currency is defined. No wallet ' +
      'is credited, and no earnings figure is shown — a 0 would imply a reward was calculated.',
  },
];

@Injectable()
export class ReferralService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------------ player */

  /** The caller's own referral picture. Never takes a user id from the client. */
  async mySummary(userId: string): Promise<MyReferralSummary> {
    const [me, referrals, inbound] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { referralCode: true } }),
      this.prisma.referralHistory.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { referred: { select: { username: true } } },
      }),
      this.prisma.referralHistory.findUnique({
        where: { referredId: userId },
        include: { referrer: { select: { username: true } } },
      }),
    ]);
    if (!me) throw new NotFoundException('User not found.');

    return {
      code: me.referralCode,
      totalReferred: referrals.length,
      referrals: referrals.map((r) => ({
        id: r.id,
        referredUsername: r.referred.username,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        qualifiedAt: r.qualifiedAt?.toISOString() ?? null,
        rewardedAt: r.rewardedAt?.toISOString() ?? null,
      })),
      referredBy: inbound
        ? { username: inbound.referrer.username, since: inbound.createdAt.toISOString() }
        : null,
      unavailable: BLOCKED_REWARDS,
    };
  }

  /**
   * Claim a referral code — establishes "this caller was referred by the owner of that code".
   *
   * Idempotent and safe under concurrency: `referredId` is UNIQUE, so a second attempt (or two
   * concurrent attempts) can only ever leave ONE relationship. A repeat of the SAME code returns
   * the existing relationship rather than erroring, which is the correct idempotent outcome.
   */
  async claim(userId: string, code: string): Promise<{ referredBy: string; status: ReferralStatus; alreadyClaimed: boolean }> {
    const normalised = code.trim().toUpperCase();
    if (!normalised) throw new BadRequestException('A referral code is required.');

    const referrer = await this.prisma.user.findFirst({
      where: { referralCode: normalised, deletedAt: null },
      select: { id: true, username: true },
    });
    // Deliberately the same error for "no such code" and "code belongs to a deleted user": the API
    // must not become an oracle for which codes exist.
    if (!referrer) throw new BadRequestException('That referral code is not valid.');

    if (referrer.id === userId) {
      throw new BadRequestException('You cannot refer yourself.');
    }

    const existing = await this.prisma.referralHistory.findUnique({
      where: { referredId: userId },
      include: { referrer: { select: { username: true } } },
    });
    if (existing) {
      if (existing.referrerId === referrer.id) {
        // Same code again — idempotent success, not an error.
        return { referredBy: existing.referrer.username, status: existing.status, alreadyClaimed: true };
      }
      throw new BadRequestException('Your account has already been referred by someone else.');
    }

    try {
      await this.prisma.referralHistory.create({
        data: {
          referrerId: referrer.id,
          referredId: userId,
          // Always PENDING. Qualification requires an undefined business rule, so nothing here
          // advances the status.
          status: ReferralStatus.PENDING,
        },
      });
    } catch (error) {
      // A concurrent claim won the race. Return its result rather than failing the caller.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const won = await this.prisma.referralHistory.findUnique({
          where: { referredId: userId },
          include: { referrer: { select: { username: true } } },
        });
        if (won) {
          return { referredBy: won.referrer.username, status: won.status, alreadyClaimed: true };
        }
      }
      throw error;
    }

    await this.audit.record({
      userId,
      action: 'CREATE',
      entityType: 'referral',
      entityId: userId,
      changes: { referrerId: referrer.id, referredId: userId, status: ReferralStatus.PENDING },
    });

    return { referredBy: referrer.username, status: ReferralStatus.PENDING, alreadyClaimed: false };
  }

  /* ------------------------------------------------------------------- admin */

  async list(query: { status?: ReferralStatus; page?: number; limit?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const where: Prisma.ReferralHistoryWhereInput = query.status ? { status: query.status } : {};

    const [rows, total] = await Promise.all([
      this.prisma.referralHistory.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
        include: {
          referrer: { select: { id: true, username: true } },
          referred: { select: { id: true, username: true } },
        },
      }),
      this.prisma.referralHistory.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        referrer: { userId: r.referrer.id, username: r.referrer.username },
        referred: { userId: r.referred.id, username: r.referred.username },
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      total, page, limit,
      unavailable: BLOCKED_REWARDS,
    };
  }
}
