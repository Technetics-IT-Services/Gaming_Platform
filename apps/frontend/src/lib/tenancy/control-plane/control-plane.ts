/**
 * Tenant Control Plane (Phase 3.2, STEP 15, 17, 18, 20).
 *
 * The single facade for all administrative tenant operations. It composes the persistent
 * registry, configuration, feature-flag, domain, api-key, secret, provisioning, lifecycle,
 * quota and audit services, and enforces the security triad — tenant context + authorization
 * + resource ownership — on every mutating call, auditing denials and timing every operation.
 * Resolution + context building are persistence-backed and O(1). Additive; moves no money and
 * never modifies a frozen module.
 */
import { buildTenantContext } from '../context';
import { ResourceNamespace } from '../isolation';
import {
  InMemoryPersistenceDriver,
  type PersistenceDriver,
  applySchema,
  TABLE_INDEXES,
} from '../persistence';
import {
  ApiKeyRepository,
  AuditRepository,
  ConfigurationRepository,
  DomainRepository,
  FeatureFlagRepository,
  LifecycleRepository,
  ProvisioningRepository,
  QuotaRepository,
  SecretRefRepository,
} from '../persistence/repositories';
import { TenantRepository } from '../persistence/tenant-repository';
import { forbidden } from '../persistence/errors';
import {
  type TenantConfiguration,
  type TenantContext,
  type TenantLimits,
  type TenantPlan,
  type TenantResolutionInput,
  TenantResolutionSource,
  TenantStatus,
} from '../types';

import { AuditService } from './audit-service';
import { ApiKeyService } from './api-key-service';
import { ConfigurationService } from './configuration-service';
import { ControlPlaneCache } from './cache';
import { ControlPlaneObservability, type ControlPlaneSink } from './observability';
import { DomainService, MockDomainVerificationProvider, type DomainVerificationProvider } from './domain-service';
import { FeatureFlagService } from './feature-flag-service';
import { LifecycleService } from './lifecycle-service';
import { PersistentTenantRegistry } from './persistent-registry';
import { ProvisioningService, type ProvisionInput } from './provisioning-service';
import { SecretNamespaceService, InMemorySecretManager, type SecretManagerPort } from './secret-namespace-service';
import {
  authorize,
  type ControlPlaneAuth,
  ControlPlanePermission,
} from './rbac';
import { correlationId } from './crypto';

export interface ControlPlaneOptions {
  driver?: PersistenceDriver;
  clock?: () => number;
  environment?: string;
  secretManager?: SecretManagerPort;
  domainProvider?: DomainVerificationProvider;
  telemetry?: ControlPlaneSink;
}

export class TenantControlPlane {
  readonly driver: PersistenceDriver;
  readonly registry: PersistentTenantRegistry;
  readonly config: ConfigurationService;
  readonly flags: FeatureFlagService;
  readonly domains: DomainService;
  readonly apiKeys: ApiKeyService;
  readonly secrets: SecretNamespaceService;
  readonly lifecycle: LifecycleService;
  readonly provisioning: ProvisioningService;
  readonly audit: AuditService;
  readonly quotas: QuotaRepository;
  readonly cache: ControlPlaneCache;
  readonly observability: ControlPlaneObservability;
  private readonly tenantRepo: TenantRepository;
  private readonly apiKeyRepo: ApiKeyRepository;
  private readonly domainRepo: DomainRepository;
  private readonly environment: string;
  private readonly clock: () => number;

