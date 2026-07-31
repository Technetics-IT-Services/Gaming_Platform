/**
 * Tenant Registry (Phase 3.1, STEP 2).
 *
 * The single source of truth for tenant records: create / update / archive / restore /
 * delete / lookup / search / list / health. Maintains lookup indexes (by code, domain
 * and api key) so the resolver can map any request to a tenant in O(1). Additive — owns
 * only tenant metadata; no frozen module is touched. Deterministic via an injected clock.
 */
import { defaultBrand, defaultConfiguration, defaultTheme, PLAN_LIMITS } from './defaults';
import {
  type BrandConfiguration,
  type Tenant,
  type TenantConfiguration,
  type TenantHealth,
  type TenantLimits,
  type TenantMetadata,
  TenantPlan,
  type TenantRegion,
  TenantStatus,
  type ThemeConfiguration,
} from './types';

export class TenantError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TenantError';
  }
}

export interface CreateTenantInput {
  code: string;
  name: string;
  operatorId: string;
  plan?: TenantPlan;
  region?: TenantRegion;
  timezone?: string;
  currency?: string;
  locale?: string;
  domains?: string[];
  apiKeys?: string[];
  brand?: Partial<BrandConfiguration>;
  theme?: Partial<ThemeConfiguration>;
  limits?: Partial<TenantLimits>;
  configuration?: Partial<TenantConfiguration>;
  features?: Record<string, boolean>;
  metadata?: TenantMetadata;
}

export interface UpdateTenantInput {
  name?: string;
  plan?: TenantPlan;
  region?: TenantRegion;
  timezone?: string;
  currency?: string;
  locale?: string;
  brand?: Partial<BrandConfiguration>;
  theme?: Partial<ThemeConfiguration>;
  limits?: Partial<TenantLimits>;
  configuration?: Partial<TenantConfiguration>;
  features?: Record<string, boolean>;
  metadata?: TenantMetadata;
  domains?: string[];
  apiKeys?: string[];
}

export interface TenantQuery {
  status?: TenantStatus;
  plan?: TenantPlan;
  region?: TenantRegion;
  operatorId?: string;
  /** Case-insensitive substring over code + name. */
  text?: string;
}

let COUNTER = 0;
function tenantId(): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) crypto.getRandomValues(bytes);
  COUNTER += 1;
  return `tnt_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}${COUNTER.toString(36)}`;
}

export class TenantRegistry {
  private readonly byId = new Map<string, Tenant>();
  private readonly idByCode = new Map<string, string>();
  private readonly idByDomain = new Map<string, string>();
  private readonly idByApiKey = new Map<string, string>();

  constructor(private readonly clock: () => number = () => Date.now()) {}

  /* -------------------------------- create -------------------------------- */

  create(input: CreateTenantInput): Tenant {
    const code = input.code.trim().toLowerCase();
    if (!code) throw new TenantError('INVALID_CODE', 'tenant code is required');
    if (this.idByCode.has(code)) throw new TenantError('DUPLICATE_CODE', `tenant code "${code}" already exists`);

    const plan = input.plan ?? TenantPlan.Starter;
    const now = this.clock();
    const currency = input.currency ?? 'USD';
    const locale = input.locale ?? 'en-US';

    for (const d of input.domains ?? []) if (this.idByDomain.has(d.toLowerCase())) throw new TenantError('DUPLICATE_DOMAIN', `domain "${d}" is already mapped`);
    for (const k of input.apiKeys ?? []) if (this.idByApiKey.has(k)) throw new TenantError('DUPLICATE_API_KEY', 'api key already mapped');

    const tenant: Tenant = {
      id: tenantId(),
      code,
      name: input.name,
      operatorId: input.operatorId,
      status: TenantStatus.Provisioned,
      plan,
      region: input.region ?? 'global',
      timezone: input.timezone ?? 'UTC',
      currency,
      locale,
      brand: { ...defaultBrand(input.name), ...input.brand },
      theme: { ...defaultTheme(), ...input.theme },
      features: { ...input.features },
      limits: { ...PLAN_LIMITS[plan], ...input.limits },
      configuration: mergeConfiguration(defaultConfiguration(currency, locale), input.configuration),
      metadata: { ...input.metadata },
      domains: (input.domains ?? []).map((d) => d.toLowerCase()),
      apiKeys: [...(input.apiKeys ?? [])],
      createdAt: now,
      updatedAt: now,
      provisionedAt: now,
    };

    this.index(tenant);
    return clone(tenant);
  }

