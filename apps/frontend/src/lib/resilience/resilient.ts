/**
 * Composed resilience wrapper (Phase 10, STEP 3).
 *
 * `Resilience.run(op)` layers timeout → bulkhead → circuit-breaker → retry(budgeted)
 * → fallback around any async operation, so an integration/platform call gains all the
 * protections at once WITHOUT modifying the callee. This is the adapter the app wraps
 * around external calls (payments, notifications, storage, …).
 */
import { Bulkhead, CircuitBreaker, type CircuitBreakerOptions, RetryBudget, ResilienceError, withFallback, withTimeout } from './patterns';

export interface ResilienceOptions {
  timeoutMs?: number;
  maxConcurrent?: number;
  maxQueue?: number;
  circuit?: CircuitBreakerOptions;
  /** Total attempts (1 = no retry). Retries are gated by the shared retry budget. */
  maxAttempts?: number;
  retryBudget?: RetryBudget;
  isRetryable?: (err: unknown) => boolean;
  /** Backoff between retries (injectable for tests). */
  backoff?: (attempt: number) => Promise<void>;
  delay?: (ms: number) => Promise<void>;
}

export class Resilience {
  private readonly breaker: CircuitBreaker;
  private readonly bulkhead: Bulkhead;
  private readonly retryBudget: RetryBudget;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly isRetryable: (err: unknown) => boolean;
  private readonly backoff: (attempt: number) => Promise<void>;
  private readonly delay?: (ms: number) => Promise<void>;

  constructor(readonly name: string, opts: ResilienceOptions = {}) {
    this.breaker = new CircuitBreaker(name, opts.circuit);
    this.bulkhead = new Bulkhead(name, opts.maxConcurrent ?? 32, opts.maxQueue ?? 64);
    this.retryBudget = opts.retryBudget ?? new RetryBudget();
    this.maxAttempts = opts.maxAttempts ?? 1;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.isRetryable = opts.isRetryable ?? (() => true);
    this.backoff = opts.backoff ?? (() => Promise.resolve());
    this.delay = opts.delay;
  }

  /** Run an op through the full protection stack. */
  async run<T>(op: () => Promise<T>, fallback?: (err: unknown) => Promise<T> | T): Promise<T> {
    const attempt = () =>
      this.breaker.exec(() => this.bulkhead.exec(() => withTimeout(op, this.timeoutMs, { delay: this.delay })));

    const withRetries = async (): Promise<T> => {
      this.retryBudget.onRequest();
      let lastErr: unknown;
      for (let i = 1; i <= this.maxAttempts; i += 1) {
        try {
          return await attempt();
        } catch (err) {
          lastErr = err;
          const canRetry = i < this.maxAttempts && this.isRetryable(err) && !(err instanceof ResilienceError && err.code === 'circuit_open') && this.retryBudget.canRetry();
          if (!canRetry) throw err;
          await this.backoff(i);
        }
      }
      throw lastErr;
    };

    return fallback ? withFallback(withRetries, fallback) : withRetries();
  }

  get circuit(): CircuitBreaker {
    return this.breaker;
  }
  get bulkheadRef(): Bulkhead {
    return this.bulkhead;
  }
}