  constructor(opts: ControlPlaneOptions = {}) {
    this.clock = opts.clock ?? (() => Date.now());
    this.environment = opts.environment ?? 'production';
    this.driver = opts.driver ?? new InMemoryPersistenceDriver();
    applySchema(this.driver);
    this.cache = new ControlPlaneCache();
    this.observability = new ControlPlaneObservability(opts.telemetry, this.clock);

    const auditRepo = new AuditRepository(this.driver, this.clock);
    this.audit = new AuditService(auditRepo);

    this.tenantRepo = new TenantRepository(this.driver, this.clock);
    this.domainRepo = new DomainRepository(this.driver, this.clock);
    this.apiKeyRepo = new ApiKeyRepository(this.driver, this.clock);
    const configRepo = new ConfigurationRepository(this.driver, this.clock);
    const flagRepo = new FeatureFlagRepository(this.driver, this.clock);
    this.quotas = new QuotaRepository(this.driver, this.clock);
    const lifecycleRepo = new LifecycleRepository(this.driver, this.clock);
    const provRepo = new ProvisioningRepository(this.driver, this.clock);
    const secretRepo = new SecretRefRepository(this.driver, this.clock);

    this.config = new ConfigurationService(configRepo, undefined, this.cache);
    this.flags = new FeatureFlagService(flagRepo, this.audit, this.cache);
    this.domains = new DomainService(this.domainRepo, opts.domainProvider ?? new MockDomainVerificationProvider(), this.audit);
    this.apiKeys = new ApiKeyService(this.apiKeyRepo, this.audit, this.clock);
    this.secrets = new SecretNamespaceService(secretRepo, opts.secretManager ?? new InMemorySecretManager(), this.audit);
    this.lifecycle = new LifecycleService(this.driver, this.tenantRepo, lifecycleRepo, this.audit);
    this.registry = new PersistentTenantRegistry(this.tenantRepo, this.config, flagRepo, this.domainRepo, this.apiKeyRepo, this.lifecycle, this.clock);
    this.provisioning = new ProvisioningService(this.driver, provRepo, this.tenantRepo, this.config, this.quotas, this.lifecycle, this.audit);
  }

  /* ------------------------------- authorization -------------------------- */

  /** Enforce the security triad, audit denials, and time the operation. */
  private guarded<T>(auth: ControlPlaneAuth, permission: ControlPlanePermission, resourceTenantId: string | undefined, operation: string, fn: () => T): T {
    const decision = authorize(auth, permission, resourceTenantId);
    const cor = correlationId();
    if (!decision.allowed) {
      this.audit.record({ tenantId: resourceTenantId, actorId: auth.actorId, actorType: auth.actorType, action: operation, resource: 'control-plane', resourceId: resourceTenantId, result: 'deny', reason: decision.reason, correlationId: cor });
      throw forbidden(decision.reason ?? 'denied', { permission, operation });
    }
    const started = this.clock();
    try {
      const out = fn();
      this.observability.record({ operation, tenantId: resourceTenantId, requestId: auth.actorId, correlationId: cor, durationMs: this.clock() - started, result: 'success' });
      return out;
    } catch (err) {
      this.observability.record({ operation, tenantId: resourceTenantId, requestId: auth.actorId, correlationId: cor, durationMs: this.clock() - started, result: 'failure', error: (err as Error).message });
      if ((err as { code?: string }).code === 'CONFLICT') this.observability.increment('concurrency.conflict');
      throw err;
    }
  }

  /* --------------------------------- tenants ------------------------------ */

  provisionTenant(auth: ControlPlaneAuth, input: ProvisionInput) {
    return this.guarded(auth, ControlPlanePermission.TenantCreate, undefined, 'tenant.provision', () => {
      const result = this.provisioning.provision({ ...input, actor: input.actor ?? auth.actorId });
      if (!result.reused) this.observability.increment('tenant.created');
      return { ...result, tenant: this.registry.hydrate(result.tenant) };
    });
  }

