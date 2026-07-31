/**
 * High-availability primitives (Phase 10, STEP 1 & 4).
 *
 * Lease-based leader election (for singleton workers / scheduled jobs in an
 * active-passive fleet) and a health-based router (for regional/endpoint failover and
 * connection draining). Both are framework-agnostic and backed by injectable stores —
 * production binds a Redis/etcd lease or a service-discovery health source.
 */

/* ----------------------------- leader election ---------------------------- */

/** A compare-and-set lease store (bind Redis SET NX PX / etcd lease). */
export interface LeaseStore {
  /** Acquire or renew the lease for `holder` if free or already held. Returns success. */
  acquire(key: string, holder: string, ttlMs: number, now: number): boolean;
  /** Current holder + expiry, if any. */
  current(key: string, now: number): { holder: string; expiresAt: number } | undefined;
  release(key: string, holder: string): void;
}

/** In-memory lease store (single process / tests). */
export class InMemoryLeaseStore implements LeaseStore {
  private readonly leases = new Map<string, { holder: string; expiresAt: number }>();
  acquire(key: string, holder: string, ttlMs: number, now: number): boolean {
    const cur = this.leases.get(key);
    if (!cur || cur.expiresAt <= now || cur.holder === holder) {
      this.leases.set(key, { holder, expiresAt: now + ttlMs });
      return true;
    }
    return false;
  }
  current(key: string, now: number): { holder: string; expiresAt: number } | undefined {
    const cur = this.leases.get(key);
    return cur && cur.expiresAt > now ? cur : undefined;
  }
  release(key: string, holder: string): void {
    if (this.leases.get(key)?.holder === holder) this.leases.delete(key);
  }
}

export class LeaderElection {
  private leader = false;
  constructor(
    private readonly key: string,
    private readonly nodeId: string,
    private readonly store: LeaseStore,
    private readonly ttlMs = 15_000,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Try to acquire/renew leadership. Call on a timer (renew before TTL/3 expiry). */
  tick(): boolean {
    this.leader = this.store.acquire(this.key, this.nodeId, this.ttlMs, this.clock());
    return this.leader;
  }
  isLeader(): boolean {
    const cur = this.store.current(this.key, this.clock());
    this.leader = cur?.holder === this.nodeId;
    return this.leader;
  }
  /** Step down (graceful failover — the passive node takes over on its next tick). */
  resign(): void {
    this.store.release(this.key, this.nodeId);
    this.leader = false;
  }
  currentLeader(): string | undefined {
    return this.store.current(this.key, this.clock())?.holder;
  }
}

/* --------------------------- health-based routing ------------------------- */

export enum EndpointState {
  Healthy = 'healthy',
  Unhealthy = 'unhealthy',
  Draining = 'draining',
}
export interface Endpoint {
  id: string;
  region?: string;
  weight: number;
  state: EndpointState;
}

/**
 * Weighted health-based router: routes only to healthy endpoints, prefers the caller's
 * region (geo affinity) with cross-region failover, and excludes draining endpoints
 * (connection draining). Deterministic pick via an injectable selector.
 */
export class HealthBasedRouter {
  private readonly endpoints = new Map<string, Endpoint>();
  constructor(endpoints: Endpoint[] = [], private readonly rng: (n: number) => number = () => 0) {
    for (const e of endpoints) this.endpoints.set(e.id, e);
  }

  upsert(e: Endpoint): void {
    this.endpoints.set(e.id, e);
  }
  setState(id: string, state: EndpointState): void {
    const e = this.endpoints.get(id);
    if (e) e.state = state;
  }
  /** Begin draining an endpoint (stops new traffic; in-flight finishes). */
  drain(id: string): void {
    this.setState(id, EndpointState.Draining);
  }

  private healthy(region?: string): Endpoint[] {
    const all = [...this.endpoints.values()].filter((e) => e.state === EndpointState.Healthy && e.weight > 0);
    if (region) {
      const inRegion = all.filter((e) => e.region === region);
      if (inRegion.length) return inRegion; // prefer same region; else fail over cross-region
    }
    return all;
  }

  /** Pick a healthy endpoint (weighted), preferring `region`. Undefined if none. */
  route(region?: string): Endpoint | undefined {
    const pool = this.healthy(region);
    if (pool.length === 0) return undefined;
    const total = pool.reduce((s, e) => s + e.weight, 0);
    let pick = this.rng(total);
    for (const e of pool) {
      pick -= e.weight;
      if (pick < 0) return e;
    }
    return pool[pool.length - 1];
  }

  /** True when no endpoint in `region` is healthy → triggers regional failover. */
  regionFailed(region: string): boolean {
    return [...this.endpoints.values()].filter((e) => e.region === region).every((e) => e.state !== EndpointState.Healthy);
  }
}
