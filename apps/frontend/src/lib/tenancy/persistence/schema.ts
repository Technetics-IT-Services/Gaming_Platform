/**
 * Control-plane database schema + migrations (Phase 3.2, STEP 1).
 *
 * Declarative table + index definitions — the single source of truth for both the
 * in-memory driver and a production SQL/Prisma deployment (see `docs/TENANT_DATABASE.md`).
 * `MIGRATIONS` is an ordered, versioned list so a real migrator can apply them; `applySchema`
 * wires the same tables + indexes into any `PersistenceDriver`. Additive; no frozen module.
 */
import type { PersistenceDriver, IndexDef } from './driver';
import type {
  ApiKeyRow,
  AuditEventRow,
  ConfigPointerRow,
  ConfigVersionRow,
  DomainRow,
  FeatureFlagRow,
  LifecycleEventRow,
  ProvisioningRow,
  QuotaRow,
  SecretRefRow,
  TenantRow,
} from './records';

export const TABLES = {
  tenants: 'tenants',
  domains: 'tenant_domains',
  apiKeys: 'tenant_api_keys',
  configurations: 'tenant_configurations',
  configurationVersions: 'tenant_configuration_versions',
  featureFlags: 'tenant_feature_flags',
  quotas: 'tenant_quotas',
  lifecycleEvents: 'tenant_lifecycle_events',
  auditEvents: 'tenant_audit_events',
  provisioning: 'tenant_provisioning',
  secretRefs: 'tenant_secret_refs',
} as const;

/* -------------------------------- index defs -------------------------------- */

const tenantIndexes: IndexDef<TenantRow>[] = [
  { name: 'tenants_code_uq', unique: true, keyFn: (r) => r.code },
  { name: 'tenants_operator', unique: false, keyFn: (r) => r.operatorId },
];

const domainIndexes: IndexDef<DomainRow>[] = [
  // Hostname is unique among all non-removed domains (prevents cross-tenant takeover).
  { name: 'domains_hostname_uq', unique: true, keyFn: (r) => (r.status === 'removed' ? null : r.hostname) },
  { name: 'domains_tenant', unique: false, keyFn: (r) => r.tenantId },
];

const apiKeyIndexes: IndexDef<ApiKeyRow>[] = [
  { name: 'apikeys_prefix_uq', unique: true, keyFn: (r) => r.prefix },
  { name: 'apikeys_hash_uq', unique: true, keyFn: (r) => r.hash },
  { name: 'apikeys_tenant', unique: false, keyFn: (r) => r.tenantId },
];

const configPointerIndexes: IndexDef<ConfigPointerRow>[] = [
  { name: 'config_tenant_uq', unique: true, keyFn: (r) => r.tenantId },
];

const configVersionIndexes: IndexDef<ConfigVersionRow>[] = [
  { name: 'configver_tenant', unique: false, keyFn: (r) => r.tenantId },
];

const featureFlagIndexes: IndexDef<FeatureFlagRow>[] = [
  { name: 'flags_scope', unique: false, keyFn: (r) => r.scope },
  { name: 'flags_flag', unique: false, keyFn: (r) => r.flag },
];

const quotaIndexes: IndexDef<QuotaRow>[] = [
  { name: 'quotas_tenant_uq', unique: true, keyFn: (r) => r.tenantId },
];

const lifecycleIndexes: IndexDef<LifecycleEventRow>[] = [
  { name: 'lifecycle_tenant', unique: false, keyFn: (r) => r.tenantId },
];

const auditIndexes: IndexDef<AuditEventRow>[] = [
  { name: 'audit_tenant', unique: false, keyFn: (r) => r.tenantId ?? '∅' },
  { name: 'audit_action', unique: false, keyFn: (r) => r.action },
];

const provisioningIndexes: IndexDef<ProvisioningRow>[] = [
  { name: 'provisioning_idem_uq', unique: true, keyFn: (r) => r.idempotencyKey },
  { name: 'provisioning_tenant', unique: false, keyFn: (r) => r.tenantId },
];

const secretRefIndexes: IndexDef<SecretRefRow>[] = [
  { name: 'secretrefs_path_uq', unique: true, keyFn: (r) => r.path },
  { name: 'secretrefs_tenant', unique: false, keyFn: (r) => r.tenantId },
];

