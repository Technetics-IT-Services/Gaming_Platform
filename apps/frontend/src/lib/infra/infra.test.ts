import { describe, expect, it, vi } from 'vitest';

import {
  ConfigValidationError,
  Environment,
  FeatureFlags,
  loadConfig,
  profileDefaults,
  TenantConfigRegistry,
  type ConfigSchema,
} from './config';
import { HealthRegistry, HealthState, probes } from './health';
import { backoffDelay, DEFAULT_RETRY, Scheduler, Worker } from './jobs';
import { InMemoryQueue } from './queue';
import { buildInfo, compareVersions } from './version';

/**
 * Production infrastructure library (Phase 7). Verifies config validation + secret
 * masking + feature flags + tenant config, the queue/DLQ, the retry-aware worker and
 * scheduler, the liveness/readiness health registry and version metadata. Pure
 * operational plumbing — no business logic, no money movement.
 */

const SCHEMA: ConfigSchema = {
  PORT: { type: 'number', default: 3000, min: 1, max: 65535 },
  NODE_ENV: { type: 'enum', values: ['development', 'staging', 'production', 'test'], required: true },
  DATABASE_URL: { type: 'url', required: true, secret: true },
  FEATURE_X: { type: 'boolean', default: false },
};

describe('configuration platform', () => {
  it('validates, coerces types and injects secrets (masked in safe output)', () => {
    const cfg = loadConfig(
      { PORT: '8080', NODE_ENV: 'production', FEATURE_X: 'true' },
      SCHEMA,
      { env: Environment.Production, secrets: { DATABASE_URL: 'postgres://u:p@db:5432/app' } },
    );
    expect(cfg.get('PORT')).toBe(8080);
    expect(cfg.get('FEATURE_X')).toBe(true);
    expect(cfg.get('DATABASE_URL')).toBe('postgres://u:p@db:5432/app');
    expect(cfg.masked().DATABASE_URL).toBe('***'); // secret masked
    expect(cfg.masked().PORT).toBe(8080);
  });

  it('aggregates all validation issues and throws once', () => {
    try {
      loadConfig({ PORT: 'not-a-number', NODE_ENV: 'bogus' }, SCHEMA);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigValidationError);
      const issues = (e as ConfigValidationError).issues.map((i) => i.key);
      expect(issues).toEqual(expect.arrayContaining(['PORT', 'NODE_ENV', 'DATABASE_URL']));
    }
  });

  it('applies environment profile defaults', () => {
    expect(profileDefaults(Environment.Production).LOG_LEVEL).toBe('warn');
    expect(profileDefaults(Environment.Development).LOG_LEVEL).toBe('debug');
  });
});

describe('feature flags', () => {
  it('resolves most-specific scope: tenant+env > tenant > env > base', () => {
    const flags = new FeatureFlags({ newCashier: false });
    flags.setOverride('newCashier', true, { env: Environment.Staging });
    flags.setOverride('newCashier', true, { tenantId: 'brandX' });
    expect(flags.isEnabled('newCashier')).toBe(false); // base
    expect(flags.isEnabled('newCashier', { env: Environment.Staging })).toBe(true);
    expect(flags.isEnabled('newCashier', { tenantId: 'brandX' })).toBe(true);
    expect(flags.isEnabled('newCashier', { tenantId: 'other', env: Environment.Production })).toBe(false);
  });
});

describe('tenant config', () => {
  it('resolves per-tenant with fallback to defaults', () => {
    const reg = new TenantConfigRegistry({ currency: 'USD', maxWithdrawal: 100_000 });
    reg.set('brandX', { currency: 'INR' });
    expect(reg.get('brandX', 'currency')).toBe('INR');
    expect(reg.get('brandX', 'maxWithdrawal')).toBe(100_000); // default fallback
    expect(reg.resolve('unknown').values.currency).toBe('USD');
  });
});

describe('queue + dead-letter', () => {
  it('enqueues, reserves, acks and honors delayed availability', () => {
    let t = 0;
    const q = new InMemoryQueue<number>('jobs', undefined, () => t);
    q.enqueue(1);
    q.enqueue(2, { delayMs: 100 });
    const first = q.dequeue();
    expect(first!.payload).toBe(1);
    expect(q.dequeue()).toBeUndefined(); // #2 not yet available
    t = 100;
    expect(q.dequeue()!.payload).toBe(2);
    q.ack(first!.id);
    expect(q.inFlight()).toBe(1); // #2 still reserved
  });

  it('nack routes to the dead-letter queue', () => {
    const dlq = new InMemoryQueue<string>('jobs.dlq');
    const q = new InMemoryQueue<string>('jobs', dlq);
    const m = q.enqueue('x');
    q.dequeue();
    q.nack(m.id, { toDeadLetter: true });
    expect(dlq.size()).toBe(1);
  });
});

