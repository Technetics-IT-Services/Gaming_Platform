import {
  CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor,
} from '@nestjs/common';
import type { AuthenticatedUser } from '@gaming-platform/types';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';

import { AuditService } from '../../modules/security/audit.service';
import { extractRequestMeta } from '../security/request-meta';

/**
 * Blanket audit of operator actions (Phase 2D.10, AD-12).
 *
 * THE GAP THIS CLOSES. Individual services audit their own domain changes well — partners, KYC,
 * settings, promotions, support, expenses, responsible gaming, roles, sessions and 2FA all write
 * `audit_trails` rows. But coverage was **per service**, which means it is only as complete as the
 * next developer remembers to make it, and one high-privilege surface was genuinely missing:
 * `POST /admin/wallet/credit` and `/admin/wallet/debit` record the adjustment in
 * `wallet_transactions` but **not which operator performed it**. That controller is a frozen
 * surface and cannot be edited.
 *
 * HOW THIS CLOSES IT WITHOUT TOUCHING FROZEN CODE. Every **successful mutating request under the
 * `/admin/` prefix** is recorded here, attributed to the authenticated operator. Path-scoping is
 * the right shape for an observer: a future admin controller cannot forget to be audited, and a
 * route that is renamed still matches the prefix. Unlike a security guard, over-matching is safe —
 * the worst case is an extra record.
 *
 * WHY IT CANNOT CAUSE A FAILURE. The record is written **after** the handler succeeds
 * (`tap`'s next channel), never before, and any error while writing it is swallowed and logged.
 * An audit row must never be able to fail an operator's action or, worse, make a completed money
 * movement look like it failed.
 *
 * SECRETS NEVER REACH IT. The request body is filtered to a small allow-list of non-sensitive
 * descriptive keys. Passwords, tokens, TOTP codes, recovery codes and seeds are not merely
 * redacted — they are never copied in the first place.
 */

/** Only these body keys are ever recorded. Anything not listed is dropped. */
const RECORDED_BODY_KEYS = new Set([
  'userId', 'currencyId', 'currencyCode', 'amount', 'reason', 'status', 'percent',
  'reference', 'walletId', 'transactionId', 'value', 'code', 'name', 'type',
  'wageringRequirement', 'maxRedemptions', 'expiresAt', 'isPrimary',
]);

/**
 * A second, independent filter applied AFTER the allow-list.
 *
 * Every allow-listed key was surveyed and is a business identifier (`code` is a promotion, expense
 * or referral code; `value` is a non-secret setting). But a survey is only true on the day it is
 * taken: this deny-list makes the invariant local to this file, so a future route that introduces
 * a credential-shaped field cannot leak through the allow-list by accident.
 */
const CREDENTIAL_LIKE = /(password|passwd|token|secret|totp|otp|seed|recovery|backup|credential|apikey|api_key|auth)/i;

/** Methods that change something. A GET is not an action. */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class AdminActionAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AdminActionAuditInterceptor.name);

  constructor(private readonly audit: AuditService) {}

  /** True when this request targets the operator API boundary. */
  private isAdminRoute(path: string): boolean {
    return /(^|\/)admin(\/|$)/.test(path.split('?')[0] ?? '');
  }

  private safeBody(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (!RECORDED_BODY_KEYS.has(k)) continue;
      if (CREDENTIAL_LIKE.test(k)) continue;
      // Only primitives are copied; a nested object could smuggle anything.
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
        out[k] = typeof v === 'string' ? v.slice(0, 200) : v;
      }
    }
    return out;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const method = req.method?.toUpperCase() ?? 'GET';
    const path = (req.path ?? req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';

    if (!MUTATING.has(method) || !this.isAdminRoute(path) || !req.user?.id) {
      return next.handle();
    }

    const actorId = req.user.id;
    const body = this.safeBody(req.body);

    return next.handle().pipe(
      tap({
        next: () => {
          // Fire-and-forget, after success. Never awaited, never allowed to throw.
          void this.audit
            .record({
              userId: actorId,
              action: 'UPDATE',
              entityType: 'admin_action',
              entityId: actorId,
              changes: { method, path, ...body },
              // The SAME extractor every audited service uses, so an interceptor-written row is
              // indistinguishable in shape from a service-written one.
              meta: extractRequestMeta(req),
            })
            .catch((err) => this.logger.warn(`admin action audit failed for ${method} ${path}: ${String(err)}`));
        },
      }),
    );
  }
}