/** All table index defs keyed by table name (also used to rebuild a driver on recovery). */
export const TABLE_INDEXES: Record<string, IndexDef<{ id: string }>[]> = {
  [TABLES.tenants]: tenantIndexes as IndexDef<{ id: string }>[],
  [TABLES.domains]: domainIndexes as IndexDef<{ id: string }>[],
  [TABLES.apiKeys]: apiKeyIndexes as IndexDef<{ id: string }>[],
  [TABLES.configurations]: configPointerIndexes as IndexDef<{ id: string }>[],
  [TABLES.configurationVersions]: configVersionIndexes as IndexDef<{ id: string }>[],
  [TABLES.featureFlags]: featureFlagIndexes as IndexDef<{ id: string }>[],
  [TABLES.quotas]: quotaIndexes as IndexDef<{ id: string }>[],
  [TABLES.lifecycleEvents]: lifecycleIndexes as IndexDef<{ id: string }>[],
  [TABLES.auditEvents]: auditIndexes as IndexDef<{ id: string }>[],
  [TABLES.provisioning]: provisioningIndexes as IndexDef<{ id: string }>[],
  [TABLES.secretRefs]: secretRefIndexes as IndexDef<{ id: string }>[],
};

/** Wire every table + index into a driver. */
export function applySchema(driver: PersistenceDriver): void {
  for (const [table, indexes] of Object.entries(TABLE_INDEXES)) driver.defineTable(table, indexes);
}

/* -------------------------------- migrations -------------------------------- */

export interface Migration {
  version: number;
  name: string;
  /** Tables introduced/altered — documentation for a real migrator. */
  up: string[];
}

/** Ordered, versioned migration log (mirrors the SQL a production migrator would run). */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '0001_init_tenant_control_plane',
    up: [
      'CREATE TABLE tenants (id PK, code UNIQUE, name, operator_id, status, plan, region, timezone, currency, locale, brand JSONB, theme JSONB, limits JSONB, metadata JSONB, created_at, updated_at, created_by, updated_by, version, lifecycle timestamps)',
      'CREATE UNIQUE INDEX tenants_code_uq ON tenants(code)',
      'CREATE INDEX tenants_operator ON tenants(operator_id)',
      'CREATE TABLE tenant_domains (id PK, tenant_id FK, hostname, kind, status, verification_method, verification_token, verified_at, audit cols, version)',
      'CREATE UNIQUE INDEX domains_hostname_uq ON tenant_domains(hostname) WHERE status <> \'removed\'',
      'CREATE INDEX domains_tenant ON tenant_domains(tenant_id)',
      'CREATE TABLE tenant_api_keys (id PK, tenant_id FK, prefix, hash, name, scopes, expires_at, revoked_at, last_used_at, audit cols, version)',
      'CREATE UNIQUE INDEX apikeys_prefix_uq ON tenant_api_keys(prefix)',
      'CREATE UNIQUE INDEX apikeys_hash_uq ON tenant_api_keys(hash)',
      'CREATE INDEX apikeys_tenant ON tenant_api_keys(tenant_id)',
      'CREATE TABLE tenant_configurations (id PK, tenant_id UNIQUE, active_version, audit cols, version)',
      'CREATE TABLE tenant_configuration_versions (id PK, tenant_id FK, version, config JSONB, created_at, created_by, reason)',
      'CREATE INDEX configver_tenant ON tenant_configuration_versions(tenant_id)',
      'CREATE TABLE tenant_feature_flags (id PK, scope, flag, enabled, rule JSONB, audit cols, version)',
      'CREATE INDEX flags_scope ON tenant_feature_flags(scope)',
      'CREATE TABLE tenant_quotas (id PK, tenant_id UNIQUE, limits JSONB, audit cols, version)',
      'CREATE TABLE tenant_lifecycle_events (id PK, tenant_id FK, from_status, to_status, actor_id, reason, at)',
      'CREATE INDEX lifecycle_tenant ON tenant_lifecycle_events(tenant_id)',
      'CREATE TABLE tenant_audit_events (id PK, tenant_id, actor_id, actor_type, action, resource, resource_id, at, request_id, correlation_id, reference, before JSONB, after JSONB, result, reason, metadata JSONB)',
      'CREATE INDEX audit_tenant ON tenant_audit_events(tenant_id)',
      'CREATE TABLE tenant_provisioning (id PK, tenant_id FK, idempotency_key UNIQUE, state, completed_steps, error, audit cols, version)',
      'CREATE TABLE tenant_secret_refs (id PK, tenant_id FK, path UNIQUE, reference, rotation_of, audit cols, version)',
    ],
  },
];
