/**
 * Tenant Audit Platform (Phase 3.2, STEP 12).
 *
 * Persists every control-plane action to an append-only, immutable audit trail with full
 * context (actor, action, resource, before/after, result, correlation). NEVER stores
 * plaintext secrets — values are redacted before persistence. Additive; no frozen module.
 */
import type { AuditRepository } from '../persistence/repositories';
import type { AuditEventRow } from '../persistence/records';

const SECRET_KEYS = /(secret|password|token|plaintext|apikey|api_key|hash)/i;

/** Recursively redact secret-looking values so they never reach the audit store. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? '«redacted»' : redact(v, depth + 1);
  return out;
}

export interface AuditInput {
  tenantId?: string;
  actorId?: string;
  actorType?: 'platform' | 'tenant' | 'system';
  action: string;
  resource: string;
  resourceId?: string;
  requestId?: string;
  correlationId?: string;
  reference?: string;
  before?: unknown;
  after?: unknown;
  result?: AuditEventRow['result'];
  reason?: string;
  metadata?: Record<string, unknown>;
}

export class AuditService {
  constructor(private readonly repo: AuditRepository) {}

  record(input: AuditInput): AuditEventRow {
    return this.repo.append({
      tenantId: input.tenantId,
      actorId: input.actorId,
      actorType: input.actorType ?? 'platform',
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      requestId: input.requestId,
      correlationId: input.correlationId,
      reference: input.reference,
      before: redact(input.before),
      after: redact(input.after),
      result: input.result ?? 'success',
      reason: input.reason,
      metadata: input.metadata as Record<string, unknown> | undefined,
    });
  }

  listByTenant(tenantId: string): AuditEventRow[] {
    return this.repo.listByTenant(tenantId);
  }
  listByAction(action: string): AuditEventRow[] {
    return this.repo.listByAction(action);
  }
  all(): AuditEventRow[] {
    return this.repo.all();
  }
}
