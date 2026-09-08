import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PromotionStatus, PromotionType } from '@prisma/client';

import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../security/audit.service';

/**
 * Promotions administration (AD-08).
 *
 * SCOPE, split honestly:
 *   IMPLEMENTED — promotion **definition and configuration**: create, edit, status lifecycle,
 *   scheduling, redemption cap, audience/terms, listing, and a player-visible list of what is
 *   genuinely ACTIVE right now.
 *
 *   **BLOCKED — awarding.** No client rule defines what a promotion pays, to whom, on what trigger,
 *   or how it is accounted for. This service therefore **credits nothing** and has no wallet
 *   collaborator at all. A promotion here is a published offer, not money.
 *
 * NO SCHEMA CHANGE — `Promotion` already carries code, name, type, status, priority,
 * maxRedemptions, currentRedemptions, terms, startsAt and endsAt.
 */

/** Status transitions an operator may perform. Anything else is refused. */
const ALLOWED_TRANSITIONS: Record<PromotionStatus, PromotionStatus[]> = {
  [PromotionStatus.DRAFT]: [PromotionStatus.SCHEDULED, PromotionStatus.ACTIVE, PromotionStatus.ENDED],
  [PromotionStatus.SCHEDULED]: [PromotionStatus.ACTIVE, PromotionStatus.PAUSED, PromotionStatus.ENDED],
  [PromotionStatus.ACTIVE]: [PromotionStatus.PAUSED, PromotionStatus.ENDED, PromotionStatus.EXPIRED],
  [PromotionStatus.PAUSED]: [PromotionStatus.ACTIVE, PromotionStatus.ENDED],
  [PromotionStatus.EXPIRED]: [PromotionStatus.ENDED],
  // Terminal.
  [PromotionStatus.ENDED]: [],
};

export interface PromotionView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: PromotionType;
  status: PromotionStatus;
  priority: number;
  maxRedemptions: number | null;
  currentRedemptions: number;
  startsAt: string | null;
  endsAt: string | null;
  terms: unknown;
  createdAt: string;
}

const AWARDING_BLOCKED = {
  metric: 'promotionAward',
  reason:
    'NOT AVAILABLE — BUSINESS DEFINITION MISSING: no rule defines what a promotion pays, on what ' +
    'trigger, to whom, or how it is accounted for. Promotions are published as offers; nothing is ' +
    'credited. A 0 award would imply a calculation was performed.',
};

