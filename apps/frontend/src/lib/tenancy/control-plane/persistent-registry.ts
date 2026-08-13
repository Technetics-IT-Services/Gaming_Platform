/**
 * Persistent Tenant Registry (Phase 3.2, STEP 3).
 *
 * A persistence-backed registry that preserves the Phase 3.1 public concepts: it hydrates a
 * full Phase 3.1 `Tenant` (record + active configuration + tenant flag overrides + domains +
 * api-key prefixes) from the normalized tables, and exposes create/get/update/lifecycle/
 * list/search/health. All lookups (id, code, operator) are O(1) via indexes — never a scan.
 * Additive; no frozen module.
 */
import { defaultConfiguration } from '../defaults';
import type { DomainRepository, ApiKeyRepository, FeatureFlagRepository } from '../persistence/repositories';
import type { TenantRow } from '../persistence/records';
import type { CreateTenantRecord, TenantRepository, TenantSearch, UpdateTenantRecord } from '../persistence/tenant-repository';
import { type Tenant, type TenantHealth, TenantStatus } from '../types';
import type { ConfigurationService } from './configuration-service';
import type { LifecycleService } from './lifecycle-service';

export class PersistentTenantRegistry {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly config: ConfigurationService,
    private readonly flags: FeatureFlagRepository,
    private readonly domains: DomainRepository,
    private readonly apiKeys: ApiKeyRepository,
    private readonly lifecycle: LifecycleService,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Hydrate a normalized tenant row into a full Phase 3.1 `Tenant`. */
  hydrate(row: TenantRow): Tenant {
    const configuration = this.config.getActive(row.id) ?? defaultConfiguration(row.currency, row.locale);
    const features: Record<string, boolean> = {};
    for (const f of this.flags.listTenant(row.id)) if (f.enabled !== undefined) features[f.flag] = f.enabled;
    return {
      id: row.id, code: row.code, name: row.name, operatorId: row.operatorId, status: row.status, plan: row.plan,
      region: row.region, timezone: row.timezone, currency: row.currency, locale: row.locale,
      brand: row.brand, theme: row.theme, features, limits: row.limits, configuration, metadata: row.metadata,
      domains: this.domains.listByTenant(row.id).filter((d) => d.status !== 'removed').map((d) => d.hostname),
      apiKeys: this.apiKeys.listByTenant(row.id).filter((k) => !k.revokedAt).map((k) => k.prefix),
      createdAt: row.createdAt, updatedAt: row.updatedAt,
      provisionedAt: row.provisionedAt, activatedAt: row.activatedAt, suspendedAt: row.suspendedAt, archivedAt: row.archivedAt, deletedAt: row.deletedAt,
    };
  }

  createTenant(input: CreateTenantRecord): Tenant {
    const row = this.tenants.create(input);
    // Seed an initial configuration version so `getActive` works immediately.
    this.config.createVersion(row.id, defaultConfiguration(row.currency, row.locale), { reason: 'initial', actor: input.actor });
    return this.hydrate(row);
  }

  getTenant(id: string): Tenant | null {
    const row = this.tenants.getById(id);
    return row ? this.hydrate(row) : null;
  }
  getTenantByCode(code: string): Tenant | null {
    const row = this.tenants.getByCode(code);
    return row ? this.hydrate(row) : null;
  }

  updateTenant(id: string, patch: UpdateTenantRecord, expectedVersion: number, actor?: string): Tenant {
    return this.hydrate(this.tenants.update(id, patch, expectedVersion, actor));
  }

  suspendTenant(id: string, actor?: string): Tenant {
    return this.hydrate(this.lifecycle.suspend(id, { actorId: actor }));
  }
  restoreTenant(id: string, actor?: string): Tenant {
    return this.hydrate(this.lifecycle.restore(id, { actorId: actor }));
  }
  archiveTenant(id: string, actor?: string): Tenant {
    return this.hydrate(this.lifecycle.archive(id, { actorId: actor }));
  }
  deleteTenant(id: string, actor?: string): Tenant {
    return this.hydrate(this.lifecycle.delete(id, { actorId: actor }));
  }
  purgeTenant(id: string): void {
    this.tenants.purge(id);
  }

  listTenants(): Tenant[] {
    return this.tenants.list().map((r) => this.hydrate(r));
  }
  searchTenants(query: TenantSearch): Tenant[] {
    return this.tenants.search(query).map((r) => this.hydrate(r));
  }

  /** The raw row (for callers needing the version for optimistic writes). */
  getRow(id: string): TenantRow | null {
    return this.tenants.getById(id);
  }

  health(id: string): TenantHealth {
    const row = this.tenants.getById(id);
    if (!row) return { tenantId: id, status: TenantStatus.Deleted, healthy: false, reasons: ['not found'], checkedAt: this.clock() };
    const reasons: string[] = [];
    if (row.status !== TenantStatus.Active) reasons.push(`tenant is ${row.status}`);
    if (this.config.getActiveVersion(row.id) === null) reasons.push('no active configuration');
    return { tenantId: id, status: row.status, healthy: row.status === TenantStatus.Active && reasons.length === 0, reasons, checkedAt: this.clock() };
  }
}
