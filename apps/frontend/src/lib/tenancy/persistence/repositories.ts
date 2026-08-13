/**
 * Control-plane repositories (Phase 3.2, STEP 2, 5, 6, 7, 9, 12, 13, 14).
 *
 * Persistence abstractions for domains, API keys, configuration (+ immutable versions),
 * feature flags, quotas, lifecycle events, audit events, provisioning and secret refs.
 * Each is a thin, transactional layer over a `PersistenceDriver` with O(1) indexed lookups
 * and optimistic concurrency where rows are mutable. No raw DB details leak to callers.
 */
import type { PersistenceDriver } from './driver';
import { notFound } from './errors';
import type {
  ApiKeyRow,
  AuditEventRow,
  ConfigPointerRow,
  ConfigVersionRow,
  DomainRow,
  DomainStatus,
  DomainVerificationMethod,
  FeatureFlagRow,
  LifecycleEventRow,
  ProvisioningRow,
  ProvisioningState,
  QuotaRow,
  SecretRefRow,
} from './records';
import { TABLES } from './schema';
import { assertVersion, bump, secureId } from './util';
import type { TenantConfiguration, TenantLimits, TenantStatus } from '../types';

/* ------------------------------- domains ---------------------------------- */

export interface IDomainRepository {
  create(input: { tenantId: string; hostname: string; kind: 'subdomain' | 'custom'; method: DomainVerificationMethod; token: string; actor?: string }): DomainRow;
  getById(id: string): DomainRow | null;
  getByHostname(hostname: string): DomainRow | null;
  listByTenant(tenantId: string): DomainRow[];
  setStatus(id: string, status: DomainStatus, expectedVersion: number, actor?: string): DomainRow;
  markVerified(id: string, expectedVersion: number, actor?: string): DomainRow;
  remove(id: string, expectedVersion: number, actor?: string): DomainRow;
}

const HOST = (h: string) => h.trim().toLowerCase().replace(/\.$/, '');

export class DomainRepository implements IDomainRepository {
  constructor(private readonly db: PersistenceDriver, private readonly clock: () => number = () => Date.now()) {}

  create(input: { tenantId: string; hostname: string; kind: 'subdomain' | 'custom'; method: DomainVerificationMethod; token: string; actor?: string }): DomainRow {
    const now = this.clock();
    const row: DomainRow = {
      id: secureId('dom'), tenantId: input.tenantId, hostname: HOST(input.hostname), kind: input.kind,
      status: 'pending-verification', verificationMethod: input.method, verificationToken: input.token,
      createdAt: now, updatedAt: now, createdBy: input.actor, updatedBy: input.actor, version: 1,
    };
    return this.db.transaction(() => this.db.insert(TABLES.domains, row));
  }
  getById(id: string): DomainRow | null {
    return this.db.get<DomainRow>(TABLES.domains, id);
  }
  getByHostname(hostname: string): DomainRow | null {
    return this.db.oneByIndex<DomainRow>(TABLES.domains, 'domains_hostname_uq', HOST(hostname));
  }
  listByTenant(tenantId: string): DomainRow[] {
    return this.db.byIndex<DomainRow>(TABLES.domains, 'domains_tenant', tenantId);
  }
  private mustGet(id: string): DomainRow {
    const row = this.getById(id);
    if (!row) throw notFound('domain', id);
    return row;
  }
  setStatus(id: string, status: DomainStatus, expectedVersion: number, actor?: string): DomainRow {
    return this.db.transaction(() => {
      const row = this.mustGet(id);
      assertVersion('domain', row, expectedVersion);
      return this.db.update(TABLES.domains, bump(row, { status }, this.clock(), actor));
    });
  }
  markVerified(id: string, expectedVersion: number, actor?: string): DomainRow {
    return this.db.transaction(() => {
      const row = this.mustGet(id);
      assertVersion('domain', row, expectedVersion);
      return this.db.update(TABLES.domains, bump(row, { status: 'verified', verifiedAt: this.clock() }, this.clock(), actor));
    });
  }
  remove(id: string, expectedVersion: number, actor?: string): DomainRow {
    return this.setStatus(id, 'removed', expectedVersion, actor);
  }
}

/* ------------------------------- api keys --------------------------------- */

export interface IApiKeyRepository {
  create(input: { tenantId: string; prefix: string; hash: string; name: string; scopes: string[]; expiresAt?: number; actor?: string }): ApiKeyRow;
  getById(id: string): ApiKeyRow | null;
  getByPrefix(prefix: string): ApiKeyRow | null;
  getByHash(hash: string): ApiKeyRow | null;
  listByTenant(tenantId: string): ApiKeyRow[];
  revoke(id: string, expectedVersion: number, actor?: string): ApiKeyRow;
  touchLastUsed(id: string): void;
}

