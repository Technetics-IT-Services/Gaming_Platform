/**
 * Tenant Domain Management & Verification (Phase 3.2, STEP 7 & 8).
 *
 * Manages platform subdomains and custom domains with hostname normalization, uniqueness,
 * tenant ownership, and a real verification flow (DNS TXT / DNS CNAME / HTTP challenge via
 * a provider port). A domain can NEVER become Active without a valid verification result;
 * duplicate/cross-tenant hostnames are rejected, preventing domain takeover. Verification is
 * never faked — the provider must confirm the challenge. Additive; no frozen module.
 */
import { ControlPlaneError, validation } from '../persistence/errors';
import type { DomainRow, DomainVerificationMethod } from '../persistence/records';
import type { DomainRepository } from '../persistence/repositories';
import { verificationToken } from './crypto';
import type { AuditService } from './audit-service';

/** External verification provider (DNS/HTTP). A real deployment queries DNS or fetches a URL. */
export interface DomainVerificationProvider {
  /** Return true only if the challenge for `hostname` is genuinely satisfied. */
  check(input: { hostname: string; method: DomainVerificationMethod; token: string }): Promise<boolean> | boolean;
}

/**
 * A deterministic mock provider for tests/dev. It does NOT auto-pass — a challenge must be
 * explicitly registered as satisfied, mirroring "the DNS record now exists". This keeps the
 * verification real (a domain cannot be verified unless its challenge is actually present).
 */
export class MockDomainVerificationProvider implements DomainVerificationProvider {
  private readonly satisfied = new Set<string>();
  /** Simulate the operator publishing the DNS/HTTP challenge. */
  satisfy(hostname: string, token: string): void {
    this.satisfied.add(`${hostname.toLowerCase()}:${token}`);
  }
  check(input: { hostname: string; method: DomainVerificationMethod; token: string }): boolean {
    return this.satisfied.has(`${input.hostname.toLowerCase()}:${input.token}`);
  }
}

const HOST = (h: string) => h.trim().toLowerCase().replace(/\.$/, '');

export class DomainService {
  constructor(
    private readonly repo: DomainRepository,
    private readonly provider: DomainVerificationProvider,
    private readonly audit?: AuditService,
  ) {}

  /** Register a domain for a tenant (starts PendingVerification). */
  createDomain(input: { tenantId: string; hostname: string; kind: 'subdomain' | 'custom'; method?: DomainVerificationMethod; actor?: string }): DomainRow {
    const hostname = HOST(input.hostname);
    if (!/^[a-z0-9.-]+$/.test(hostname)) throw validation(`invalid hostname "${hostname}"`);
    // Uniqueness / takeover guard: a live (non-removed) hostname bound to any tenant blocks re-binding.
    const existing = this.repo.getByHostname(hostname);
    if (existing) throw new ControlPlaneError('DOMAIN_TAKEOVER', `hostname "${hostname}" is already bound to a tenant`, { ownerTenantId: existing.tenantId });
    const row = this.repo.create({ tenantId: input.tenantId, hostname, kind: input.kind, method: input.method ?? 'dns-txt', token: verificationToken(), actor: input.actor });
    this.audit?.record({ tenantId: input.tenantId, actorId: input.actor, action: 'domain.create', resource: 'domain', resourceId: row.id, after: { hostname, kind: input.kind } });
    return row;
  }

  /** Run verification via the provider; only a genuine pass marks the domain Verified. */
  async verifyDomain(id: string, actor?: string): Promise<DomainRow> {
    const row = this.repo.getById(id);
    if (!row) throw new ControlPlaneError('NOT_FOUND', `domain "${id}" not found`);
    if (row.status === 'removed') throw validation('domain is removed');
    const ok = await this.provider.check({ hostname: row.hostname, method: row.verificationMethod, token: row.verificationToken });
    if (!ok) {
      this.audit?.record({ tenantId: row.tenantId, actorId: actor, action: 'domain.verify', resource: 'domain', resourceId: id, result: 'failure', reason: 'challenge not satisfied' });
      throw new ControlPlaneError('DOMAIN_VERIFICATION_FAILED', `verification failed for "${row.hostname}"`);
    }
    const verified = this.repo.markVerified(id, row.version, actor);
    this.audit?.record({ tenantId: row.tenantId, actorId: actor, action: 'domain.verify', resource: 'domain', resourceId: id, result: 'success', after: { status: 'verified' } });
    return verified;
  }

  /** Activate a Verified domain so it can resolve traffic. */
  activateDomain(id: string, actor?: string): DomainRow {
    const row = this.repo.getById(id);
    if (!row) throw new ControlPlaneError('NOT_FOUND', `domain "${id}" not found`);
    if (row.status !== 'verified' && row.status !== 'suspended') throw new ControlPlaneError('NOT_ACTIVE', 'domain must be verified before activation');
    const active = this.repo.setStatus(id, 'active', row.version, actor);
    this.audit?.record({ tenantId: row.tenantId, actorId: actor, action: 'domain.activate', resource: 'domain', resourceId: id, after: { status: 'active' } });
    return active;
  }

  suspendDomain(id: string, actor?: string): DomainRow {
    const row = this.repo.getById(id);
    if (!row) throw new ControlPlaneError('NOT_FOUND', `domain "${id}" not found`);
    const suspended = this.repo.setStatus(id, 'suspended', row.version, actor);
    this.audit?.record({ tenantId: row.tenantId, actorId: actor, action: 'domain.suspend', resource: 'domain', resourceId: id });
    return suspended;
  }

  removeDomain(id: string, actor?: string): DomainRow {
    const row = this.repo.getById(id);
    if (!row) throw new ControlPlaneError('NOT_FOUND', `domain "${id}" not found`);
    const removed = this.repo.remove(id, row.version, actor);
    this.audit?.record({ tenantId: row.tenantId, actorId: actor, action: 'domain.remove', resource: 'domain', resourceId: id });
    return removed;
  }

  listDomains(tenantId: string): DomainRow[] {
    return this.repo.listByTenant(tenantId).filter((d) => d.status !== 'removed');
  }

  /** Resolve a hostname to the owning tenant — only Active domains resolve traffic. */
  resolveDomain(hostname: string): { tenantId: string; domainId: string } | null {
    const row = this.repo.getByHostname(HOST(hostname));
    if (!row || row.status !== 'active') return null;
    return { tenantId: row.tenantId, domainId: row.id };
  }
}
