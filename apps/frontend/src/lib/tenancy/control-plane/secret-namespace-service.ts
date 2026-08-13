/**
 * Tenant Secret Namespace (Phase 3.2, STEP 11).
 *
 * A tenant-scoped secret abstraction: `tenant/{tenantId}/{namespace}/*`. The control plane
 * stores only opaque REFERENCES (never plaintext) and delegates actual secret storage to an
 * external `SecretManagerPort` (adapter over the existing SecretManager — the frozen security
 * platform is NOT modified). Supports rotation, audit and strict tenant isolation.
 */
import { forbidden } from '../persistence/errors';
import type { SecretRefRow } from '../persistence/records';
import type { SecretRefRepository } from '../persistence/repositories';
import type { AuditService } from './audit-service';

export type SecretNamespace = 'payments' | 'notifications' | 'storage' | 'identity' | (string & {});

/** Adapter over an external secret manager. A real deployment wires this to the frozen SecretManager. */
export interface SecretManagerPort {
  /** Persist a secret value out-of-band and return an opaque reference/handle. */
  put(path: string, value: string): Promise<string> | string;
  /** Resolve a reference to the secret value (server-side only, never persisted here). */
  get(reference: string): Promise<string | null> | (string | null);
  /** Optional: delete/rotate the underlying secret. */
  delete?(reference: string): Promise<void> | void;
}

export function secretPath(tenantId: string, namespace: SecretNamespace, name: string): string {
  return `tenant/${tenantId}/${namespace}/${name}`;
}

export class SecretNamespaceService {
  constructor(
    private readonly repo: SecretRefRepository,
    private readonly manager: SecretManagerPort,
    private readonly audit?: AuditService,
  ) {}

  /** Store a secret VALUE via the external manager and persist only its reference. */
  async setSecret(input: { tenantId: string; namespace: SecretNamespace; name: string; value: string; actor?: string }): Promise<SecretRefRow> {
    const path = secretPath(input.tenantId, input.namespace, input.name);
    const reference = await this.manager.put(path, input.value);
    const row = this.repo.put({ tenantId: input.tenantId, path, reference, actor: input.actor });
    this.audit?.record({ tenantId: input.tenantId, actorId: input.actor, action: 'secret.set', resource: 'secret-ref', resourceId: path, after: { path } });
    return row;
  }

  /** Get the secret reference (never the value) for a tenant path. */
  getReference(tenantId: string, namespace: SecretNamespace, name: string): SecretRefRow | null {
    const row = this.repo.get(secretPath(tenantId, namespace, name));
    if (row && row.tenantId !== tenantId) throw forbidden('cross-tenant secret access denied');
    return row;
  }

  /** Resolve the secret VALUE via the manager (server-side only). */
  async resolveSecret(tenantId: string, namespace: SecretNamespace, name: string): Promise<string | null> {
    const row = this.getReference(tenantId, namespace, name);
    if (!row) return null;
    return this.manager.get(row.reference);
  }

  /** Rotate a secret: store a new value/reference, linking the previous ref. */
  async rotateSecret(input: { tenantId: string; namespace: SecretNamespace; name: string; value: string; actor?: string }): Promise<SecretRefRow> {
    const path = secretPath(input.tenantId, input.namespace, input.name);
    const previous = this.repo.get(path);
    if (previous && previous.tenantId !== input.tenantId) throw forbidden('cross-tenant secret rotation denied');
    const reference = await this.manager.put(path, input.value);
    const row = this.repo.put({ tenantId: input.tenantId, path, reference, rotationOf: previous?.id, actor: input.actor });
    if (previous && this.manager.delete) await this.manager.delete(previous.reference);
    this.audit?.record({ tenantId: input.tenantId, actorId: input.actor, action: 'secret.rotate', resource: 'secret-ref', resourceId: path, after: { path, rotatedFrom: previous?.id } });
    return row;
  }

  listReferences(tenantId: string): SecretRefRow[] {
    return this.repo.listByTenant(tenantId);
  }
}

/** In-memory secret manager for tests/dev (values held out-of-band from tenant config/DB). */
export class InMemorySecretManager implements SecretManagerPort {
  private readonly store = new Map<string, string>();
  private seq = 0;
  put(path: string, value: string): string {
    this.seq += 1;
    const reference = `sm://${path}#${this.seq}`;
    this.store.set(reference, value);
    return reference;
  }
  get(reference: string): string | null {
    return this.store.get(reference) ?? null;
  }
  delete(reference: string): void {
    this.store.delete(reference);
  }
  /** Test helper: assert no reference reveals plaintext through the control-plane DB. */
  has(reference: string): boolean {
    return this.store.has(reference);
  }
}