export class ApiKeyRepository implements IApiKeyRepository {
  constructor(private readonly db: PersistenceDriver, private readonly clock: () => number = () => Date.now()) {}

  create(input: { tenantId: string; prefix: string; hash: string; name: string; scopes: string[]; expiresAt?: number; actor?: string }): ApiKeyRow {
    const now = this.clock();
    const row: ApiKeyRow = {
      id: secureId('akrow'), tenantId: input.tenantId, prefix: input.prefix, hash: input.hash, name: input.name,
      scopes: [...input.scopes], expiresAt: input.expiresAt,
      createdAt: now, updatedAt: now, createdBy: input.actor, updatedBy: input.actor, version: 1,
    };
    return this.db.transaction(() => this.db.insert(TABLES.apiKeys, row));
  }
  getById(id: string): ApiKeyRow | null {
    return this.db.get<ApiKeyRow>(TABLES.apiKeys, id);
  }
  getByPrefix(prefix: string): ApiKeyRow | null {
    return this.db.oneByIndex<ApiKeyRow>(TABLES.apiKeys, 'apikeys_prefix_uq', prefix);
  }
  getByHash(hash: string): ApiKeyRow | null {
    return this.db.oneByIndex<ApiKeyRow>(TABLES.apiKeys, 'apikeys_hash_uq', hash);
  }
  listByTenant(tenantId: string): ApiKeyRow[] {
    return this.db.byIndex<ApiKeyRow>(TABLES.apiKeys, 'apikeys_tenant', tenantId);
  }
  revoke(id: string, expectedVersion: number, actor?: string): ApiKeyRow {
    return this.db.transaction(() => {
      const row = this.db.get<ApiKeyRow>(TABLES.apiKeys, id);
      if (!row) throw notFound('api key', id);
      assertVersion('api key', row, expectedVersion);
      return this.db.update(TABLES.apiKeys, bump(row, { revokedAt: this.clock() }, this.clock(), actor));
    });
  }
  /** Best-effort last-used stamp (no version check — telemetry, not a mutation of intent). */
  touchLastUsed(id: string): void {
    const row = this.db.get<ApiKeyRow>(TABLES.apiKeys, id);
    if (row) this.db.update(TABLES.apiKeys, { ...row, lastUsedAt: this.clock() });
  }
}

/* ---------------------------- configuration ------------------------------- */

export interface IConfigurationRepository {
  createVersion(input: { tenantId: string; config: TenantConfiguration; reason?: string; actor?: string }): ConfigVersionRow;
  getVersion(tenantId: string, version: number): ConfigVersionRow | null;
  listVersions(tenantId: string): ConfigVersionRow[];
  getActiveVersion(tenantId: string): number | null;
  setActiveVersion(tenantId: string, version: number, expectedPointerVersion: number | null, actor?: string): ConfigPointerRow;
  getPointer(tenantId: string): ConfigPointerRow | null;
}

export class ConfigurationRepository implements IConfigurationRepository {
  constructor(private readonly db: PersistenceDriver, private readonly clock: () => number = () => Date.now()) {}

  createVersion(input: { tenantId: string; config: TenantConfiguration; reason?: string; actor?: string }): ConfigVersionRow {
    return this.db.transaction(() => {
      const versions = this.listVersions(input.tenantId);
      const nextVersion = versions.reduce((m, v) => Math.max(m, v.version), 0) + 1;
      const row: ConfigVersionRow = {
        id: `${input.tenantId}:v${nextVersion}`, tenantId: input.tenantId, version: nextVersion,
        config: input.config, createdAt: this.clock(), createdBy: input.actor, reason: input.reason,
      };
      return this.db.insert(TABLES.configurationVersions, row);
    });
  }
  getVersion(tenantId: string, version: number): ConfigVersionRow | null {
    return this.db.get<ConfigVersionRow>(TABLES.configurationVersions, `${tenantId}:v${version}`);
  }
  listVersions(tenantId: string): ConfigVersionRow[] {
    return this.db.byIndex<ConfigVersionRow>(TABLES.configurationVersions, 'configver_tenant', tenantId).sort((a, b) => a.version - b.version);
  }
  getPointer(tenantId: string): ConfigPointerRow | null {
    return this.db.oneByIndex<ConfigPointerRow>(TABLES.configurations, 'config_tenant_uq', tenantId);
  }
  getActiveVersion(tenantId: string): number | null {
    return this.getPointer(tenantId)?.activeVersion ?? null;
  }
  setActiveVersion(tenantId: string, version: number, expectedPointerVersion: number | null, actor?: string): ConfigPointerRow {
    return this.db.transaction(() => {
      if (!this.getVersion(tenantId, version)) throw notFound('configuration version', `${tenantId}:v${version}`);
      const existing = this.getPointer(tenantId);
      const now = this.clock();
      if (!existing) {
        const row: ConfigPointerRow = { id: secureId('cfgptr'), tenantId, activeVersion: version, createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor, version: 1 };
        return this.db.insert(TABLES.configurations, row);
      }
      assertVersion('configuration pointer', existing, expectedPointerVersion ?? existing.version);
      return this.db.update(TABLES.configurations, bump(existing, { activeVersion: version }, now, actor));
    });
  }
}

