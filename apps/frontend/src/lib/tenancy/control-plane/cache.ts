/**
 * Control-plane cache (Phase 3.2, STEP 19).
 *
 * A tenant-namespaced, version-aware cache for tenant lookups, configuration and feature
 * flags. Keys are ALWAYS prefixed with the tenant id, so they can never collide across
 * tenants; configuration keys embed the active version so a rollback/rollforward naturally
 * invalidates. Persistence remains the source of truth — the cache is populated from it and
 * dropped on any write. Tracks hit/miss for observability.
 */
export type CacheKind = 'tenant' | 'config' | 'flags' | 'domains' | 'apikeys';

export function cacheKey(tenantId: string, kind: CacheKind, version?: number | string): string {
  return version === undefined ? `tenant:${tenantId}:${kind}` : `tenant:${tenantId}:${kind}:${version}`;
}

export class ControlPlaneCache {
  private readonly store = new Map<string, unknown>();
  private hits = 0;
  private misses = 0;

  get<T>(tenantId: string, kind: CacheKind, version?: number | string): T | undefined {
    const v = this.store.get(cacheKey(tenantId, kind, version));
    if (v === undefined) this.misses += 1;
    else this.hits += 1;
    return v as T | undefined;
  }

  set<T>(tenantId: string, kind: CacheKind, value: T, version?: number | string): void {
    this.store.set(cacheKey(tenantId, kind, version), value);
  }

  /** Invalidate a single kind (all versions) for a tenant. */
  invalidateKind(tenantId: string, kind: CacheKind): void {
    const prefix = `tenant:${tenantId}:${kind}`;
    for (const key of this.store.keys()) if (key === prefix || key.startsWith(`${prefix}:`)) this.store.delete(key);
  }

  /** Invalidate everything cached for a tenant (lifecycle/purge). */
  invalidateTenant(tenantId: string): void {
    const prefix = `tenant:${tenantId}:`;
    for (const key of this.store.keys()) if (key.startsWith(prefix)) this.store.delete(key);
  }

  /** Drop the entire cache (e.g. process restart — rebuild lazily from persistence). */
  clear(): void {
    this.store.clear();
  }

  stats(): { hits: number; misses: number; size: number; hitRate: number } {
    const total = this.hits + this.misses;
    return { hits: this.hits, misses: this.misses, size: this.store.size, hitRate: total === 0 ? 0 : this.hits / total };
  }
}