  getTenant(auth: ControlPlaneAuth, id: string) {
    return this.guarded(auth, ControlPlanePermission.TenantRead, id, 'tenant.read', () => this.registry.getTenant(id));
  }
  listTenants(auth: ControlPlaneAuth) {
    return this.guarded(auth, ControlPlanePermission.TenantRead, undefined, 'tenant.list', () => this.registry.listTenants());
  }
  searchTenants(auth: ControlPlaneAuth, query: Parameters<PersistentTenantRegistry['searchTenants']>[0]) {
    return this.guarded(auth, ControlPlanePermission.TenantRead, undefined, 'tenant.search', () => this.registry.searchTenants(query));
  }
  updateTenant(auth: ControlPlaneAuth, id: string, patch: Parameters<PersistentTenantRegistry['updateTenant']>[1], expectedVersion: number) {
    return this.guarded(auth, ControlPlanePermission.TenantUpdate, id, 'tenant.update', () => this.registry.updateTenant(id, patch, expectedVersion, auth.actorId));
  }
  suspendTenant(auth: ControlPlaneAuth, id: string) {
    return this.guarded(auth, ControlPlanePermission.TenantLifecycle, id, 'tenant.suspend', () => { this.observability.increment('lifecycle.transition'); return this.registry.suspendTenant(id, auth.actorId); });
  }
  restoreTenant(auth: ControlPlaneAuth, id: string) {
    return this.guarded(auth, ControlPlanePermission.TenantLifecycle, id, 'tenant.restore', () => { this.observability.increment('lifecycle.transition'); return this.registry.restoreTenant(id, auth.actorId); });
  }
  archiveTenant(auth: ControlPlaneAuth, id: string) {
    return this.guarded(auth, ControlPlanePermission.TenantLifecycle, id, 'tenant.archive', () => { this.observability.increment('lifecycle.transition'); return this.registry.archiveTenant(id, auth.actorId); });
  }
  deleteTenant(auth: ControlPlaneAuth, id: string) {
    return this.guarded(auth, ControlPlanePermission.TenantLifecycle, id, 'tenant.delete', () => { this.observability.increment('lifecycle.transition'); this.cache.invalidateTenant(id); return this.registry.deleteTenant(id, auth.actorId); });
  }
  health(auth: ControlPlaneAuth, id: string) {
    return this.guarded(auth, ControlPlanePermission.TenantRead, id, 'tenant.health', () => this.registry.health(id));
  }

  /* ------------------------------ configuration --------------------------- */

  createConfigVersion(auth: ControlPlaneAuth, tenantId: string, config: TenantConfiguration, reason?: string) {
    return this.guarded(auth, ControlPlanePermission.ConfigWrite, tenantId, 'config.version.create', () => { this.observability.increment('config.changed'); return this.config.createVersion(tenantId, config, { reason, actor: auth.actorId }); });
  }
  rollbackConfig(auth: ControlPlaneAuth, tenantId: string, toVersion: number) {
    return this.guarded(auth, ControlPlanePermission.ConfigRollback, tenantId, 'config.rollback', () => {
      this.config.rollback(tenantId, toVersion, auth.actorId);
      this.audit.record({ tenantId, actorId: auth.actorId, action: 'config.rollback', resource: 'configuration', resourceId: tenantId, after: { version: toVersion } });
    });
  }
  effectiveConfig(auth: ControlPlaneAuth, tenantId: string, input?: Parameters<ConfigurationService['effective']>[1]) {
    return this.guarded(auth, ControlPlanePermission.ConfigRead, tenantId, 'config.effective', () => this.config.effective(tenantId, input));
  }

  /* ------------------------------- feature flags -------------------------- */

  setTenantFlag(auth: ControlPlaneAuth, tenantId: string, flag: string, enabled: boolean) {
    return this.guarded(auth, ControlPlanePermission.FlagWrite, tenantId, 'flag.tenant.set', () => this.flags.setTenantOverride(tenantId, flag, enabled, auth.actorId));
  }
  setGlobalFlag(auth: ControlPlaneAuth, flag: string, rule: Parameters<FeatureFlagService['setGlobalRule']>[1]) {
    return this.guarded(auth, ControlPlanePermission.FlagWrite, undefined, 'flag.global.set', () => this.flags.setGlobalRule(flag, rule, auth.actorId));
  }
  isFlagEnabled(auth: ControlPlaneAuth, tenantId: string, flag: string, ctx: { operatorId?: string; plan?: TenantPlan }) {
    return this.guarded(auth, ControlPlanePermission.FlagRead, tenantId, 'flag.read', () => this.flags.isEnabled(flag, { tenantId, ...ctx }));
  }

