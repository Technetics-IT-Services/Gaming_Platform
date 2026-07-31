/**
 * Tenant Resolver (Phase 3.1, STEP 3).
 *
 * Maps any inbound request — from any transport — to a tenant, BEFORE business logic
 * runs. Resolution strategies are tried in priority order: explicit internal context /
 * CLI / job → API key → JWT claim → header → hostname → subdomain. Returns the resolved
 * tenant plus the source used; the caller builds a `TenantContext` from it. Purely reads
 * the registry — no frozen module is touched.
 */
import { type TenantRegistry } from './registry';
import {
  type Tenant,
  type TenantResolutionInput,
  TenantResolutionSource,
  TenantStatus,
} from './types';

export class TenantResolutionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TenantResolutionError';
  }
}

export interface ResolvedTenant {
  tenant: Tenant;
  source: TenantResolutionSource;
}

export interface ResolverOptions {
  /** JWT claim key carrying the tenant id or code (default `tid`). */
  jwtClaim?: string;
  /** Header carrying the tenant id or code (default `x-tenant-id`). */
  tenantHeader?: string;
  /** Root domains stripped to derive a subdomain (e.g. `casino.app`). */
  rootDomains?: string[];
  /** If true, resolving a non-Active tenant throws (default true). */
  requireActive?: boolean;
}

export class TenantResolver {
  private readonly jwtClaim: string;
  private readonly tenantHeader: string;
  private readonly rootDomains: string[];
  private readonly requireActive: boolean;

  constructor(private readonly registry: TenantRegistry, opts: ResolverOptions = {}) {
    this.jwtClaim = opts.jwtClaim ?? 'tid';
    this.tenantHeader = (opts.tenantHeader ?? 'x-tenant-id').toLowerCase();
    this.rootDomains = (opts.rootDomains ?? []).map((d) => d.toLowerCase());
    this.requireActive = opts.requireActive ?? true;
  }

  /** Resolve a tenant or throw. Strategies are tried most-specific first. */
  resolve(input: TenantResolutionInput): ResolvedTenant {
    const resolved =
      this.byInternal(input) ??
      this.byApiKey(input) ??
      this.byJwt(input) ??
      this.byHeader(input) ??
      this.byHostname(input) ??
      this.bySubdomain(input);

    if (!resolved) throw new TenantResolutionError('UNRESOLVED', 'could not resolve a tenant from the request');

    // Internal callers (CLI, background jobs, internal context) may target any tenant
    // regardless of the Active gate — only external transports are gated.
    const internal =
      resolved.source === TenantResolutionSource.InternalContext ||
      resolved.source === TenantResolutionSource.Cli ||
      resolved.source === TenantResolutionSource.BackgroundJob;

    if (this.requireActive && !internal && resolved.tenant.status !== TenantStatus.Active) {
      throw new TenantResolutionError('NOT_ACTIVE', `tenant "${resolved.tenant.code}" is ${resolved.tenant.status}`);
    }
    return resolved;
  }

  /** Non-throwing variant. */
  tryResolve(input: TenantResolutionInput): ResolvedTenant | null {
    try {
      return this.resolve(input);
    } catch {
      return null;
    }
  }

  /* ----------------------------- strategies ------------------------------- */

  private byInternal(input: TenantResolutionInput): ResolvedTenant | null {
    if (!input.internalTenantId) return null;
    const tenant = this.registry.get(input.internalTenantId) ?? this.registry.getByCode(input.internalTenantId);
    if (!tenant) throw new TenantResolutionError('NOT_FOUND', `internal tenant "${input.internalTenantId}" not found`);
    // Internal / CLI / background jobs may target any tenant regardless of Active gating.
    const source = input.source ?? TenantResolutionSource.InternalContext;
    return { tenant, source };
  }

  private byApiKey(input: TenantResolutionInput): ResolvedTenant | null {
    const key = input.apiKey ?? input.headers?.['x-api-key'];
    if (!key) return null;
    const tenant = this.registry.getByApiKey(key);
    if (!tenant) throw new TenantResolutionError('BAD_API_KEY', 'api key does not map to a tenant');
    return { tenant, source: TenantResolutionSource.ApiKey };
  }

  private byJwt(input: TenantResolutionInput): ResolvedTenant | null {
    const claim = input.jwtClaims?.[this.jwtClaim];
    if (typeof claim !== 'string' || !claim) return null;
    const tenant = this.registry.get(claim) ?? this.registry.getByCode(claim);
    if (!tenant) throw new TenantResolutionError('BAD_JWT_CLAIM', `jwt ${this.jwtClaim}="${claim}" does not map to a tenant`);
    return { tenant, source: TenantResolutionSource.JwtClaim };
  }

  private byHeader(input: TenantResolutionInput): ResolvedTenant | null {
    const value = input.headers?.[this.tenantHeader];
    if (!value) return null;
    const tenant = this.registry.get(value) ?? this.registry.getByCode(value);
    if (!tenant) throw new TenantResolutionError('BAD_HEADER', `header ${this.tenantHeader}="${value}" does not map to a tenant`);
    return { tenant, source: TenantResolutionSource.Header };
  }

  private byHostname(input: TenantResolutionInput): ResolvedTenant | null {
    const host = (input.hostname ?? input.headers?.['host'])?.toLowerCase();
    if (!host) return null;
    const bare = host.split(':')[0]!; // strip port
    const tenant = this.registry.getByDomain(bare);
    if (tenant) return { tenant, source: TenantResolutionSource.Hostname };
    // Fall through to subdomain derivation.
    const sub = this.subdomainOf(bare);
    if (sub) {
      const byCode = this.registry.getByCode(sub);
      if (byCode) return { tenant: byCode, source: TenantResolutionSource.Subdomain };
    }
    return null;
  }

  private bySubdomain(input: TenantResolutionInput): ResolvedTenant | null {
    const sub = input.subdomain?.toLowerCase();
    if (!sub) return null;
    const tenant = this.registry.getByCode(sub);
    if (!tenant) throw new TenantResolutionError('BAD_SUBDOMAIN', `subdomain "${sub}" does not map to a tenant`);
    return { tenant, source: TenantResolutionSource.Subdomain };
  }

  private subdomainOf(host: string): string | null {
    for (const root of this.rootDomains) {
      if (host === root) return null;
      if (host.endsWith(`.${root}`)) return host.slice(0, -(root.length + 1)).split('.')[0] ?? null;
    }
    return null;
  }
}