  /* -------------------------------- update -------------------------------- */

  update(id: string, patch: UpdateTenantInput): Tenant {
    const tenant = this.mustGet(id);
    if (tenant.status === TenantStatus.Deleted) throw new TenantError('DELETED', 'cannot update a deleted tenant');

    if (patch.plan && patch.plan !== tenant.plan) {
      // Re-baseline limits to the new plan, preserving explicit overrides already set.
      tenant.limits = { ...PLAN_LIMITS[patch.plan], ...diffFrom(PLAN_LIMITS[tenant.plan], tenant.limits) };
      tenant.plan = patch.plan;
    }
    if (patch.name !== undefined) tenant.name = patch.name;
    if (patch.region !== undefined) tenant.region = patch.region;
    if (patch.timezone !== undefined) tenant.timezone = patch.timezone;
    if (patch.currency !== undefined) tenant.currency = patch.currency;
    if (patch.locale !== undefined) tenant.locale = patch.locale;
    if (patch.brand) tenant.brand = { ...tenant.brand, ...patch.brand };
    if (patch.theme) tenant.theme = { ...tenant.theme, ...patch.theme };
    if (patch.limits) tenant.limits = { ...tenant.limits, ...patch.limits };
    if (patch.configuration) tenant.configuration = mergeConfiguration(tenant.configuration, patch.configuration);
    if (patch.features) tenant.features = { ...tenant.features, ...patch.features };
    if (patch.metadata) tenant.metadata = { ...tenant.metadata, ...patch.metadata };
    if (patch.domains) this.remapDomains(tenant, patch.domains);
    if (patch.apiKeys) this.remapApiKeys(tenant, patch.apiKeys);

    tenant.updatedAt = this.clock();
    return clone(tenant);
  }

  /* ----------------------------- lifecycle edges -------------------------- */

  /** Low-level status setter — the lifecycle manager (STEP 14) drives the transitions. */
  setStatus(id: string, status: TenantStatus): Tenant {
    const tenant = this.mustGet(id);
    tenant.status = status;
    const now = this.clock();
    tenant.updatedAt = now;
    if (status === TenantStatus.Active) tenant.activatedAt = now;
    if (status === TenantStatus.Suspended) tenant.suspendedAt = now;
    if (status === TenantStatus.Archived) tenant.archivedAt = now;
    if (status === TenantStatus.Deleted) tenant.deletedAt = now;
    return clone(tenant);
  }

  archive(id: string): Tenant {
    return this.setStatus(id, TenantStatus.Archived);
  }
  restore(id: string): Tenant {
    const tenant = this.mustGet(id);
    if (tenant.status !== TenantStatus.Archived && tenant.status !== TenantStatus.Suspended) {
      throw new TenantError('NOT_RESTORABLE', 'only archived or suspended tenants can be restored');
    }
    return this.setStatus(id, TenantStatus.Active);
  }

  /** Soft-delete: marks Deleted and frees the resolution indexes (code kept reserved). */
  delete(id: string): Tenant {
    const tenant = this.mustGet(id);
    for (const d of tenant.domains) this.idByDomain.delete(d);
    for (const k of tenant.apiKeys) this.idByApiKey.delete(k);
    return this.setStatus(id, TenantStatus.Deleted);
  }

  /** Permanently purge a soft-deleted tenant (frees the code too). */
  purge(id: string): void {
    const tenant = this.mustGet(id);
    if (tenant.status !== TenantStatus.Deleted) throw new TenantError('NOT_DELETED', 'purge requires a deleted tenant');
    this.idByCode.delete(tenant.code);
    this.byId.delete(id);
  }

  /* -------------------------------- lookup -------------------------------- */

  get(id: string): Tenant | null {
    const t = this.byId.get(id);
    return t ? clone(t) : null;
  }
  mustGet(id: string): Tenant {
    const t = this.byId.get(id);
    if (!t) throw new TenantError('NOT_FOUND', `tenant "${id}" not found`);
    return t;
  }
  getByCode(code: string): Tenant | null {
    const id = this.idByCode.get(code.trim().toLowerCase());
    return id ? this.get(id) : null;
  }
  getByDomain(domain: string): Tenant | null {
    const id = this.idByDomain.get(domain.toLowerCase());
    return id ? this.get(id) : null;
  }
  getByApiKey(apiKey: string): Tenant | null {
    const id = this.idByApiKey.get(apiKey);
    return id ? this.get(id) : null;
  }

