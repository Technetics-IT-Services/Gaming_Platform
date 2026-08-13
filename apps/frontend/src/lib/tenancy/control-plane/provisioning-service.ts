/**
 * Tenant Provisioning Workflow (Phase 3.2, STEP 13).
 *
 * An idempotent, retry-safe provisioning pipeline keyed by an idempotency key:
 *   create record → configure → flags → quotas → namespaces → audit → mark provisioned →
 *   activate.
 * Every step is guarded so a retry resumes where it left off; a failure records
 * `ProvisioningFailed` and leaves NO partially active tenant (the tenant stays Provisioned
 * until activation succeeds). Financially inert — creates zero ledger/wallet/treasury
 * impact. Additive; no frozen module.
 */
import { defaultConfiguration } from '../defaults';
import { ResourceNamespace } from '../isolation';
import { ControlPlaneError } from '../persistence/errors';
import type { PersistenceDriver } from '../persistence/driver';
import type { ProvisioningRow, TenantRow } from '../persistence/records';
import type { ProvisioningRepository, QuotaRepository } from '../persistence/repositories';
import type { CreateTenantRecord, TenantRepository } from '../persistence/tenant-repository';
import type { AuditService } from './audit-service';
import type { ConfigurationService } from './configuration-service';
import type { LifecycleService } from './lifecycle-service';

export interface ProvisionInput extends CreateTenantRecord {
  idempotencyKey: string;
}

export interface ProvisionResult {
  tenant: TenantRow;
  provisioning: ProvisioningRow;
  reused: boolean;
}

export class ProvisioningService {
  constructor(
    private readonly db: PersistenceDriver,
    private readonly prov: ProvisioningRepository,
    private readonly tenants: TenantRepository,
    private readonly config: ConfigurationService,
    private readonly quotas: QuotaRepository,
    private readonly lifecycle: LifecycleService,
    private readonly audit?: AuditService,
  ) {}

  provision(input: ProvisionInput): ProvisionResult {
    const existing = this.prov.getByIdempotencyKey(input.idempotencyKey);

    // Idempotent replay: an already-activated attempt returns the same tenant.
    if (existing && existing.state === 'activated') {
      return { tenant: this.tenants.getById(existing.tenantId)!, provisioning: existing, reused: true };
    }

    let record = existing;
    let tenant: TenantRow;

    if (!record) {
      // First attempt — create the tenant record and the provisioning row atomically.
      ({ tenant, record } = this.db.transaction(() => {
        const t = this.tenants.create({ ...input, actor: input.actor });
        const p = this.prov.start({ tenantId: t.id, idempotencyKey: input.idempotencyKey, actor: input.actor });
        return { tenant: t, record: this.prov.advance(p.id, 'record-created', 'record-created', input.actor) };
      }));
    } else {
      const t = this.tenants.getById(record.tenantId);
      if (!t) throw new ControlPlaneError('PROVISIONING_FAILED', 'provisioning record references a missing tenant');
      tenant = t;
    }

    try {
      // 2) Configuration — create the initial version if none exists.
      if (this.config.getActiveVersion(tenant.id) === null) {
        this.config.createVersion(tenant.id, defaultConfiguration(tenant.currency, tenant.locale), { reason: 'provisioning', actor: input.actor });
      }
      record = this.prov.advance(record.id, 'configured', 'configured', input.actor);

      // 3) Feature flags — plan defaults apply automatically; nothing to persist.
      record = this.prov.advance(record.id, 'flagged', 'flagged', input.actor);

      // 4) Quotas — persist the tenant's plan-derived limits.
      this.quotas.upsert(tenant.id, tenant.limits, input.actor);
      record = this.prov.advance(record.id, 'quota-set', 'quota-set', input.actor);

      // 5) Resource namespaces — deterministic, idempotent (no mutable state to create).
      void new ResourceNamespace(tenant.id).auditStream();
      record = this.prov.advance(record.id, 'namespaced', 'namespaced', input.actor);

      // 6) Audit + mark provisioned.
      this.audit?.record({ tenantId: tenant.id, actorId: input.actor, action: 'tenant.provision', resource: 'tenant', resourceId: tenant.id, after: { code: tenant.code, plan: tenant.plan } });
      record = this.prov.advance(record.id, 'provisioned', 'provisioned', input.actor);

      // 7) Activate (Provisioned → Active). Only now is the tenant serving.
      const active = this.lifecycle.activate(tenant.id, { actorId: input.actor, reason: 'provisioning complete' });
      record = this.prov.advance(record.id, 'activated', 'activated', input.actor);

      return { tenant: active, provisioning: record, reused: false };
    } catch (err) {
      const failed = this.prov.fail(record.id, (err as Error).message, input.actor);
      this.audit?.record({ tenantId: tenant.id, actorId: input.actor, action: 'tenant.provision', resource: 'tenant', resourceId: tenant.id, result: 'failure', reason: (err as Error).message });
      throw new ControlPlaneError('PROVISIONING_FAILED', `provisioning failed: ${(err as Error).message}`, { provisioning: failed.id });
    }
  }

  getStatus(idempotencyKey: string): ProvisioningRow | null {
    return this.prov.getByIdempotencyKey(idempotencyKey);
  }
}