  /* --------------------------------- quotas ------------------------------- */

  setQuota(auth: ControlPlaneAuth, tenantId: string, limits: TenantLimits) {
    return this.guarded(auth, ControlPlanePermission.QuotaWrite, tenantId, 'quota.set', () => this.quotas.upsert(tenantId, limits, auth.actorId));
  }
  getQuota(auth: ControlPlaneAuth, tenantId: string) {
    return this.guarded(auth, ControlPlanePermission.QuotaRead, tenantId, 'quota.read', () => this.quotas.get(tenantId));
  }

  /* --------------------------------- domains ------------------------------ */

  addDomain(auth: ControlPlaneAuth, tenantId: string, hostname: string, kind: 'subdomain' | 'custom' = 'custom') {
    return this.guarded(auth, ControlPlanePermission.DomainManage, tenantId, 'domain.add', () => this.domains.createDomain({ tenantId, hostname, kind, actor: auth.actorId }));
  }
  async verifyDomain(auth: ControlPlaneAuth, tenantId: string, domainId: string) {
    return this.guarded(auth, ControlPlanePermission.DomainManage, tenantId, 'domain.verify', () => this.domains.verifyDomain(domainId, auth.actorId).catch((e) => { this.observability.increment('domain.verification.failed'); throw e; }));
  }
  activateDomain(auth: ControlPlaneAuth, tenantId: string, domainId: string) {
    return this.guarded(auth, ControlPlanePermission.DomainManage, tenantId, 'domain.activate', () => this.domains.activateDomain(domainId, auth.actorId));
  }
  listDomains(auth: ControlPlaneAuth, tenantId: string) {
    return this.guarded(auth, ControlPlanePermission.DomainRead, tenantId, 'domain.list', () => this.domains.listDomains(tenantId));
  }

  /* -------------------------------- api keys ------------------------------ */

  issueApiKey(auth: ControlPlaneAuth, tenantId: string, input: { name: string; scopes?: string[]; expiresAt?: number; env?: 'live' | 'test' }) {
    return this.guarded(auth, ControlPlanePermission.ApiKeyManage, tenantId, 'apikey.issue', () => { this.observability.increment('apikey.created'); return this.apiKeys.issue({ tenantId, actor: auth.actorId, ...input }); });
  }
  revokeApiKey(auth: ControlPlaneAuth, tenantId: string, keyId: string) {
    return this.guarded(auth, ControlPlanePermission.ApiKeyManage, tenantId, 'apikey.revoke', () => { this.observability.increment('apikey.revoked'); return this.apiKeys.revoke(keyId, auth.actorId); });
  }
  listApiKeys(auth: ControlPlaneAuth, tenantId: string) {
    return this.guarded(auth, ControlPlanePermission.ApiKeyRead, tenantId, 'apikey.list', () => this.apiKeys.list(tenantId));
  }

  /* -------------------------------- secrets ------------------------------- */

  setSecret(auth: ControlPlaneAuth, tenantId: string, namespace: string, name: string, value: string) {
    return this.guarded(auth, ControlPlanePermission.SecretManage, tenantId, 'secret.set', () => this.secrets.setSecret({ tenantId, namespace, name, value, actor: auth.actorId }));
  }

  /* ------------------------------- resolution ----------------------------- */

