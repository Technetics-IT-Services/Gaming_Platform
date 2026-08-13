/**
 * Persistent row types for the tenant control plane (Phase 3.2, STEP 1).
 *
 * These are the durable shapes stored in the (abstracted) database. Every row carries
 * ownership + audit columns (`tenant_id`, `created_at`, `updated_at`, `created_by`,
 * `updated_by`, `version`) where applicable. They map 1:1 to the tables described in
 * `schema.ts` / `docs/TENANT_DATABASE.md`. Additive; no frozen module referenced.
 */
import type {
  BrandConfiguration,
  TenantConfiguration,
  TenantLimits,
  TenantMetadata,
  TenantPlan,
  TenantRegion,
  TenantStatus,
  ThemeConfiguration,
} from '../types';

/** Columns shared by every mutable, versioned row. */
export interface BaseRow {
  id: string;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  updatedBy?: string;
  /** Optimistic-concurrency token; bumped on every write. */
  version: number;
}

/** `tenants` */
export interface TenantRow extends BaseRow {
  code: string; // unique
  name: string;
  operatorId: string;
  status: TenantStatus;
  plan: TenantPlan;
  region: TenantRegion;
  timezone: string;
  currency: string;
  locale: string;
  brand: BrandConfiguration;
  theme: ThemeConfiguration;
  limits: TenantLimits;
  metadata: TenantMetadata;
  provisionedAt?: number;
  activatedAt?: number;
  suspendedAt?: number;
  archivedAt?: number;
  deletedAt?: number;
}

export type DomainStatus = 'pending-verification' | 'verified' | 'active' | 'suspended' | 'removed';
export type DomainVerificationMethod = 'dns-txt' | 'dns-cname' | 'http';

/** `tenant_domains` */
export interface DomainRow extends BaseRow {
  tenantId: string;
  hostname: string; // normalized, unique among non-removed rows
  kind: 'subdomain' | 'custom';
  status: DomainStatus;
  verificationMethod: DomainVerificationMethod;
  verificationToken: string;
  verifiedAt?: number;
}

/** `tenant_api_keys` — NEVER stores the plaintext secret. */
export interface ApiKeyRow extends BaseRow {
  tenantId: string;
  prefix: string; // e.g. tk_live_ab12cd — safe to display/log
  hash: string; // sha-256 of the full secret
  name: string;
  scopes: string[];
  expiresAt?: number;
  revokedAt?: number;
  lastUsedAt?: number;
}

/** `tenant_configurations` — pointer to the active version. */
export interface ConfigPointerRow extends BaseRow {
  tenantId: string; // unique
  activeVersion: number;
}

/** `tenant_configuration_versions` — immutable snapshots. */
export interface ConfigVersionRow {
  id: string; // `${tenantId}:v${version}`
  tenantId: string;
  version: number; // monotonically increasing per tenant
  config: TenantConfiguration;
  createdAt: number;
  createdBy?: string;
  reason?: string;
}

/** `tenant_feature_flags` — one row per (tenant, flag) override + global rules. */
export interface FeatureFlagRow extends BaseRow {
  id: string; // `${scope}:${flag}` where scope is 'global' or a tenantId
  scope: 'global' | string; // 'global' or tenantId
  flag: string;
  /** For a tenant scope: the explicit override. For global: the rule payload. */
  enabled?: boolean;
  rule?: {
    default?: boolean;
    plans?: Partial<Record<TenantPlan, boolean>>;
    rolloutPercentage?: number;
    operatorAllowList?: string[];
    killSwitch?: boolean;
  };
}

/** `tenant_quotas` — per-tenant limit overrides (the source of truth is the tenant row). */
export interface QuotaRow extends BaseRow {
  tenantId: string; // unique
  limits: TenantLimits;
}

/** `tenant_lifecycle_events` — append-only. */
export interface LifecycleEventRow {
  id: string;
  tenantId: string;
  from: TenantStatus | null;
  to: TenantStatus;
  actorId?: string;
  reason?: string;
  at: number;
}

/** `tenant_audit_events` — append-only, immutable. */
export interface AuditEventRow {
  id: string;
  tenantId?: string;
  actorId?: string;
  actorType: 'platform' | 'tenant' | 'system';
  action: string;
  resource: string;
  resourceId?: string;
  at: number;
  requestId?: string;
  correlationId?: string;
  reference?: string; // ip / source
  before?: unknown;
  after?: unknown;
  result: 'allow' | 'deny' | 'success' | 'failure';
  reason?: string;
  metadata?: Record<string, unknown>;
}

/** `tenant_provisioning` — idempotent workflow state. */
export type ProvisioningState = 'started' | 'record-created' | 'configured' | 'flagged' | 'quota-set' | 'namespaced' | 'provisioned' | 'activated' | 'failed';

export interface ProvisioningRow extends BaseRow {
  tenantId: string;
  idempotencyKey: string; // unique
  state: ProvisioningState;
  completedSteps: string[];
  error?: string;
}

/** `tenant_secret_refs` — references only; NEVER plaintext secrets. */
export interface SecretRefRow extends BaseRow {
  tenantId: string;
  path: string; // tenant/{tenantId}/{namespace}/{name}
  reference: string; // opaque handle in the external SecretManager
  rotationOf?: string; // previous ref id on rotation
}