/* ----------------------------- feature flags ------------------------------ */

export interface IFeatureFlagRepository {
  setGlobalRule(flag: string, rule: NonNullable<FeatureFlagRow['rule']>, actor?: string): FeatureFlagRow;
  setTenantOverride(tenantId: string, flag: string, enabled: boolean, actor?: string): FeatureFlagRow;
  clearTenantOverride(tenantId: string, flag: string): void;
  getGlobalRule(flag: string): FeatureFlagRow | null;
  getTenantOverride(tenantId: string, flag: string): FeatureFlagRow | null;
  listGlobal(): FeatureFlagRow[];
  listTenant(tenantId: string): FeatureFlagRow[];
}

export class FeatureFlagRepository implements IFeatureFlagRepository {
  constructor(private readonly db: PersistenceDriver, private readonly clock: () => number = () => Date.now()) {}

  private upsert(id: string, scope: string, flag: string, patch: Partial<FeatureFlagRow>, actor?: string): FeatureFlagRow {
    return this.db.transaction(() => {
      const existing = this.db.get<FeatureFlagRow>(TABLES.featureFlags, id);
      const now = this.clock();
      if (!existing) {
        const row: FeatureFlagRow = { id, scope, flag, createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor, version: 1, ...patch };
        return this.db.insert(TABLES.featureFlags, row);
      }
      return this.db.update(TABLES.featureFlags, bump(existing, patch, now, actor));
    });
  }
  setGlobalRule(flag: string, rule: NonNullable<FeatureFlagRow['rule']>, actor?: string): FeatureFlagRow {
    return this.upsert(`global:${flag}`, 'global', flag, { rule }, actor);
  }
  setTenantOverride(tenantId: string, flag: string, enabled: boolean, actor?: string): FeatureFlagRow {
    return this.upsert(`${tenantId}:${flag}`, tenantId, flag, { enabled }, actor);
  }
  clearTenantOverride(tenantId: string, flag: string): void {
    this.db.transaction(() => this.db.remove(TABLES.featureFlags, `${tenantId}:${flag}`));
  }
  getGlobalRule(flag: string): FeatureFlagRow | null {
    return this.db.get<FeatureFlagRow>(TABLES.featureFlags, `global:${flag}`);
  }
  getTenantOverride(tenantId: string, flag: string): FeatureFlagRow | null {
    return this.db.get<FeatureFlagRow>(TABLES.featureFlags, `${tenantId}:${flag}`);
  }
  listGlobal(): FeatureFlagRow[] {
    return this.db.byIndex<FeatureFlagRow>(TABLES.featureFlags, 'flags_scope', 'global');
  }
  listTenant(tenantId: string): FeatureFlagRow[] {
    return this.db.byIndex<FeatureFlagRow>(TABLES.featureFlags, 'flags_scope', tenantId);
  }
}

/* -------------------------------- quotas ---------------------------------- */

export class QuotaRepository {
  constructor(private readonly db: PersistenceDriver, private readonly clock: () => number = () => Date.now()) {}

  upsert(tenantId: string, limits: TenantLimits, actor?: string): QuotaRow {
    return this.db.transaction(() => {
      const existing = this.db.oneByIndex<QuotaRow>(TABLES.quotas, 'quotas_tenant_uq', tenantId);
      const now = this.clock();
      if (!existing) {
        const row: QuotaRow = { id: secureId('quota'), tenantId, limits, createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor, version: 1 };
        return this.db.insert(TABLES.quotas, row);
      }
      return this.db.update(TABLES.quotas, bump(existing, { limits }, now, actor));
    });
  }
  get(tenantId: string): QuotaRow | null {
    return this.db.oneByIndex<QuotaRow>(TABLES.quotas, 'quotas_tenant_uq', tenantId);
  }
}

/* ---------------------------- lifecycle events ---------------------------- */

export class LifecycleRepository {
  constructor(private readonly db: PersistenceDriver, private readonly clock: () => number = () => Date.now()) {}

