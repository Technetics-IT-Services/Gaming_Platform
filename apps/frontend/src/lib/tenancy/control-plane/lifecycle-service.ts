/**
 * Persistent Lifecycle Service (Phase 3.2, STEP 14).
 *
 * Atomic, audited, optimistic tenant lifecycle transitions — Provisioned → Active →
 * Suspended → Archived → Deleted — reusing the Phase 3.1 transition validation. Each
 * transition persists the new status, appends a lifecycle event and writes an audit entry
 * in ONE transaction; a replayed transition to the current state is an idempotent no-op.
 * Additive; no frozen module, no money.
 */
import { canTransition } from '../lifecycle';
import { illegalTransition } from '../persistence/errors';
import type { PersistenceDriver } from '../persistence/driver';
import type { TenantRow } from '../persistence/records';
import type { LifecycleRepository } from '../persistence/repositories';
import type { TenantRepository } from '../persistence/tenant-repository';
import { TenantStatus } from '../types';
import type { AuditService } from './audit-service';

export interface TransitionInput {
  actorId?: string;
  reason?: string;
  /** Optional optimistic guard — reject if the tenant changed since the caller read it. */
  expectedVersion?: number;
}

export class LifecycleService {
  constructor(
    private readonly db: PersistenceDriver,
    private readonly tenants: TenantRepository,
    private readonly events: LifecycleRepository,
    private readonly audit?: AuditService,
  ) {}

  transition(tenantId: string, to: TenantStatus, input: TransitionInput = {}): TenantRow {
    return this.db.transaction(() => {
      const current = this.tenants.getById(tenantId);
      if (!current) throw illegalTransition('∅', to);
      // Idempotent no-op — replaying the same transition does not error or double-audit.
      if (current.status === to) return current;
      if (!canTransition(current.status, to)) throw illegalTransition(current.status, to);

      const from = current.status;
      const expected = input.expectedVersion ?? current.version;
      const next = this.tenants.setStatus(tenantId, to, expected, input.actorId);
      this.events.append({ tenantId, from, to, actorId: input.actorId, reason: input.reason });
      this.audit?.record({
        tenantId, actorId: input.actorId, action: `lifecycle.${to}`, resource: 'tenant', resourceId: tenantId,
        before: { status: from }, after: { status: to }, reason: input.reason,
      });
      return next;
    });
  }

  activate(tenantId: string, input?: TransitionInput): TenantRow {
    return this.transition(tenantId, TenantStatus.Active, input);
  }
  suspend(tenantId: string, input?: TransitionInput): TenantRow {
    return this.transition(tenantId, TenantStatus.Suspended, input);
  }
  archive(tenantId: string, input?: TransitionInput): TenantRow {
    return this.transition(tenantId, TenantStatus.Archived, input);
  }
  restore(tenantId: string, input?: TransitionInput): TenantRow {
    return this.transition(tenantId, TenantStatus.Active, input);
  }
  delete(tenantId: string, input?: TransitionInput): TenantRow {
    return this.transition(tenantId, TenantStatus.Deleted, input);
  }

  history(tenantId: string) {
    return this.events.listByTenant(tenantId);
  }
}
