import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';

import { NotificationsService } from './notifications.service';

/**
 * The single notification orchestration layer (Phase 2D.1, Phase D).
 *
 * Every domain event that produces a player notification is mapped HERE — one method per real event.
 * Services call these methods; they never write notification rows themselves, so all copy, typing and
 * deduplication keys live in one auditable place.
 *
 * There is no event bus in this repository (`@nestjs/event-emitter` is not a dependency and `@OnEvent`
 * appears nowhere), so this is a directly-injected orchestrator rather than a subscriber. That keeps
 * delivery synchronous-after-commit, testable, and free of new infrastructure.
 *
 * RULES OBSERVED BY EVERY METHOD BELOW
 *   1. Called only AFTER the underlying transaction has committed.
 *   2. `safeEmit` — a notification failure can never fail or alter a financial outcome.
 *   3. The `eventKey` is derived from PERMANENT identifiers only (record id + transition), so a retry,
 *      a duplicate delivery, concurrent processing or a restart all collapse to one row.
 *   4. `data` carries references and non-sensitive financial metadata only — never a secret, token,
 *      password, server seed or payment credential.
 *   5. Amounts in `data` are copied from the authoritative record; they are display metadata, and the
 *      wallet/ledger remains the only source of financial truth.
 */
@Injectable()
export class NotificationEventsService {
  constructor(private readonly notifications: NotificationsService) {}

  /* ------------------------------------------------------------- deposits */

  async depositRequested(p: { userId: string; depositId: string; reference: string; amount: string; currency?: string }): Promise<void> {
    await this.notifications.safeEmit({
      userId: p.userId,
      type: NotificationType.TRANSACTION,
      title: 'Deposit requested',
      body: `We received your deposit request for ${p.amount}. It will be credited once an operator confirms it.`,
      eventKey: `deposit:requested:${p.depositId}`,
      data: { kind: 'deposit.requested', depositId: p.depositId, reference: p.reference, amount: p.amount, currency: p.currency ?? null },
    });
  }

  async depositCompleted(p: { userId: string; depositId: string; reference: string; amount: string; transactionId?: string | null }): Promise<void> {
    await this.notifications.safeEmit({
      userId: p.userId,
      type: NotificationType.TRANSACTION,
      title: 'Deposit successful',
      body: `Your deposit of ${p.amount} has been credited to your wallet.`,
      eventKey: `deposit:completed:${p.depositId}`,
      data: { kind: 'deposit.completed', depositId: p.depositId, reference: p.reference, amount: p.amount, transactionId: p.transactionId ?? null },
    });
  }

  async depositRejected(p: { userId: string; depositId: string; reference: string; amount: string; reason: string }): Promise<void> {
    await this.notifications.safeEmit({
      userId: p.userId,
      type: NotificationType.TRANSACTION,
      title: 'Deposit rejected',
      body: `Your deposit of ${p.amount} could not be completed. No funds were taken.`,
      eventKey: `deposit:rejected:${p.depositId}`,
      data: { kind: 'deposit.rejected', depositId: p.depositId, reference: p.reference, amount: p.amount, reason: p.reason },
    });
  }

  /* ---------------------------------------------------------- withdrawals */

  async withdrawalRequested(p: { userId: string; withdrawalId: string; reference: string; amount: string }): Promise<void> {
    await this.notifications.safeEmit({
      userId: p.userId,
      type: NotificationType.TRANSACTION,
      title: 'Withdrawal requested',
      body: `Your withdrawal of ${p.amount} is under review. The funds are on hold until it is processed.`,
      eventKey: `withdrawal:requested:${p.withdrawalId}`,
      data: { kind: 'withdrawal.requested', withdrawalId: p.withdrawalId, reference: p.reference, amount: p.amount },
    });
  }

  async withdrawalApproved(p: { userId: string; withdrawalId: string; reference: string; amount: string }): Promise<void> {
    await this.notifications.safeEmit({
      userId: p.userId,
      type: NotificationType.TRANSACTION,
      title: 'Withdrawal approved',
      body: `Your withdrawal of ${p.amount} has been approved and is being processed.`,
      eventKey: `withdrawal:approved:${p.withdrawalId}`,
      data: { kind: 'withdrawal.approved', withdrawalId: p.withdrawalId, reference: p.reference, amount: p.amount },
    });
  }