@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private view(p: {
    id: string; code: string; name: string; description: string | null; type: PromotionType;
    status: PromotionStatus; priority: number; maxRedemptions: number | null;
    currentRedemptions: number; startsAt: Date | null; endsAt: Date | null;
    terms: Prisma.JsonValue; createdAt: Date;
  }): PromotionView {
    return {
      id: p.id, code: p.code, name: p.name, description: p.description, type: p.type,
      status: p.status, priority: p.priority, maxRedemptions: p.maxRedemptions,
      currentRedemptions: p.currentRedemptions,
      startsAt: p.startsAt?.toISOString() ?? null,
      endsAt: p.endsAt?.toISOString() ?? null,
      terms: p.terms,
      createdAt: p.createdAt.toISOString(),
    };
  }

  private parseWindow(startsAt?: string, endsAt?: string): { startsAt: Date | null; endsAt: Date | null } {
    const s = startsAt ? new Date(startsAt) : null;
    const e = endsAt ? new Date(endsAt) : null;
    if (s && Number.isNaN(s.getTime())) throw new BadRequestException('startsAt must be a valid date.');
    if (e && Number.isNaN(e.getTime())) throw new BadRequestException('endsAt must be a valid date.');
    if (s && e && e <= s) throw new BadRequestException('endsAt must be after startsAt.');
    return { startsAt: s, endsAt: e };
  }

  /* ---------------------------------------------------------------- operator */

  async create(input: {
    code: string; name: string; type: PromotionType; description?: string;
    priority?: number; maxRedemptions?: number; startsAt?: string; endsAt?: string;
    terms?: Record<string, unknown>; actorUserId: string;
  }): Promise<PromotionView> {
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
      throw new BadRequestException('Code must be 3–40 characters of A–Z, 0–9, - or _.');
    }
    const dup = await this.prisma.promotion.findUnique({ where: { code } });
    if (dup) throw new BadRequestException(`Promotion code ${code} already exists.`);

    const window = this.parseWindow(input.startsAt, input.endsAt);
    if (input.maxRedemptions !== undefined && input.maxRedemptions < 1) {
      throw new BadRequestException('maxRedemptions must be at least 1 when set.');
    }

    const created = await this.prisma.promotion.create({
      data: {
        code, name: input.name.trim(), description: input.description?.trim() ?? null,
        type: input.type,
        // Always DRAFT. A client cannot publish a promotion in one step.
        status: PromotionStatus.DRAFT,
        priority: input.priority ?? 0,
        maxRedemptions: input.maxRedemptions ?? null,
        startsAt: window.startsAt, endsAt: window.endsAt,
        terms: (input.terms ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    await this.audit.record({
      userId: input.actorUserId, action: 'CREATE', entityType: 'promotion', entityId: created.id,
      changes: { code, name: created.name, type: created.type, status: created.status },
    });
    return this.view(created);
  }

  async update(id: string, input: {
    name?: string; description?: string; priority?: number; maxRedemptions?: number;
    startsAt?: string; endsAt?: string; terms?: Record<string, unknown>; actorUserId: string;
  }): Promise<PromotionView> {
    const before = await this.prisma.promotion.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Promotion not found.');
    if (before.status === PromotionStatus.ENDED) {
      throw new BadRequestException('An ENDED promotion cannot be edited.');
    }

    const window = this.parseWindow(
      input.startsAt ?? before.startsAt?.toISOString(),
      input.endsAt ?? before.endsAt?.toISOString(),
    );
    if (input.maxRedemptions !== undefined) {
      if (input.maxRedemptions < 1) throw new BadRequestException('maxRedemptions must be at least 1.');
      // Lowering the cap below what has already been redeemed would make the record inconsistent.
      if (input.maxRedemptions < before.currentRedemptions) {
        throw new BadRequestException(
          `maxRedemptions cannot be below the ${before.currentRedemptions} redemptions already recorded.`,
        );
      }
    }

    const updated = await this.prisma.promotion.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.maxRedemptions !== undefined ? { maxRedemptions: input.maxRedemptions } : {}),
        startsAt: window.startsAt, endsAt: window.endsAt,
        ...(input.terms !== undefined ? { terms: input.terms as Prisma.InputJsonValue } : {}),
      },
    });

    await this.audit.record({
      userId: input.actorUserId, action: 'UPDATE', entityType: 'promotion', entityId: id,
      changes: { name: updated.name, priority: updated.priority, maxRedemptions: updated.maxRedemptions },
    });
    return this.view(updated);
  }

  /**
   * Change status.
   *
   * Only transitions in `ALLOWED_TRANSITIONS` are permitted, and the update is CONDITIONAL on the
   * status still being what was read, so two concurrent operators cannot both win.
   */
  async setStatus(id: string, status: PromotionStatus, actorUserId: string): Promise<PromotionView> {
    const before = await this.prisma.promotion.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Promotion not found.');
    if (before.status === status) return this.view(before);

    if (!ALLOWED_TRANSITIONS[before.status].includes(status)) {
      throw new BadRequestException(`Cannot move a promotion from ${before.status} to ${status}.`);
    }

    const { count } = await this.prisma.promotion.updateMany({
      where: { id, deletedAt: null, status: before.status },
      data: { status },
    });
    if (count === 0) {
      throw new BadRequestException('This promotion was changed by someone else. Reload and retry.');
    }

    await this.audit.record({
      userId: actorUserId, action: 'UPDATE', entityType: 'promotion', entityId: id,
      changes: { field: 'status', from: before.status, to: status },
    });
    return this.getById(id);
  }

  async getById(id: string): Promise<PromotionView> {
    const p = await this.prisma.promotion.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new NotFoundException('Promotion not found.');
    return this.view(p);
  }

  async list(query: { status?: PromotionStatus; type?: PromotionType; page?: number; limit?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const where: Prisma.PromotionWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.promotion.findMany({
        where, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit, take: limit,
      }),
      this.prisma.promotion.count({ where }),
    ]);

    return { items: rows.map((r) => this.view(r)), total, page, limit, unavailable: [AWARDING_BLOCKED] };
  }

  /* ------------------------------------------------------------------ player */

  /**
   * Promotions a player can genuinely see right now.
   *
   * ACTIVE only, inside their scheduled window, and not past their redemption cap. Nothing here
   * claims the player has earned anything — this is the list of published offers, and the response
   * says plainly that awarding is not available.
   */
  async listActiveForPlayer(): Promise<{ items: PromotionView[]; unavailable: typeof AWARDING_BLOCKED[] }> {
    const now = new Date();
    const rows = await this.prisma.promotion.findMany({
      where: {
        deletedAt: null,
        status: PromotionStatus.ACTIVE,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });

    const items = rows
      .filter((r) => r.maxRedemptions === null || r.currentRedemptions < r.maxRedemptions)
      .map((r) => this.view(r));

    return { items, unavailable: [AWARDING_BLOCKED] };
  }
}
