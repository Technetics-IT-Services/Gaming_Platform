/**
 * Core resilience patterns (Phase 10, STEP 3).
 *
 * Circuit breaker, bulkhead, timeout, retry budget and fallback — all as **wrappers**
 * around any async operation. They protect calls to the frozen platform / external
 * integrations without modifying them. Framework-agnostic, deterministic (injectable
 * clock/delay), and side-effect-free beyond their own counters.
 */

export class ResilienceError extends Error {
  constructor(
    readonly code: 'circuit_open' | 'bulkhead_full' | 'timeout' | 'retry_budget_exhausted',
    message: string,
  ) {
    super(message);
    this.name = 'ResilienceError';
  }
}

/* ------------------------------ circuit breaker --------------------------- */

export enum CircuitState {
  Closed = 'closed',
  Open = 'open',
  HalfOpen = 'half_open',
}

export interface CircuitBreakerOptions {
  /** Consecutive failures that trip the breaker. */
  failureThreshold?: number;
  /** How long to stay open before a half-open trial (ms). */
  openMs?: number;
  /** Successful trials in half-open needed to close again. */
  halfOpenTrials?: number;
  clock?: () => number;
}

export class CircuitBreaker {
  private state = CircuitState.Closed;
  private failures = 0;
  private halfOpenSuccesses = 0;
  private openedAt = 0;
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly halfOpenTrials: number;
  private readonly clock: () => number;
  readonly stats = { calls: 0, failures: 0, shortCircuited: 0, opened: 0 };

  constructor(readonly name: string, opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.openMs = opts.openMs ?? 30_000;
    this.halfOpenTrials = opts.halfOpenTrials ?? 1;
    this.clock = opts.clock ?? (() => Date.now());
  }

  getState(): CircuitState {
    if (this.state === CircuitState.Open && this.clock() - this.openedAt >= this.openMs) this.state = CircuitState.HalfOpen;
    return this.state;
  }

  async exec<T>(op: () => Promise<T>): Promise<T> {
    const state = this.getState();
    if (state === CircuitState.Open) {
      this.stats.shortCircuited += 1;
      throw new ResilienceError('circuit_open', `circuit ${this.name} is open`);
    }
    this.stats.calls += 1;
    try {
      const result = await op();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HalfOpen) {
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.halfOpenTrials) this.close();
    } else {
      this.failures = 0;
    }
  }
  private onFailure(): void {
    this.stats.failures += 1;
    if (this.state === CircuitState.HalfOpen) {
      this.trip();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.failureThreshold) this.trip();
  }
  private trip(): void {
    this.state = CircuitState.Open;
    this.openedAt = this.clock();
    this.halfOpenSuccesses = 0;
    this.stats.opened += 1;
  }
  private close(): void {
    this.state = CircuitState.Closed;
    this.failures = 0;
    this.halfOpenSuccesses = 0;
  }
}

/* --------------------------------- bulkhead ------------------------------- */

/**
 * Isolate a dependency to a bounded concurrency + a bounded wait queue, so one slow
 * dependency can't exhaust the whole process (the bulkhead pattern).
 */
export class Bulkhead {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  readonly stats = { accepted: 0, rejected: 0, queuedPeak: 0 };

  constructor(
    readonly name: string,
    private readonly maxConcurrent: number,
    private readonly maxQueue = 0,
  ) {}

  activeCount(): number {
    return this.active;
  }
  queuedCount(): number {
    return this.queue.length;
  }

  async exec<T>(op: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      if (this.queue.length >= this.maxQueue) {
        this.stats.rejected += 1;
        throw new ResilienceError('bulkhead_full', `bulkhead ${this.name} full`);
      }
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
        this.stats.queuedPeak = Math.max(this.stats.queuedPeak, this.queue.length);
      });
    }
    this.active += 1;
    this.stats.accepted += 1;
    try {
      return await op();
    } finally {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

/* --------------------------------- timeout -------------------------------- */

export interface TimeoutOptions {
  /** Injectable delay (deterministic tests). Default: setTimeout. */
  delay?: (ms: number) => Promise<void>;
}

/** Reject with a timeout if `op` does not settle within `ms`. */
export async function withTimeout<T>(op: () => Promise<T>, ms: number, opts: TimeoutOptions = {}): Promise<T> {
  const delay = opts.delay ?? ((d: number) => new Promise<void>((r) => setTimeout(r, d)));
  let timer: unknown;
  const timeout = new Promise<never>((_, reject) => {
    timer = delay(ms).then(() => reject(new ResilienceError('timeout', `operation timed out after ${ms}ms`)));
  });
  try {
    return await Promise.race([op(), timeout]);
  } finally {
    void timer;
  }
}

/* ------------------------------- retry budget ----------------------------- */

/**
 * A token-bucket retry budget: caps the *rate* of retries (as a fraction of requests)
 * so a failing dependency can't trigger a retry storm that amplifies the outage.
 */
export class RetryBudget {
  private tokens: number;
  private readonly ratio: number;
  private readonly minPerSec: number;
  private lastRefill: number;
  private readonly clock: () => number;

  constructor(opts: { ratio?: number; minPerSec?: number; clock?: () => number } = {}) {
    this.ratio = opts.ratio ?? 0.2; // retries allowed up to 20% of requests
    this.minPerSec = opts.minPerSec ?? 3;
    this.clock = opts.clock ?? (() => Date.now());
    this.tokens = this.minPerSec;
    this.lastRefill = this.clock();
  }

  /** Record a request (earns retry budget). */
  onRequest(): void {
    this.refill();
    this.tokens += this.ratio;
  }
  private refill(): void {
    const now = this.clock();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.tokens + elapsed * this.minPerSec, this.minPerSec * 10);
      this.lastRefill = now;
    }
  }
  /** Attempt to spend a retry token. Returns false when the budget is exhausted. */
  canRetry(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

/* -------------------------------- fallback -------------------------------- */

/** Run `primary`; on failure, run `fallback` (graceful degradation of one call). */
export async function withFallback<T>(primary: () => Promise<T>, fallback: (err: unknown) => Promise<T> | T): Promise<T> {
  try {
    return await primary();
  } catch (err) {
    return fallback(err);
  }
}