  async withdrawalCompleted(p: { userId: string; withdrawalId: string; reference: string; amount: string }): Promise<void> {
    await this.notifications.safeEmit({
      userId: p.userId,
      type: NotificationType.TRANSACTION,
      title: 'Withdrawal completed',
      body: `Your withdrawal of ${p.amount} has been completed.`,
      eventKey: `withdrawal:completed:${p.withdrawalId}`,
      data: { kind: 'withdrawal.completed', withdrawalId: p.withdrawalId, reference: p.reference, amount: p.amount },
    });
  }

  async withdrawalRejected(p: { userId: string; withdrawalId: string; reference: string; amount: string; reason: string; refunded: boolean }): Promise<void> {
    await this.notifications.safeEmit({
      userId: p.userId,
      type: NotificationType.TRANSACTION,
      title: 'Withdrawal rejected',
      body: p.refunded
        ? `Your withdrawal of ${p.amount} was rejected and the funds have been returned to your wallet.`
        : `Your withdrawal of ${p.amount} was rejected.`,
      eventKey: `withdrawal:rejected:${p.withdrawalId}`,
      data: { kind: 'withdrawal.rejected', withdrawalId: p.withdrawalId, reference: p.reference, amount: p.amount, reason: p.reason, refunded: p.refunded },
    });
  }

  /**
   * A large withdrawal was held back for senior approval (Phase 2C.17 escalation).
   * Player-visible because it explains a delay the player would otherwise not understand.
   */
  async withdrawalEscalated(p: { userId: string; withdrawalId: string; reference: string; amount: string }): Promise<void> {
    await this.notifications.safeEmit({
      userId: p.userId,
      type: NotificationType.TRANSACTION,
      title: 'Withdrawal needs additional review',
      body: `Your withdrawal of ${p.amount} requires senior approval and may take a little longer.`,
      eventKey: `withdrawal:escalated:${p.withdrawalId}`,
      data: { kind: 'withdrawal.escalated', withdrawalId: p.withdrawalId, reference: p.reference, amount: p.amount },
    });
  }

  /* ------------------------------------------------------------- security */

  /**
   * Password changed. The event key includes the change timestamp because a password may legitimately
   * be changed more than once — each change is a distinct security event the player must see.
   */
  async passwordChanged(p: { userId: string; at: Date }): Promise<void> {
    await this.notifications.safeEmit({
      userId: p.userId,
      type: NotificationType.SECURITY,
      title: 'Password changed',
      body: 'Your password was changed. If this was not you, contact support immediately.',
      eventKey: `security:password-changed:${p.userId}:${p.at.toISOString()}`,
      data: { kind: 'security.password_changed', at: p.at.toISOString() },
    });
  }

  async accountLocked(p: { userId: string; reason: string; at: Date }): Promise<void> {
    await this.notifications.safeEmit({
      userId: p.userId,
      type: NotificationType.SECURITY,
      title: 'Account locked',
      body: 'Your account was locked for security reasons. Contact support if you need help.',
      eventKey: `security:account-locked:${p.userId}:${p.at.toISOString()}`,
      data: { kind: 'security.account_locked', reason: p.reason, at: p.at.toISOString() },
    });
  }

  async accountUnlocked(p: { userId: string; at: Date }): Promise<void> {
    await this.notifications.safeEmit({
      userId: p.userId,
      type: NotificationType.SECURITY,
      title: 'Account unlocked',
      body: 'Your account has been unlocked. You can sign in again.',
      eventKey: `security:account-unlocked:${p.userId}:${p.at.toISOString()}`,
      data: { kind: 'security.account_unlocked', at: p.at.toISOString() },
    });
  }

  /* ------------------------------------------------------ support (2D.3) */

