/**
 * Tenant API Key Service (Phase 3.2, STEP 9).
 *
 * Cryptographically secure API keys. The plaintext is shown to the caller EXACTLY ONCE and
 * NEVER stored or logged — the database holds only a `sha-256` hash + a safe display prefix,
 * plus metadata (name, scopes, timestamps, expiry, revocation, last-used). Verification is
 * timing-safe and enforces revocation + expiry. Additive; no frozen module.
 */
import { ControlPlaneError } from '../persistence/errors';
import type { ApiKeyRow } from '../persistence/records';
import type { ApiKeyRepository } from '../persistence/repositories';
import { generateApiKey, hashSecret } from './crypto';
import type { AuditService } from './audit-service';

/** Safe projection of an API key — never includes the hash or plaintext. */
export interface ApiKeyView {
  id: string;
  tenantId: string;
  prefix: string;
  name: string;
  scopes: string[];
  createdAt: number;
  expiresAt?: number;
  revokedAt?: number;
  lastUsedAt?: number;
}

function view(row: ApiKeyRow): ApiKeyView {
  return { id: row.id, tenantId: row.tenantId, prefix: row.prefix, name: row.name, scopes: row.scopes, createdAt: row.createdAt, expiresAt: row.expiresAt, revokedAt: row.revokedAt, lastUsedAt: row.lastUsedAt };
}

export interface IssuedApiKey {
  /** Full secret — display ONCE, never retrievable again. */
  plaintext: string;
  key: ApiKeyView;
}

export class ApiKeyService {
  constructor(
    private readonly repo: ApiKeyRepository,
    private readonly audit?: AuditService,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Issue a new key. Returns the plaintext exactly once. */
  issue(input: { tenantId: string; name: string; scopes?: string[]; expiresAt?: number; env?: 'live' | 'test'; actor?: string }): IssuedApiKey {
    const generated = generateApiKey(input.env ?? 'live');
    const row = this.repo.create({ tenantId: input.tenantId, prefix: generated.prefix, hash: generated.hash, name: input.name, scopes: input.scopes ?? [], expiresAt: input.expiresAt, actor: input.actor });
    this.audit?.record({ tenantId: input.tenantId, actorId: input.actor, action: 'apikey.issue', resource: 'api-key', resourceId: row.id, after: { prefix: generated.prefix, scopes: row.scopes } });
    return { plaintext: generated.plaintext, key: view(row) };
  }

  /** Verify a presented plaintext key → the owning tenant + scopes, or null. */
  verify(plaintext: string): { tenantId: string; keyId: string; scopes: string[] } | null {
    const row = this.repo.getByHash(hashSecret(plaintext));
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt !== undefined && row.expiresAt <= this.clock()) return null;
    this.repo.touchLastUsed(row.id);
    return { tenantId: row.tenantId, keyId: row.id, scopes: row.scopes };
  }

  /** Assert a key is valid, throwing a deterministic error otherwise. */
  requireValid(plaintext: string): { tenantId: string; keyId: string; scopes: string[] } {
    const row = this.repo.getByHash(hashSecret(plaintext));
    if (!row) throw new ControlPlaneError('NOT_FOUND', 'api key not recognized');
    if (row.revokedAt) throw new ControlPlaneError('KEY_REVOKED', 'api key revoked');
    if (row.expiresAt !== undefined && row.expiresAt <= this.clock()) throw new ControlPlaneError('KEY_EXPIRED', 'api key expired');
    this.repo.touchLastUsed(row.id);
    return { tenantId: row.tenantId, keyId: row.id, scopes: row.scopes };
  }

  revoke(id: string, actor?: string): ApiKeyView {
    const row = this.repo.getById(id);
    if (!row) throw new ControlPlaneError('NOT_FOUND', `api key "${id}" not found`);
    const revoked = this.repo.revoke(id, row.version, actor);
    this.audit?.record({ tenantId: row.tenantId, actorId: actor, action: 'apikey.revoke', resource: 'api-key', resourceId: id });
    return view(revoked);
  }

  list(tenantId: string): ApiKeyView[] {
    return this.repo.listByTenant(tenantId).map(view);
  }
}