describe('background worker', () => {
  it('processes jobs, retries with backoff, then dead-letters on exhaustion', async () => {
    let t = 0;
    const dlq = new InMemoryQueue<{ n: number }>('dlq', undefined, () => t);
    const q = new InMemoryQueue<{ n: number }>('jobs', dlq, () => t);
    const onDead = vi.fn();
    const onRetry = vi.fn();
    const worker = new Worker('w', q, () => { throw new Error('always fails'); }, {
      retry: { maxAttempts: 3, baseDelayMs: 10, factor: 2, maxDelayMs: 1_000 },
      hooks: { onDeadLetter: onDead, onRetry },
      clock: () => t,
    });
    worker.start();
    q.enqueue({ n: 1 });

    await worker.poll(); // attempt 1 → retry (delay 10)
    expect(onRetry).toHaveBeenCalledTimes(1);
    t = 10;
    await worker.poll(); // attempt 2 → retry (delay 20)
    t = 30;
    await worker.poll(); // attempt 3 → dead-letter
    expect(onDead).toHaveBeenCalledTimes(1);
    expect(dlq.size()).toBe(1);
    const stats = worker.getStats();
    expect(stats.deadLettered).toBe(1);
    expect(stats.retried).toBe(2);
  });

  it('acks a successful job and respects start/stop lifecycle', async () => {
    const q = new InMemoryQueue<number>('jobs');
    const seen: number[] = [];
    const worker = new Worker('w', q, (n) => { seen.push(n); });
    q.enqueue(42);
    expect(await worker.poll()).toBe(false); // not started
    worker.start();
    expect(await worker.poll()).toBe(true);
    expect(seen).toEqual([42]);
    expect(worker.getStats().succeeded).toBe(1);
    worker.stop();
    q.enqueue(7);
    expect(await worker.poll()).toBe(false);
  });

  it('computes exponential backoff capped at the max', () => {
    const p = DEFAULT_RETRY;
    expect(backoffDelay(p, 1)).toBe(1_000);
    expect(backoffDelay(p, 2)).toBe(2_000);
    expect(backoffDelay(p, 10)).toBe(p.maxDelayMs); // capped
  });
});

describe('scheduler', () => {
  it('runs recurring jobs only when their interval elapses', () => {
    let t = 0;
    const sched = new Scheduler(() => t);
    const runs: number[] = [];
    sched.every('snapshot', 100, (now) => runs.push(now));
    expect(sched.tick()).toEqual(['snapshot']); // first tick always runs
    t = 50;
    expect(sched.tick()).toEqual([]); // interval not elapsed
    t = 100;
    expect(sched.tick()).toEqual(['snapshot']);
    expect(runs).toEqual([0, 100]);
  });
});

describe('health registry', () => {
  it('liveness is cheap+healthy; readiness aggregates critical + non-critical probes', async () => {
    const reg = new HealthRegistry(() => 0);
    reg.register({ name: 'db', probe: probes.database(() => true) });
    reg.register({ name: 'redis', critical: false, probe: probes.redis(() => false) });
    reg.register({ name: 'queue', probe: probes.queueDepth(() => 5, { warn: 10, max: 100 }) });

    expect(reg.liveness().state).toBe(HealthState.Healthy);
    const ready = await reg.readiness();
    // redis is down but non-critical → degraded, not unhealthy
    expect(ready.state).toBe(HealthState.Degraded);

    reg.register({ name: 'db', probe: probes.database(() => false) }); // critical failure
    expect((await reg.readiness()).state).toBe(HealthState.Unhealthy);
  });
});

describe('version metadata', () => {
  it('reads build info and compares semver', () => {
    const info = buildInfo({ APP_VERSION: '1.2.3', GIT_SHA: 'abc', NODE_ENV: 'production' });
    expect(info.version).toBe('1.2.3');
    expect(info.environment).toBe('production');
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
  });
});