  /** Search + filter (STEP 2). */
  search(query: TenantQuery = {}): Tenant[] {
    const text = query.text?.trim().toLowerCase();
    return [...this.byId.values()]
      .filter((t) =>
        (query.status === undefined || t.status === query.status) &&
        (query.plan === undefined || t.plan === query.plan) &&
        (query.region === undefined || t.region === query.region) &&
        (query.operatorId === undefined || t.operatorId === query.operatorId) &&
        (!text || t.code.includes(text) || t.name.toLowerCase().includes(text)),
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  list(): Tenant[] {
    return this.search();
  }

  get size(): number {
    return this.byId.size;
  }

  /** Per-tenant health check (STEP 2). */
  health(id: string): TenantHealth {
    const tenant = this.mustGet(id);
    const reasons: string[] = [];
    if (tenant.status === TenantStatus.Suspended) reasons.push('tenant is suspended');
    if (tenant.status === TenantStatus.Archived) reasons.push('tenant is archived');
    if (tenant.status === TenantStatus.Deleted) reasons.push('tenant is deleted');
    if (tenant.configuration.currencies.length === 0) reasons.push('no currencies configured');
    return { tenantId: id, status: tenant.status, healthy: tenant.status === TenantStatus.Active && reasons.length === 0, reasons, checkedAt: this.clock() };
  }

  /* -------------------------------- indexing ------------------------------ */

  private index(tenant: Tenant): void {
    this.byId.set(tenant.id, tenant);
    this.idByCode.set(tenant.code, tenant.id);
    for (const d of tenant.domains) this.idByDomain.set(d, tenant.id);
    for (const k of tenant.apiKeys) this.idByApiKey.set(k, tenant.id);
  }
  private remapDomains(tenant: Tenant, domains: string[]): void {
    for (const d of tenant.domains) this.idByDomain.delete(d);
    const lowered = domains.map((d) => d.toLowerCase());
    for (const d of lowered) {
      const owner = this.idByDomain.get(d);
      if (owner && owner !== tenant.id) throw new TenantError('DUPLICATE_DOMAIN', `domain "${d}" is already mapped`);
    }
    tenant.domains = lowered;
    for (const d of lowered) this.idByDomain.set(d, tenant.id);
  }
  private remapApiKeys(tenant: Tenant, apiKeys: string[]): void {
    for (const k of tenant.apiKeys) this.idByApiKey.delete(k);
    for (const k of apiKeys) {
      const owner = this.idByApiKey.get(k);
      if (owner && owner !== tenant.id) throw new TenantError('DUPLICATE_API_KEY', 'api key already mapped');
    }
    tenant.apiKeys = [...apiKeys];
    for (const k of apiKeys) this.idByApiKey.set(k, tenant.id);
  }
}

/* --------------------------------- helpers ---------------------------------- */

function clone<T>(v: T): T {
  return structuredClone ? structuredClone(v) : JSON.parse(JSON.stringify(v));
}

function mergeConfiguration(base: TenantConfiguration, patch?: Partial<TenantConfiguration>): TenantConfiguration {
  if (!patch) return { ...base };
  return {
    ...base,
    ...patch,
    depositLimits: { ...base.depositLimits, ...patch.depositLimits },
    withdrawalLimits: { ...base.withdrawalLimits, ...patch.withdrawalLimits },
    responsibleGaming: { ...base.responsibleGaming, ...patch.responsibleGaming },
    notificationSettings: { ...base.notificationSettings, ...patch.notificationSettings },
    gameAvailability: { ...base.gameAvailability, ...patch.gameAvailability },
    currencies: patch.currencies ?? base.currencies,
    languages: patch.languages ?? base.languages,
    paymentProviders: patch.paymentProviders ?? base.paymentProviders,
    extra: { ...base.extra, ...patch.extra },
  };
}

/** Keys of `current` that differ from `baseline` (explicit overrides worth preserving). */
function diffFrom(baseline: TenantLimits, current: TenantLimits): Partial<TenantLimits> {
  const out: Partial<TenantLimits> = {};
  for (const key of Object.keys(current) as (keyof TenantLimits)[]) {
    if (current[key] !== baseline[key]) out[key] = current[key];
  }
  return out;
}