  /** Persistence-backed tenant resolution (all lookups O(1) via indexes). */
  resolve(input: TenantResolutionInput, opts: { requireActive?: boolean } = {}): { tenantId: string; source: TenantResolutionSource } | null {
    const requireActive = opts.requireActive ?? true;
    const internal = (id: string, source: TenantResolutionSource) => ({ tenantId: id, source, internal: true });
    let hit: { tenantId: string; source: TenantResolutionSource; internal?: boolean } | null = null;

    if (input.internalTenantId) {
      const row = this.tenantRepo.getById(input.internalTenantId) ?? this.tenantRepo.getByCode(input.internalTenantId);
      if (row) hit = internal(row.id, input.source ?? TenantResolutionSource.InternalContext);
    }
    if (!hit && (input.apiKey || input.headers?.['x-api-key'])) {
      const verified = this.apiKeys.verify((input.apiKey ?? input.headers?.['x-api-key'])!);
      if (verified) hit = { tenantId: verified.tenantId, source: TenantResolutionSource.ApiKey };
    }
    if (!hit && typeof input.jwtClaims?.['tid'] === 'string') {
      const row = this.tenantRepo.getById(input.jwtClaims['tid'] as string) ?? this.tenantRepo.getByCode(input.jwtClaims['tid'] as string);
      if (row) hit = { tenantId: row.id, source: TenantResolutionSource.JwtClaim };
    }
    if (!hit && input.headers?.['x-tenant-id']) {
      const v = input.headers['x-tenant-id'];
      const row = this.tenantRepo.getById(v) ?? this.tenantRepo.getByCode(v);
      if (row) hit = { tenantId: row.id, source: TenantResolutionSource.Header };
    }
    if (!hit && (input.hostname ?? input.headers?.['host'])) {
      const host = (input.hostname ?? input.headers?.['host'])!.split(':')[0]!;
      const resolved = this.domains.resolveDomain(host);
      if (resolved) hit = { tenantId: resolved.tenantId, source: TenantResolutionSource.Hostname };
    }
    if (!hit && input.subdomain) {
      const row = this.tenantRepo.getByCode(input.subdomain);
      if (row) hit = { tenantId: row.id, source: TenantResolutionSource.Subdomain };
    }

    if (!hit) return null;
    if (requireActive && !hit.internal) {
      const row = this.tenantRepo.getById(hit.tenantId);
      if (!row || row.status !== TenantStatus.Active) return null;
    }
    return { tenantId: hit.tenantId, source: hit.source };
  }

  /** Resolve a request and build a full Phase 3.1 `TenantContext`. */
  buildContext(input: TenantResolutionInput, opts: { requireActive?: boolean } = {}): TenantContext | null {
    const resolved = this.resolve(input, opts);
    if (!resolved) return null;
    const row = this.tenantRepo.getById(resolved.tenantId);
    if (!row) return null;
    const tenant = this.registry.hydrate(row);
    const featureFlags = this.flags.resolveAll({ tenantId: row.id, operatorId: row.operatorId, plan: row.plan });
    const configuration = this.config.effective(row.id, { region: row.region, environment: this.environment, currency: row.currency, locale: row.locale }) ?? tenant.configuration;
    return buildTenantContext({ ...tenant, configuration }, { resolvedVia: resolved.source, operatorId: input.operatorId ?? row.operatorId, permissions: input.permissions, requestId: input.requestId, featureFlags });
  }

  /** A tenant-bound resource-namespace helper (isolation). */
  namespace(tenantId: string): ResourceNamespace {
    return new ResourceNamespace(tenantId);
  }

  /* -------------------------------- recovery ------------------------------ */

  /** Serialize durable state (survives a simulated process restart). */
  snapshot(): string {
    return (this.driver as InMemoryPersistenceDriver).snapshot();
  }

  /**
   * Rebuild a control plane from a durable snapshot — as a fresh process would on restart.
   * Caches start empty and rebuild lazily from persistence (the source of truth).
   */
  static recover(snapshot: string, opts: ControlPlaneOptions = {}): TenantControlPlane {
    const driver = InMemoryPersistenceDriver.fromSnapshot(snapshot, TABLE_INDEXES);
    return new TenantControlPlane({ ...opts, driver });
  }
}
