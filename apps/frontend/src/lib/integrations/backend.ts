/**
 * Redis queue + database backends (Phase 9, STEP 8 & 9).
 *
 * A reliable Redis-backed queue with a dead-letter queue and retry hooks, plus a
 * PostgreSQL connection-pool health adapter and a Redis health probe. The frozen
 * in-memory `IQueue` is synchronous (in-process); a distributed backend is inherently
 * async, so this defines an async `IAsyncQueue` the worker loop drives. No business
 * logic — pure transport plumbing behind injectable clients (Fake* for tests).
 */

/* ------------------------------ redis client ------------------------------ */

/** The minimal Redis surface the reliable queue needs (bind ioredis/node-redis). */
export interface RedisClient {
  rpush(key: string, value: string): Promise<number>;
  /** Atomically move head of `src` to tail of `dst` (reliable reserve). */
  lmove(src: string, dst: string, from: 'LEFT' | 'RIGHT', to: 'LEFT' | 'RIGHT'): Promise<string | null>;
  lrem(key: string, count: number, value: string): Promise<number>;
  llen(key: string): Promise<number>;
  ping(): Promise<string>;
}

export interface AsyncQueueMessage<T> {
  id: string;
  payload: T;
  attempts: number;
  raw: string;
}
export interface IAsyncQueue<T> {
  readonly name: string;
  enqueue(payload: T): Promise<AsyncQueueMessage<T>>;
  reserve(): Promise<AsyncQueueMessage<T> | undefined>;
  ack(msg: AsyncQueueMessage<T>): Promise<void>;
  /** Return for retry (re-enqueue) or route to the dead-letter queue. */
  nack(msg: AsyncQueueMessage<T>, opts?: { toDeadLetter?: boolean }): Promise<void>;
  size(): Promise<number>;
}

function secureId(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Reliable-queue pattern over Redis lists: `LMOVE ready → processing` reserves a
 * message so a crashed worker's in-flight jobs are recoverable; `ack` removes from
 * processing; `nack` re-enqueues (retry) or pushes to the DLQ.
 */
export class RedisReliableQueue<T> implements IAsyncQueue<T> {
  private readonly readyKey: string;
  private readonly processingKey: string;
  private readonly dlqKey: string;
  constructor(readonly name: string, private readonly redis: RedisClient, private readonly maxAttempts = 5) {
    this.readyKey = `q:${name}:ready`;
    this.processingKey = `q:${name}:processing`;
    this.dlqKey = `q:${name}:dlq`;
  }

  async enqueue(payload: T): Promise<AsyncQueueMessage<T>> {
    const msg = { id: `msg_${secureId()}`, payload, attempts: 0 };
    const raw = JSON.stringify(msg);
    await this.redis.rpush(this.readyKey, raw);
    return { ...msg, raw };
  }
  async reserve(): Promise<AsyncQueueMessage<T> | undefined> {
    const raw = await this.redis.lmove(this.readyKey, this.processingKey, 'LEFT', 'RIGHT');
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { id: string; payload: T; attempts: number };
    return { id: parsed.id, payload: parsed.payload, attempts: parsed.attempts + 1, raw };
  }
  async ack(msg: AsyncQueueMessage<T>): Promise<void> {
    await this.redis.lrem(this.processingKey, 1, msg.raw);
  }
  async nack(msg: AsyncQueueMessage<T>, opts: { toDeadLetter?: boolean } = {}): Promise<void> {
    await this.redis.lrem(this.processingKey, 1, msg.raw);
    const updated = JSON.stringify({ id: msg.id, payload: msg.payload, attempts: msg.attempts });
    if (opts.toDeadLetter || msg.attempts >= this.maxAttempts) {
      await this.redis.rpush(this.dlqKey, updated);
    } else {
      await this.redis.rpush(this.readyKey, updated);
    }
  }
  async size(): Promise<number> {
    return this.redis.llen(this.readyKey);
  }
  async deadLetterSize(): Promise<number> {
    return this.redis.llen(this.dlqKey);
  }
}

/** Redis health probe (returns the infra `{ healthy, detail }` shape). */
export function redisHealthProbe(redis: RedisClient): () => Promise<{ healthy: boolean; detail?: string }> {
  return async () => {
    try {
      const pong = await redis.ping();
      return { healthy: pong === 'PONG', detail: pong };
    } catch (e) {
      return { healthy: false, detail: (e as Error).message };
    }
  };
}

/* ------------------------------- postgres --------------------------------- */

/** The minimal pool surface used for health + pooling metrics (bind pg.Pool). */
export interface DatabasePool {
  query(sql: string): Promise<{ rows: unknown[] }>;
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

/** PostgreSQL health probe: `SELECT 1` + pool saturation check. */
export function postgresHealthProbe(pool: DatabasePool, opts: { maxWaiting?: number } = {}): () => Promise<{ healthy: boolean; detail?: string }> {
  const maxWaiting = opts.maxWaiting ?? 10;
  return async () => {
    try {
      await pool.query('SELECT 1');
      const saturated = pool.waitingCount > maxWaiting;
      return { healthy: !saturated, detail: `pool ${pool.idleCount}/${pool.totalCount} idle, ${pool.waitingCount} waiting` };
    } catch (e) {
      return { healthy: false, detail: (e as Error).message };
    }
  };
}
