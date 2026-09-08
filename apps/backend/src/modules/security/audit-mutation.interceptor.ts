import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditAction } from '@prisma/client';
import type { AuthenticatedUser } from '@gaming-platform/types';
import type { Request } from 'express';
import { tap } from 'rxjs/operators';
import type { Observable } from 'rxjs';

import { extractRequestMeta } from '../../common/security/request-meta';
import { AuditService } from './audit.service';

/**
 * Records an audit entry for every SUCCESSFUL mutating request on a controller it is applied to
 * (Phase 2D.2, audit gap #18 — game-configuration changes).
 *
 * Why an interceptor rather than a call in each service method: the admin game/catalog controllers
 * expose 12+ mutation endpoints across several services. One interceptor gives complete, uniform
 * coverage that cannot drift when an endpoint is added, and keeps the audit concern out of the
 * domain services entirely.
 *
 * Scope is deliberately narrow so this does not become audit noise:
 *   - only POST / PUT / PATCH / DELETE (reads are never recorded);
 *   - only on controllers explicitly annotated with `@AuditEntity(...)`;
 *   - only on SUCCESS — a rejected request records nothing.
 *
 * It follows the existing `AuditService` contract exactly: the write is non-blocking (the service
 * catches and warns) and happens after the handler has completed, so it can never change an outcome.
 *
 * What is captured: actor id, actor roles, HTTP method, route, target entity id, request id, IP and
 * user-agent. What is never captured: request bodies (which can carry secrets), tokens, passwords or
 * any credential — only the safe request shape.
 */

export const AUDIT_ENTITY_KEY = 'audit:entityType';

/** Mark a controller (or handler) as audit-recorded, naming the entity type it mutates. */
export const AuditEntity = (entityType: string) => SetMetadata(AUDIT_ENTITY_KEY, entityType);

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Map an HTTP method onto the closest existing `AuditAction`. */
function actionFor(method: string): AuditAction {
  if (method === 'POST') return AuditAction.CREATE;
  if (method === 'DELETE') return AuditAction.DELETE;
  return AuditAction.UPDATE;
}

@Injectable()
export class AuditMutationInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const entityType = this.reflector.getAllAndOverride<string | undefined>(AUDIT_ENTITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser; id?: string }>();

    if (!entityType || !MUTATING.has(req.method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        // Fire-and-forget, after success. `void` because the audit contract is non-blocking and a
        // failure must never surface to the caller.
        void this.audit.record({
          userId: req.user?.id ?? null,
          action: actionFor(req.method),
          entityType,
          // The resource id when the route has one; otherwise the route itself.
          entityId: (req.params as Record<string, string> | undefined)?.id ?? req.route?.path ?? req.path,
          changes: {
            method: req.method,
            route: req.route?.path ?? req.path,
            actorRoles: req.user?.roles ?? [],
            requestId: req.id ?? null,
          },
          meta: extractRequestMeta(req),
        });
      }),
    );
  }
}