  append(input: { tenantId: string; from: TenantStatus | null; to: TenantStatus; actorId?: string; reason?: string }): LifecycleEventRow {
    const row: LifecycleEventRow = { id: secureId('lce'), ...input, at: this.clock() };
    return this.db.transaction(() => this.db.insert(TABLES.lifecycleEvents, row));
  }
  listByTenant(tenantId: string): LifecycleEventRow[] {
    return this.db.byIndex<LifecycleEventRow>(TABLES.lifecycleEvents, 'lifecycle_tenant', tenantId).sort((a, b) => a.at - b.at);
  }
}

/* ------------------------------- audit ------------------------------------ */

export class AuditRepository {
  constructor(private readonly db: PersistenceDriver, private readonly clock: () => number = () => Date.now()) {}

  append(event: Omit<AuditEventRow, 'id' | 'at'> & { at?: number }): AuditEventRow {
    const row: AuditEventRow = { id: secureId('aud'), at: event.at ?? this.clock(), ...event };
    // Audit is append-only/immutable — inserted, never updated.
    return this.db.transaction(() => this.db.insert(TABLES.auditEvents, row));
  }
  listByTenant(tenantId: string): AuditEventRow[] {
    return this.db.byIndex<AuditEventRow>(TABLES.auditEvents, 'audit_tenant', tenantId).sort((a, b) => a.at - b.at);
  }
  listByAction(action: string): AuditEventRow[] {
    return this.db.byIndex<AuditEventRow>(TABLES.auditEvents, 'audit_action', action).sort((a, b) => a.at - b.at);
  }
  all(): AuditEventRow[] {
    return this.db.all<AuditEventRow>(TABLES.auditEvents).sort((a, b) => a.at - b.at);
  }
}

/* ---------------------------- provisioning -------------------------------- */

export class ProvisioningRepository {
  constructor(private readonly db: PersistenceDriver, private readonly clock: () => number = () => Date.now()) {}

  start(input: { tenantId: string; idempotencyKey: string; actor?: string }): ProvisioningRow {
    const now = this.clock();
    const row: ProvisioningRow = {
      id: secureId('prov'), tenantId: input.tenantId, idempotencyKey: input.idempotencyKey, state: 'started', completedSteps: [],
      createdAt: now, updatedAt: now, createdBy: input.actor, updatedBy: input.actor, version: 1,
    };
    return this.db.transaction(() => this.db.insert(TABLES.provisioning, row));
  }
  getByIdempotencyKey(key: string): ProvisioningRow | null {
    return this.db.oneByIndex<ProvisioningRow>(TABLES.provisioning, 'provisioning_idem_uq', key);
  }
  advance(id: string, state: ProvisioningState, step: string, actor?: string): ProvisioningRow {
    return this.db.transaction(() => {
      const row = this.db.get<ProvisioningRow>(TABLES.provisioning, id);
      if (!row) throw notFound('provisioning', id);
      const completedSteps = row.completedSteps.includes(step) ? row.completedSteps : [...row.completedSteps, step];
      return this.db.update(TABLES.provisioning, bump(row, { state, completedSteps }, this.clock(), actor));
    });
  }
  fail(id: string, error: string, actor?: string): ProvisioningRow {
    return this.db.transaction(() => {
      const row = this.db.get<ProvisioningRow>(TABLES.provisioning, id);
      if (!row) throw notFound('provisioning', id);
      return this.db.update(TABLES.provisioning, bump(row, { state: 'failed', error }, this.clock(), actor));
    });
  }
}

/* ----------------------------- secret refs -------------------------------- */

export class SecretRefRepository {
  constructor(private readonly db: PersistenceDriver, private readonly clock: () => number = () => Date.now()) {}

  put(input: { tenantId: string; path: string; reference: string; rotationOf?: string; actor?: string }): SecretRefRow {
    return this.db.transaction(() => {
      const existing = this.db.oneByIndex<SecretRefRow>(TABLES.secretRefs, 'secretrefs_path_uq', input.path);
      const now = this.clock();
      if (!existing) {
        const row: SecretRefRow = { id: secureId('sref'), tenantId: input.tenantId, path: input.path, reference: input.reference, rotationOf: input.rotationOf, createdAt: now, updatedAt: now, createdBy: input.actor, updatedBy: input.actor, version: 1 };
        return this.db.insert(TABLES.secretRefs, row);
      }
      return this.db.update(TABLES.secretRefs, bump(existing, { reference: input.reference, rotationOf: input.rotationOf }, now, input.actor));
    });
  }
  get(path: string): SecretRefRow | null {
    return this.db.oneByIndex<SecretRefRow>(TABLES.secretRefs, 'secretrefs_path_uq', path);
  }
  listByTenant(tenantId: string): SecretRefRow[] {
    return this.db.byIndex<SecretRefRow>(TABLES.secretRefs, 'secretrefs_tenant', tenantId);
  }
}
