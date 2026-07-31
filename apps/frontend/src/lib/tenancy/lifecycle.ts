/**
 * Tenant Lifecycle Management (Phase 3.1, STEP 14).
 *
 * Drives the tenant state machine — Provision → Activate → Suspend → Archive → Restore →
 * Delete — with validated transitions and lifecycle hooks. No manual database changes:
 * every transition is a method call that updates the registry and fans out to isolation /
 * quota / observability side-effects via injected hooks. Additive; no frozen module.
 */
import type { CreateTenantInput, TenantRegistry } from './registry';
import { type Tenant, TenantStatus } from './types';

/** Allowed transitions (from → set of reachable states). */
const TRANSITIONS: Record<TenantStatus, TenantStatus[]> = {
  [TenantStatus.Provisioned]: [TenantStatus.Active, TenantStatus.Archived, TenantStatus.Deleted],
  [TenantStatus.Active]: [TenantStatus.Suspended, TenantStatus.Archived, TenantStatus.Deleted],
  [TenantStatus.Suspended]: [TenantStatus.Active, TenantStatus.Archived, TenantStatus.Deleted],
  [TenantStatus.Archived]: [TenantStatus.Active, TenantStatus.Deleted],
  [TenantStatus.Deleted]: [],
};

export class TenantLifecycleError extends Error {
  constructor(readonly from: TenantStatus, readonly to: TenantStatus) {
    super(`illegal tenant transition ${from} → ${to}`);
    this.name = 'TenantLifecycleError';
  }
}

export interface LifecycleHooks {
  onProvision?: (tenant: Tenant) => void;
  onActivate?: (tenant: Tenant) => void;
  onSuspend?: (tenant: Tenant) => void;
  onArchive?: (tenant: Tenant) => void;
  onRestore?: (tenant: Tenant) => void;
  onDelete?: (tenant: Tenant) => void;
  onPurge?: (tenantId: string) => void;
}

export function canTransition(from: TenantStatus, to: TenantStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class TenantLifecycleManager {
  constructor(private readonly registry: TenantRegistry, private readonly hooks: LifecycleHooks = {}) {}

  /** Create a tenant in the Provisioned state. */
  provision(input: CreateTenantInput): Tenant {
    const tenant = this.registry.create(input); // starts Provisioned
    this.hooks.onProvision?.(tenant);
    return tenant;
  }

  activate(id: string): Tenant {
    const tenant = this.transition(id, TenantStatus.Active);
    this.hooks.onActivate?.(tenant);
    return tenant;
  }
  suspend(id: string): Tenant {
    const tenant = this.transition(id, TenantStatus.Suspended);
    this.hooks.onSuspend?.(tenant);
    return tenant;
  }
  archive(id: string): Tenant {
    const tenant = this.transition(id, TenantStatus.Archived);
    this.hooks.onArchive?.(tenant);
    return tenant;
  }
  /** Restore an archived/suspended tenant back to Active. */
  restore(id: string): Tenant {
    const tenant = this.transition(id, TenantStatus.Active);
    this.hooks.onRestore?.(tenant);
    return tenant;
  }
  delete(id: string): Tenant {
    const current = this.registry.mustGet(id);
    if (!canTransition(current.status, TenantStatus.Deleted)) throw new TenantLifecycleError(current.status, TenantStatus.Deleted);
    const tenant = this.registry.delete(id); // frees resolution indexes
    this.hooks.onDelete?.(tenant);
    return tenant;
  }
  /** Permanently purge a soft-deleted tenant. */
  purge(id: string): void {
    this.registry.purge(id);
    this.hooks.onPurge?.(id);
  }

  private transition(id: string, to: TenantStatus): Tenant {
    const current = this.registry.mustGet(id);
    if (current.status === to) return this.registry.get(id)!;
    if (!canTransition(current.status, to)) throw new TenantLifecycleError(current.status, to);
    return this.registry.setStatus(id, to);
  }
}
