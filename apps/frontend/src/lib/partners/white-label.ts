/**
 * White-label platform (Phase 6C, STEP 5).
 *
 * Multi-tenant brand management: tenant + brand + theme (logo/colors/assets), domain
 * mapping, localization, currency configuration and per-tenant feature flags, with
 * host→tenant resolution. Pure configuration — no gameplay, no money.
 */
import { secureId } from './util';
import {
  type BrandTheme,
  type Localization,
  PartnerStatus,
  type Tenant,
} from './types';

export class WhiteLabelPlatform {
  private readonly tenants = new Map<string, Tenant>();
  private readonly domainIndex = new Map<string, string>(); // host → tenantId

  constructor(private readonly clock: () => number = () => Date.now()) {}

  createTenant(input: { partnerId: string; brandName: string; theme: BrandTheme; localization: Localization; domains?: string[]; featureFlags?: Record<string, boolean> }): Tenant {
    const now = this.clock();
    const tenant: Tenant = {
      id: secureId('tnt'),
      partnerId: input.partnerId,
      brandName: input.brandName,
      theme: input.theme,
      domains: [],
      localization: input.localization,
      featureFlags: input.featureFlags ?? {},
      status: PartnerStatus.Active,
      createdAt: now,
      updatedAt: now,
    };
    this.tenants.set(tenant.id, tenant);
    for (const d of input.domains ?? []) this.mapDomain(tenant.id, d);
    return tenant;
  }

  get(tenantId: string): Tenant {
    const t = this.tenants.get(tenantId);
    if (!t) throw new Error('no such tenant');
    return t;
  }
  all(): Tenant[] {
    return [...this.tenants.values()];
  }

  /** Map a host to a tenant (unique across all tenants). */
  mapDomain(tenantId: string, host: string): void {
    const key = host.toLowerCase();
    const existing = this.domainIndex.get(key);
    if (existing && existing !== tenantId) throw new Error(`domain already mapped to ${existing}`);
    const tenant = this.get(tenantId);
    this.domainIndex.set(key, tenantId);
    if (!tenant.domains.includes(key)) tenant.domains.push(key);
    tenant.updatedAt = this.clock();
  }

  /** Resolve the tenant serving a host (the multi-tenant entry point). */
  resolveByHost(host: string): Tenant | undefined {
    const id = this.domainIndex.get(host.toLowerCase());
    return id ? this.tenants.get(id) : undefined;
  }

  setTheme(tenantId: string, theme: Partial<BrandTheme>): Tenant {
    const t = this.get(tenantId);
    t.theme = { ...t.theme, ...theme };
    t.updatedAt = this.clock();
    return t;
  }
  setFeatureFlag(tenantId: string, flag: string, enabled: boolean): Tenant {
    const t = this.get(tenantId);
    t.featureFlags[flag] = enabled;
    t.updatedAt = this.clock();
    return t;
  }
  isFeatureEnabled(tenantId: string, flag: string): boolean {
    return this.tenants.get(tenantId)?.featureFlags[flag] ?? false;
  }
  setLocalization(tenantId: string, localization: Partial<Localization>): Tenant {
    const t = this.get(tenantId);
    t.localization = { ...t.localization, ...localization };
    t.updatedAt = this.clock();
    return t;
  }
}
