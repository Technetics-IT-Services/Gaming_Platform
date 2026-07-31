/**
 * Data Ownership (Phase 3.1, STEP 13).
 *
 * Every business entity is owned by exactly one tenant — no data may exist without a
 * `tenantId`. `TenantOwned<T>` stamps ownership; `TenantRepository<T>` is a tenant-safe
 * store that enforces it on every read and write: a query in tenant A can never see or
 * mutate tenant B's rows. This wraps data ADDITIVELY — the frozen platform's own entities
 * are untouched; new multi-tenant data uses this to guarantee isolation.
 */

/** Any entity, augmented with its owning tenant. */
export type TenantOwned<T> = T & { tenantId: string; id: string };

export class TenantOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantOwnershipError';
  }
}

/** Kinds of tenant-owned entities the platform tracks (STEP 13, illustrative). */
export const OWNED_ENTITY_KINDS = [
  'player', 'wallet', 'transaction', 'deposit', 'withdrawal', 'bonus', 'game-session',
  'poker-table', 'lottery-ticket', 'notification', 'vip', 'affiliate', 'crm', 'audit',
] as const;
export type OwnedEntityKind = (typeof OWNED_ENTITY_KINDS)[number];

/**
 * A tenant-scoped repository. Every row carries `tenantId`; all operations REQUIRE the
 * caller's tenant id and silently exclude — never leak — other tenants' rows.
 */
export class TenantRepository<T extends { id: string }> {
  private readonly rows = new Map<string, TenantOwned<T>>();

  constructor(readonly kind: OwnedEntityKind | string) {}

  /** Insert/replace a row under a tenant. */
  put(tenantId: string, entity: T): TenantOwned<T> {
    if (!tenantId) throw new TenantOwnershipError('tenantId is required — no data may exist without tenant ownership');
    const existing = this.rows.get(entity.id);
    if (existing && existing.tenantId !== tenantId) {
      throw new TenantOwnershipError(`entity "${entity.id}" is owned by another tenant`);
    }
    const owned: TenantOwned<T> = { ...entity, tenantId };
    this.rows.set(entity.id, owned);
    return owned;
  }

  /** Read a row — only if it belongs to the caller's tenant. */
  get(tenantId: string, id: string): TenantOwned<T> | null {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }

  /** Does the caller's tenant own this id? */
  owns(tenantId: string, id: string): boolean {
    return this.rows.get(id)?.tenantId === tenantId;
  }

  /** All rows for a tenant (optionally filtered). */
  list(tenantId: string, predicate?: (row: TenantOwned<T>) => boolean): TenantOwned<T>[] {
    const out: TenantOwned<T>[] = [];
    for (const row of this.rows.values()) {
      if (row.tenantId === tenantId && (!predicate || predicate(row))) out.push(row);
    }
    return out;
  }

  /** Delete a row — only if the caller's tenant owns it. */
  delete(tenantId: string, id: string): boolean {
    const row = this.rows.get(id);
    if (!row || row.tenantId !== tenantId) return false;
    return this.rows.delete(id);
  }

  /** Count rows for a tenant. */
  count(tenantId: string): number {
    let n = 0;
    for (const row of this.rows.values()) if (row.tenantId === tenantId) n += 1;
    return n;
  }

  /** Purge every row for a tenant (used by lifecycle delete). */
  purgeTenant(tenantId: string): number {
    let n = 0;
    for (const [id, row] of this.rows) {
      if (row.tenantId === tenantId) {
        this.rows.delete(id);
        n += 1;
      }
    }
    return n;
  }
}

/** Assert an entity is stamped with the expected tenant (guards cross-tenant writes). */
export function assertOwned<T>(entity: TenantOwned<T>, tenantId: string): TenantOwned<T> {
  if (entity.tenantId !== tenantId) throw new TenantOwnershipError(`entity belongs to tenant "${entity.tenantId}", not "${tenantId}"`);
  return entity;
}
