/**
 * Resource Isolation (Phase 3.1, STEP 10).
 *
 * Every tenant owns isolated storage, media, uploads, cache namespace, queues,
 * notifications, background jobs, audit logs, metrics and tracing — realised as
 * deterministic namespaces over the SHARED backing stores. There is no shared mutable
 * state across tenants: a namespaced view can only read/write keys under its own tenant
 * prefix, so cross-tenant access is structurally impossible. Additive; no frozen module.
 */

export type ResourceKind =
  | 'storage' | 'media' | 'uploads' | 'cache' | 'queue' | 'notifications'
  | 'jobs' | 'audit' | 'metrics' | 'tracing';

/** Build the canonical namespace prefix for a tenant resource. */
export function namespaceKey(tenantId: string, kind: ResourceKind, key?: string): string {
  const base = `t:${tenantId}:${kind}`;
  return key === undefined ? base : `${base}:${key}`;
}

/** A tenant-bound view over every resource namespace. */
export class ResourceNamespace {
  constructor(readonly tenantId: string) {}

  key(kind: ResourceKind, key?: string): string {
    return namespaceKey(this.tenantId, kind, key);
  }
  storageKey(key: string): string {
    return this.key('storage', key);
  }
  mediaKey(key: string): string {
    return this.key('media', key);
  }
  cacheKey(key: string): string {
    return this.key('cache', key);
  }
  queueName(name: string): string {
    return this.key('queue', name);
  }
  jobName(name: string): string {
    return this.key('jobs', name);
  }
  auditStream(): string {
    return this.key('audit');
  }
  metricPrefix(): string {
    return this.key('metrics');
  }
  tracePrefix(): string {
    return this.key('tracing');
  }
}

/**
 * A tenant-scoped key/value store over a SHARED backing map. Each tenant's view is
 * confined to its own prefix — `get`/`set`/`delete`/`keys`/`clear` never touch another
 * tenant's data. This is the isolation primitive the higher layers build on.
 */
export class TenantScopedKV<V = unknown> {
  private readonly backing = new Map<string, V>();

  private prefix(tenantId: string): string {
    return `t:${tenantId}:`;
  }

  set(tenantId: string, key: string, value: V): void {
    this.backing.set(this.prefix(tenantId) + key, value);
  }
  get(tenantId: string, key: string): V | undefined {
    return this.backing.get(this.prefix(tenantId) + key);
  }
  has(tenantId: string, key: string): boolean {
    return this.backing.has(this.prefix(tenantId) + key);
  }
  delete(tenantId: string, key: string): boolean {
    return this.backing.delete(this.prefix(tenantId) + key);
  }
  keys(tenantId: string): string[] {
    const p = this.prefix(tenantId);
    return [...this.backing.keys()].filter((k) => k.startsWith(p)).map((k) => k.slice(p.length));
  }
  size(tenantId: string): number {
    return this.keys(tenantId).length;
  }
  clear(tenantId: string): void {
    for (const k of this.keys(tenantId)) this.delete(tenantId, k);
  }
  /** Total entries across all tenants (for platform accounting only). */
  get totalSize(): number {
    return this.backing.size;
  }

  /** A convenience handle bound to a single tenant. */
  scope(tenantId: string): {
    set: (key: string, value: V) => void;
    get: (key: string) => V | undefined;
    has: (key: string) => boolean;
    delete: (key: string) => boolean;
    keys: () => string[];
    size: () => number;
    clear: () => void;
  } {
    return {
      set: (key, value) => this.set(tenantId, key, value),
      get: (key) => this.get(tenantId, key),
      has: (key) => this.has(tenantId, key),
      delete: (key) => this.delete(tenantId, key),
      keys: () => this.keys(tenantId),
      size: () => this.size(tenantId),
      clear: () => this.clear(tenantId),
    };
  }
}

/** A simple per-tenant FIFO queue set over a shared store (isolated by tenant). */
export class TenantQueues<T = unknown> {
  private readonly queues = new Map<string, T[]>();

  private nk(tenantId: string, name: string): string {
    return namespaceKey(tenantId, 'queue', name);
  }
  enqueue(tenantId: string, name: string, item: T): void {
    const k = this.nk(tenantId, name);
    const q = this.queues.get(k) ?? [];
    q.push(item);
    this.queues.set(k, q);
  }
  dequeue(tenantId: string, name: string): T | undefined {
    return this.queues.get(this.nk(tenantId, name))?.shift();
  }
  depth(tenantId: string, name: string): number {
    return this.queues.get(this.nk(tenantId, name))?.length ?? 0;
  }
}
