import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DepositStatus, Prisma, WithdrawalStatus } from '@prisma/client';

import { AuditAction } from '@prisma/client';

import type { RequestMeta } from '../../common/security/request-meta';
import { PrismaService } from '../database/prisma.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { AuditService } from '../security/audit.service';
import { WalletEngineService } from '../wallet-engine/services/wallet-engine.service';
import { ActivityType } from '@prisma/client';
import { ActivityEventService } from '../events/activity-event.service';

/**
 * Cashier service (Phase 2C.9) — server-authoritative deposits & withdrawals on the EXISTING
 * `DepositRequest`/`WithdrawalRequest` models. It owns only the request lifecycle; ALL money movement
 * goes through the frozen `WalletEngineService` (atomic, ledger-backed, idempotent, non-negative). No
 * payment gateway is faked: a deposit stays PENDING until an operator completes it (which credits).
 *
 * Withdrawals use HOLD-ON-REQUEST: the amount is debited immediately (funds held) so the player cannot
 * double-spend; an operator reject or a player cancel refunds it. All amounts and statuses are
 * server-derived; the client never supplies balance/payout/status/walletId/userId.
 */

const num = (v: string | number) => Number(v);
const money = (n: number, decimals = 2) => n.toFixed(decimals);

function limitEnv(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

/**
 * Optional large-withdrawal escalation threshold (Phase 2C.17, P0-4).
 *
 * BUSINESS-CONFIG REQUIRED: the client has not supplied a figure, and inventing one would be
 * inventing business policy. Returns `null` when unset, which DISABLES escalation entirely — with the
 * variable unset the withdrawal workflow behaves exactly as it did before this phase. The value is
 * read server-side only; the client can never supply or influence it.
 */
function largeWithdrawalThreshold(): number | null {
  const raw = process.env.CASHIER_LARGE_WITHDRAWAL_THRESHOLD;
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Role slug permitted to approve an ESCALATED (large) withdrawal. */
const LARGE_WITHDRAWAL_APPROVER_ROLE = 'super_admin';

/**
 * The operator performing a cashier transition. Assembled at the controller edge from the JWT
 * (`@CurrentUser()`), the request-id middleware and `@ReqMeta()` — never from the request body.
 */
export interface OperatorActor {
  id: string;
  roles: string[];
  requestId?: string | null;
  meta?: RequestMeta | null;
}

@Injectable()
export class CashierService {
  private readonly logger = new Logger(CashierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: WalletEngineService,
    private readonly audit: AuditService,
    // Phase 2D.1: the single notification orchestration layer. Every call below happens AFTER the
    // money movement has committed and uses `safeEmit`, so a notification can never fail, delay or
    // alter a financial outcome.
    private readonly notify: NotificationEventsService,
    private readonly events: ActivityEventService,
  ) {}

  /**
   * Persist an operator audit record for a cashier transition (Phase 2C.17, P0-3).
   *
   * Reuses the EXISTING `AuditService` — no second audit system. That service is deliberately
   * NON-BLOCKING (it catches and warns), and this is called only AFTER the money movement has already
   * committed, so a failed audit write can never change a financial outcome. `changes` carries only
   * non-sensitive financial metadata — never passwords, tokens, secrets, seeds or payment credentials.
   */
  private async recordOperatorAction(input: {
    actor?: OperatorActor;
    action: AuditAction;
    entityType: 'deposit_request' | 'withdrawal_request';
    entityId: string;
    affectedUserId: string;
    reference: string;
    amount: string;
    currencyId: string;
    fromStatus: string;
    toStatus: string;
    extra?: Record<string, unknown>;
  }): Promise<void> {
    await this.audit.record({
      userId: input.actor?.id ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      changes: {
        actorRoles: input.actor?.roles ?? [],
        requestId: input.actor?.requestId ?? null,
        affectedUserId: input.affectedUserId,
        reference: input.reference,
        amount: input.amount,
        currencyId: input.currencyId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        ...(input.extra ?? {}),
      },
      meta: input.actor?.meta ?? null,
    });
  }

  /** True when this stored amount exceeds the configured escalation threshold. Server-side only. */
  private isLargeWithdrawal(amount: Prisma.Decimal | string): boolean {
    const threshold = largeWithdrawalThreshold();
    if (threshold === null) return false; // unset ⇒ escalation disabled
    return num(amount.toString()) > threshold;
  }

  private get limits() {
    return {
      minDeposit: limitEnv('CASHIER_MIN_DEPOSIT', 10),
      maxDeposit: limitEnv('CASHIER_MAX_DEPOSIT', 100000),
      minWithdrawal: limitEnv('CASHIER_MIN_WITHDRAWAL', 100),
      maxWithdrawal: limitEnv('CASHIER_MAX_WITHDRAWAL', 50000),
    };
  }

  /** Public cashier config for the client (display only — the server validates every request). */
  config() {
    return {
      ...this.limits,
      currencies: ['INR'],
      depositFeePct: 0,
      withdrawalFeePct: 0,
      // Display only. null = escalation disabled (BUSINESS-CONFIG REQUIRED). The server always
      // re-derives escalation from the stored amount; a client value is never trusted.
      largeWithdrawalThreshold: largeWithdrawalThreshold(),
    };
  }

  private async loadActiveUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, status: true, deletedAt: true } });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');
    if (user.status !== 'ACTIVE') throw new ForbiddenException(`Account is ${user.status.toLowerCase()}`);
    return user;
  }

  private async loadCurrency(code: string) {
    const currency = await this.prisma.currency.findUnique({ where: { code: code.toUpperCase() } });
    if (!currency || !currency.isActive) throw new BadRequestException(`Unsupported currency "${code}"`);
    return currency;
  }

  private assertAmount(amount: string, min: number, max: number, decimals: number) {
    if (!/^\d{1,12}(\.\d{1,8})?$/.test(amount)) throw new BadRequestException('Amount must be a positive decimal');
    const n = num(amount);
    if (n <= 0) throw new BadRequestException('Amount must be greater than zero');
    if (n < min) throw new BadRequestException(`Minimum is ${min}`);
    if (n > max) throw new BadRequestException(`Maximum is ${max}`);
    if (Number(n.toFixed(decimals)) !== n) throw new BadRequestException(`Too many decimals (max ${decimals})`);
  }

  /* --------------------------------- deposits --------------------------------- */

  async createDeposit(userId: string, input: { amount: string; currency: string; method?: string; idempotencyKey: string }) {
    await this.loadActiveUser(userId);
    const currency = await this.loadCurrency(input.currency);
    this.assertAmount(input.amount, this.limits.minDeposit, this.limits.maxDeposit, currency.decimals);
    const wallet = await this.engine.getOrCreateWallet(userId, currency.id);
    const reference = `dep_${input.idempotencyKey}`;

    const existing = await this.prisma.depositRequest.findUnique({ where: { reference } });
    if (existing) {
      if (existing.userId !== userId) throw new ForbiddenException('Not your request');
      return this.depositView(existing);
    }
    const net = money(num(input.amount), currency.decimals);
    try {
      const created = await this.prisma.depositRequest.create({
        data: {
          userId, walletId: wallet.id, currencyId: currency.id, reference,
          amount: input.amount, fee: '0', netAmount: net, status: DepositStatus.PENDING,
          metadata: input.method ? ({ method: input.method } as Prisma.InputJsonValue) : undefined,
        },
      });
      // NOTE: no credit here — a deposit is PENDING until an operator/provider completes it.
      await this.notify.depositRequested({
        userId, depositId: created.id, reference: created.reference,
        amount: created.amount.toString(), currency: input.currency,
      });
      // Phase 2D.9 (X-02): keyed by the deposit id, so a retried request that resolves to the same
      // row produces the same event id and is deduplicated by Postgres.
      await this.events.record({
        userId, type: ActivityType.DEPOSIT, eventKey: `deposit:${created.id}`,
        metadata: { currency: input.currency, status: DepositStatus.PENDING },
      });
      return this.depositView(created);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const dup = await this.prisma.depositRequest.findUnique({ where: { reference } });
        if (dup) return this.depositView(dup);
      }
      throw err;
    }
  }

  async listDeposits(userId: string, limit = 20) {
    const rows = await this.prisma.depositRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: Math.min(100, Math.max(1, limit)) });
    return rows.map((r) => this.depositView(r));
  }

  async getDeposit(userId: string, id: string) {
    const row = await this.prisma.depositRequest.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException('Deposit not found');
    return this.depositView(row);
  }

  /** Operator: complete a PENDING deposit → credit the wallet (authoritative) + COMPLETED. Idempotent. */
  async completeDeposit(id: string, actor?: OperatorActor) {
    const row = await this.prisma.depositRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Deposit not found');
    if (row.status === DepositStatus.COMPLETED) return this.depositView(row); // idempotent: no re-credit, no duplicate audit
    if (row.status !== DepositStatus.PENDING && row.status !== DepositStatus.PROCESSING) {
      throw new ConflictException(`Deposit is ${row.status}`);
    }
    const movement = await this.engine.credit(row.userId, row.currencyId, {
      amount: row.netAmount.toString(), typeCode: 'DEPOSIT', description: `Deposit ${row.reference}`, idempotencyKey: `${row.reference}:credit`,
    });
    const updated = await this.prisma.depositRequest.update({ where: { id }, data: { status: DepositStatus.COMPLETED, transactionId: movement.transactionId, completedAt: new Date() } });
    await this.recordOperatorAction({
      actor, action: AuditAction.APPROVE, entityType: 'deposit_request', entityId: row.id,
      affectedUserId: row.userId, reference: row.reference, amount: row.netAmount.toString(),
      currencyId: row.currencyId, fromStatus: row.status, toStatus: DepositStatus.COMPLETED,
      extra: { transactionId: movement.transactionId },
    });
    await this.notify.depositCompleted({
      userId: row.userId, depositId: row.id, reference: row.reference,
      amount: row.netAmount.toString(), transactionId: movement.transactionId,
    });
    return this.depositView(updated);
  }

  /** Operator: reject a deposit (no money moved). */
  async rejectDeposit(id: string, reason?: string, actor?: OperatorActor) {
    const row = await this.prisma.depositRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Deposit not found');
    if (row.status === DepositStatus.COMPLETED) throw new ConflictException('Deposit already completed');
    const updated = await this.prisma.depositRequest.update({ where: { id }, data: { status: DepositStatus.FAILED, metadata: { ...(row.metadata as object ?? {}), rejectionReason: reason ?? 'rejected' } as Prisma.InputJsonValue } });
    await this.recordOperatorAction({
      actor, action: AuditAction.REJECT, entityType: 'deposit_request', entityId: row.id,
      affectedUserId: row.userId, reference: row.reference, amount: row.netAmount.toString(),
      currencyId: row.currencyId, fromStatus: row.status, toStatus: DepositStatus.FAILED,
      extra: { reason: reason ?? 'rejected' },
    });
    await this.notify.depositRejected({
      userId: row.userId, depositId: row.id, reference: row.reference,
      amount: row.netAmount.toString(), reason: reason ?? 'rejected',
    });
    return this.depositView(updated);
  }

  /* -------------------------------- withdrawals ------------------------------- */

  async createWithdrawal(userId: string, input: { amount: string; currency: string; method?: string; idempotencyKey: string }) {
    await this.loadActiveUser(userId);
    const currency = await this.loadCurrency(input.currency);
    this.assertAmount(input.amount, this.limits.minWithdrawal, this.limits.maxWithdrawal, currency.decimals);
    const wallet = await this.engine.getOrCreateWallet(userId, currency.id);
    const reference = `wd_${input.idempotencyKey}`;

    const existing = await this.prisma.withdrawalRequest.findUnique({ where: { reference } });
    if (existing) {
      if (existing.userId !== userId) throw new ForbiddenException('Not your request');
      return this.withdrawalView(existing, wallet.available);
    }
    if (num(wallet.available) < num(input.amount)) throw new BadRequestException('Insufficient balance');

    // Create the record first so a reference exists, then HOLD funds (debit). Idempotency keys keep
    // the debit exactly-once; on a debit failure we mark the request FAILED (no money moved).
    let created;
    try {
      created = await this.prisma.withdrawalRequest.create({
        data: {
          userId, walletId: wallet.id, currencyId: currency.id, reference,
          amount: input.amount, fee: '0', netAmount: money(num(input.amount), currency.decimals), status: WithdrawalStatus.PENDING,
          // Escalation is stamped from the SERVER-side threshold at request time, so the flag is
          // durable across restarts. Enforcement still re-derives it from the stored amount, so a
          // later threshold change is honoured and no backfill is ever required.
          metadata: {
            ...(input.method ? { method: input.method } : {}),
            largeWithdrawal: this.isLargeWithdrawal(input.amount),
            thresholdAtRequest: largeWithdrawalThreshold(),
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const dup = await this.prisma.withdrawalRequest.findUnique({ where: { reference } });
        if (dup) return this.withdrawalView(dup, wallet.available);
      }
      throw err;
    }

    let movement;
    try {
      movement = await this.engine.debit(userId, currency.id, { amount: input.amount, typeCode: 'WITHDRAWAL', description: `Withdrawal ${reference}`, idempotencyKey: `${reference}:hold` });
    } catch (err) {
      await this.prisma.withdrawalRequest.update({ where: { id: created.id }, data: { status: WithdrawalStatus.FAILED, rejectionReason: this.msg(err) } });
      if (this.msg(err).toLowerCase().includes('insufficient')) throw new BadRequestException('Insufficient balance');
      throw err;
    }
    const held = await this.prisma.withdrawalRequest.update({ where: { id: created.id }, data: { status: WithdrawalStatus.UNDER_REVIEW, transactionId: movement.transactionId } });
    await this.notify.withdrawalRequested({
      userId, withdrawalId: held.id, reference: held.reference, amount: held.amount.toString(),
    });
    if (this.isLargeWithdrawal(held.amount)) {
      await this.notify.withdrawalEscalated({
        userId, withdrawalId: held.id, reference: held.reference, amount: held.amount.toString(),
      });
    }
    return this.withdrawalView(held, movement.wallet.available);
  }

  async listWithdrawals(userId: string, limit = 20) {
    const rows = await this.prisma.withdrawalRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: Math.min(100, Math.max(1, limit)) });
    return rows.map((r) => this.withdrawalView(r));
  }

  async getWithdrawal(userId: string, id: string) {
    const row = await this.prisma.withdrawalRequest.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException('Withdrawal not found');
    return this.withdrawalView(row);
  }

  /** Player cancels a still-pending withdrawal → refund the held funds. */
  async cancelWithdrawal(userId: string, id: string) {
    const row = await this.prisma.withdrawalRequest.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException('Withdrawal not found');
    return this.refundAndClose(row, WithdrawalStatus.CANCELLED, 'cancelled by player');
  }

  /**
   * Operator: mark a held withdrawal APPROVED (funds already held at request time; NO money moves).
   *
   * Phase 2C.17 fixes two defects here without changing any money semantics:
   *
   * P0-5 - `reviewedById` is FK-constrained to `admin_users(id)`, but the controller passes the
   *   operator's `users.id` (the JWT subject). `admin_users` is a separate, unpopulated identity
   *   table, so EVERY approval failed with a P2003 foreign-key violation -> HTTP 500. We now resolve
   *   the operator's linked `AdminUser` (via the model's own optional `userId` link) and store `null`
   *   when there is none - the column is nullable and null is already a working value. Operator
   *   attribution is preserved in the audit trail and in `metadata.reviewedByUserId`. No second
   *   identity system is adopted and no schema is changed.
   *
   * P0-4 - when a large-withdrawal threshold is CONFIGURED, escalation is derived server-side from
   *   the STORED amount (persistent and restart-safe by construction) and approval then requires
   *   `super_admin`. With the threshold unset this branch is inert.
   */
  async approveWithdrawal(id: string, actorOrAdminId?: OperatorActor | string) {
    const actor: OperatorActor | undefined =
      typeof actorOrAdminId === 'string' ? { id: actorOrAdminId, roles: [] } : actorOrAdminId;

    const row = await this.prisma.withdrawalRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Withdrawal not found');
    if (row.status === WithdrawalStatus.APPROVED) return this.withdrawalView(row); // idempotent
    if (row.status !== WithdrawalStatus.UNDER_REVIEW && row.status !== WithdrawalStatus.PENDING) throw new ConflictException(`Withdrawal is ${row.status}`);

    // Escalation is decided from the STORED amount, never from anything the client supplied.
    const escalated = this.isLargeWithdrawal(row.amount);
    if (escalated && !(actor?.roles ?? []).includes(LARGE_WITHDRAWAL_APPROVER_ROLE)) {
      await this.recordOperatorAction({
        actor, action: AuditAction.EXECUTE, entityType: 'withdrawal_request', entityId: row.id,
        affectedUserId: row.userId, reference: row.reference, amount: row.amount.toString(),
        currencyId: row.currencyId, fromStatus: row.status, toStatus: row.status,
        extra: { escalated: true, outcome: 'approval_refused_requires_super_admin', threshold: largeWithdrawalThreshold() },
      });
      throw new ForbiddenException('This withdrawal is escalated and requires a super admin to approve');
    }

    const reviewedById = actor?.id ? await this.resolveAdminUserId(actor.id) : null;
    const updated = await this.prisma.withdrawalRequest.update({
      where: { id },
      data: {
        status: WithdrawalStatus.APPROVED,
        reviewedById,
        approvedAt: new Date(),
        metadata: { ...(row.metadata as object ?? {}), reviewedByUserId: actor?.id ?? null } as Prisma.InputJsonValue,
      },
    });
    await this.recordOperatorAction({
      actor, action: AuditAction.APPROVE, entityType: 'withdrawal_request', entityId: row.id,
      affectedUserId: row.userId, reference: row.reference, amount: row.amount.toString(),
      currencyId: row.currencyId, fromStatus: row.status, toStatus: WithdrawalStatus.APPROVED,
      extra: { escalated, threshold: largeWithdrawalThreshold() },
    });
    await this.notify.withdrawalApproved({
      userId: row.userId, withdrawalId: row.id, reference: row.reference, amount: row.amount.toString(),
    });
    return this.withdrawalView(updated);
  }

  /**
   * Map an authenticated operator (`users.id`) to their linked `AdminUser` row id, or null.
   * `AdminUser.userId` is an existing optional unique link, so this reuses the schema as designed
   * instead of writing a `users.id` into a column constrained to `admin_users`.
   */
  private async resolveAdminUserId(userId: string): Promise<string | null> {
    const admin = await this.prisma.adminUser.findUnique({ where: { userId }, select: { id: true } });
    return admin?.id ?? null;
  }

  /** Operator: complete a withdrawal (funds already debited on request) → COMPLETED. */
  async completeWithdrawal(id: string, actor?: OperatorActor) {
    const row = await this.prisma.withdrawalRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Withdrawal not found');
    if (row.status === WithdrawalStatus.COMPLETED) return this.withdrawalView(row); // idempotent
    if (row.status !== WithdrawalStatus.APPROVED && row.status !== WithdrawalStatus.UNDER_REVIEW && row.status !== WithdrawalStatus.PROCESSING) {
      throw new ConflictException(`Withdrawal is ${row.status}`);
    }
    const updated = await this.prisma.withdrawalRequest.update({ where: { id }, data: { status: WithdrawalStatus.COMPLETED, completedAt: new Date() } });
    await this.recordOperatorAction({
      actor, action: AuditAction.EXECUTE, entityType: 'withdrawal_request', entityId: row.id,
      affectedUserId: row.userId, reference: row.reference, amount: row.amount.toString(),
      currencyId: row.currencyId, fromStatus: row.status, toStatus: WithdrawalStatus.COMPLETED,
    });
    await this.notify.withdrawalCompleted({
      userId: row.userId, withdrawalId: row.id, reference: row.reference, amount: row.amount.toString(),
    });
    return this.withdrawalView(updated);
  }

  /** Operator: reject a held withdrawal → refund the held funds. */
  async rejectWithdrawal(id: string, reason?: string, actor?: OperatorActor) {
    const row = await this.prisma.withdrawalRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Withdrawal not found');
    const alreadyClosed = row.status === WithdrawalStatus.REJECTED || row.status === WithdrawalStatus.CANCELLED;
    const view = await this.refundAndClose(row, WithdrawalStatus.REJECTED, reason ?? 'rejected');
    // Only audit a real transition - a repeated reject is a refund no-op and must not double-log.
    if (!alreadyClosed) {
      await this.recordOperatorAction({
        actor, action: AuditAction.REJECT, entityType: 'withdrawal_request', entityId: row.id,
        affectedUserId: row.userId, reference: row.reference, amount: row.amount.toString(),
        currencyId: row.currencyId, fromStatus: row.status, toStatus: WithdrawalStatus.REJECTED,
        extra: { reason: reason ?? 'rejected', refunded: true },
      });
      await this.notify.withdrawalRejected({
        userId: row.userId, withdrawalId: row.id, reference: row.reference,
        amount: row.amount.toString(), reason: reason ?? 'rejected', refunded: true,
      });
    }
    return view;
  }

  /** Refund the held amount (credit) and close the withdrawal. Idempotent; only for held/open states. */
  private async refundAndClose(row: { id: string; userId: string; currencyId: string; amount: Prisma.Decimal; reference: string; status: WithdrawalStatus }, to: WithdrawalStatus, reason: string) {
    if (row.status === WithdrawalStatus.COMPLETED) throw new ConflictException('Withdrawal already completed');
    if (row.status === WithdrawalStatus.REJECTED || row.status === WithdrawalStatus.CANCELLED) {
      const cur = await this.prisma.withdrawalRequest.findUnique({ where: { id: row.id } });
      return this.withdrawalView(cur!);
    }
    // Refund only if funds were actually held (UNDER_REVIEW/APPROVED/PROCESSING/PENDING-with-tx).
    const held = row.status === WithdrawalStatus.UNDER_REVIEW || row.status === WithdrawalStatus.APPROVED || row.status === WithdrawalStatus.PROCESSING;
    if (held) {
      await this.engine.credit(row.userId, row.currencyId, { amount: row.amount.toString(), typeCode: 'REFUND', description: `Withdrawal refund ${row.reference}`, idempotencyKey: `${row.reference}:refund` });
    }
    const updated = await this.prisma.withdrawalRequest.update({ where: { id: row.id }, data: { status: to, rejectionReason: reason } });
    return this.withdrawalView(updated);
  }

  /* --------------------------------- views ---------------------------------- */

  private depositView(r: { id: string; reference: string; amount: Prisma.Decimal; fee: Prisma.Decimal; netAmount: Prisma.Decimal; currencyId: string; status: DepositStatus; transactionId: string | null; createdAt: Date; completedAt: Date | null }) {
    return { id: r.id, kind: 'deposit' as const, reference: r.reference, amount: r.amount.toString(), fee: r.fee.toString(), netAmount: r.netAmount.toString(), currencyId: r.currencyId, status: r.status, transactionId: r.transactionId, createdAt: r.createdAt, completedAt: r.completedAt };
  }

  private withdrawalView(r: { id: string; reference: string; amount: Prisma.Decimal; fee: Prisma.Decimal; netAmount: Prisma.Decimal; currencyId: string; status: WithdrawalStatus; transactionId: string | null; rejectionReason: string | null; createdAt: Date; completedAt: Date | null }, balanceAfter?: string) {
    return { id: r.id, kind: 'withdrawal' as const, reference: r.reference, amount: r.amount.toString(), fee: r.fee.toString(), netAmount: r.netAmount.toString(), currencyId: r.currencyId, status: r.status, transactionId: r.transactionId, rejectionReason: r.rejectionReason, createdAt: r.createdAt, completedAt: r.completedAt, ...(balanceAfter !== undefined ? { balanceAfter } : {}) };
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