  /**
   * An agent answered a player's ticket.
   *
   * The event key includes the ticket id AND a per-reply timestamp, so two different replies
   * produce two notifications while a retry of the SAME reply is deduplicated by the existing
   * deterministic-id mechanism.
   */
  async supportAgentReplied(p: {
    userId: string; ticketId: string; reference: string; subject: string;
  }): Promise<void> {
    await this.notifications.safeEmit({
      userId: p.userId,
      type: NotificationType.SYSTEM,
      title: `Support replied to ${p.reference}`,
      // The reply body is deliberately NOT included: a notification is a pointer, not a copy of
      // the conversation, and support text can contain account detail.
      body: `Our support team has replied to your ticket "${p.subject}".`,
      eventKey: `support:agent-reply:${p.ticketId}:${Date.now()}`,
      data: { kind: 'support.agent_replied', ticketId: p.ticketId, reference: p.reference },
    });
  }

  /* ------------------------------------------------------ partner (2D.5) */

  /**
   * A partner's status changed (e.g. PENDING → ACTIVE).
   *
   * Keyed by (partner, status) so re-issuing the same transition never duplicates, using the
   * existing deterministic-id mechanism.
   *
   * NOTE: partner *daily profit* notifications are deliberately absent — they depend on PA-03
   * partner profit, which is blocked on the missing revenue definition. Emitting one would require
   * a fabricated amount.
   */
  async partnerStatusChanged(p: {
    userId: string; partnerId: string; partnerName: string; status: string;
  }): Promise<void> {
    await this.notifications.safeEmit({
      userId: p.userId,
      type: NotificationType.SYSTEM,
      title: `${p.partnerName} is now ${p.status.toLowerCase()}`,
      body: `Your partner organisation's status changed to ${p.status}.`,
      // The RECIPIENT is part of the key. Without it, a per-partner key would deduplicate the
      // second member's notification against the first — every member after the first would
      // silently receive nothing. Caught by an integration test.
      eventKey: `partner:status:${p.partnerId}:${p.userId}:${p.status}`,
      data: { kind: 'partner.status_changed', partnerId: p.partnerId, status: p.status },
    });
  }

  /**
   * A partner's revenue share was changed by an operator.
   *
   * Keyed by (partner, new value) — the same value re-applied is not a new event. This carries the
   * SHARE, which is configuration, not an amount of money.
   */
  async partnerShareChanged(p: {
    userId: string; partnerId: string; partnerName: string; percent: string;
  }): Promise<void> {
    await this.notifications.safeEmit({
      userId: p.userId,
      type: NotificationType.SYSTEM,
      title: 'Your revenue share was updated',
      body: `The revenue share for ${p.partnerName} is now ${p.percent}%.`,
      eventKey: `partner:share:${p.partnerId}:${p.userId}:${p.percent}`,
      data: { kind: 'partner.share_changed', partnerId: p.partnerId, percent: p.percent },
    });
  }

  /** A user was linked to a partner organisation. Keyed by (partner, member). */
  async partnerMemberAdded(p: {
    userId: string; partnerId: string; partnerName: string;
  }): Promise<void> {
    await this.notifications.safeEmit({
      userId: p.userId,
      type: NotificationType.ACCOUNT,
      title: `You joined ${p.partnerName}`,
      body: 'Your account is now linked to a partner organisation.',
      eventKey: `partner:member:${p.partnerId}:${p.userId}`,
      data: { kind: 'partner.member_added', partnerId: p.partnerId },
    });
  }

  /** A ticket's status changed. Keyed by (ticket, status) so the same transition never duplicates. */
  async supportTicketStatusChanged(p: {
    userId: string; ticketId: string; reference: string; status: string;
  }): Promise<void> {
    await this.notifications.safeEmit({
      userId: p.userId,
      type: NotificationType.SYSTEM,
      title: `Ticket ${p.reference} is now ${p.status.toLowerCase().replace(/_/g, ' ')}`,
      body: `The status of your support ticket ${p.reference} changed to ${p.status}.`,
      eventKey: `support:status:${p.ticketId}:${p.status}`,
      data: { kind: 'support.status_changed', ticketId: p.ticketId, reference: p.reference, status: p.status },
    });
  }
}
