/**
 * Background job framework (Phase 7, STEP 6).
 *
 * A worker that consumes an `IQueue`, applies a configurable retry policy (with
 * exponential backoff), routes exhausted jobs to a dead-letter queue, and exposes
 * monitoring hooks. Also a scheduler for recurring jobs. The worker is tick-driven
 * (deterministic, testable) — production drives `poll()` on a timer. No money moves.
 */
import { type IQueue } from './queue';

export interface RetryPolicy {
  maxAttempts: number;
  /** Base backoff; delay = baseDelayMs * factor^(attempt-1), capped at maxDelayMs. */
  baseDelayMs: number;
  factor: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 1_000, factor: 2, maxDelayMs: 60_000 };

export function backoffDelay(policy: RetryPolicy, attempt: number): number {
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * Math.pow(policy.factor, Math.max(0, attempt - 1)));
}

export interface JobHandler<T> {
  (payload: T, ctx: { attempt: number; jobId: string }): Promise<void> | void;
}

export interface WorkerHooks<T> {
  onSuccess?: (payload: T, meta: { attempts: number }) => void;
  onRetry?: (payload: T, meta: { attempt: number; delayMs: number; error: Error }) => void;
  onDeadLetter?: (payload: T, meta: { attempts: number; error: Error }) => void;
}

export interface WorkerStats {
  processed: number;
  succeeded: number;
  retried: number;
  deadLettered: number;
  failed: number;
}

export class Worker<T> {
  private running = false;
  private readonly stats: WorkerStats = { processed: 0, succeeded: 0, retried: 0, deadLettered: 0, failed: 0 };

  constructor(
    readonly name: string,
    private readonly queue: IQueue<T>,
    private readonly handler: JobHandler<T>,
    private readonly opts: { retry?: RetryPolicy; hooks?: WorkerHooks<T>; clock?: () => number } = {},
  ) {}

  private get retry(): RetryPolicy {
    return this.opts.retry ?? DEFAULT_RETRY;
  }

  start(): void {
    this.running = true;
  }
  stop(): void {
    this.running = false;
  }
  isRunning(): boolean {
    return this.running;
  }
  getStats(): Readonly<WorkerStats> {
    return { ...this.stats };
  }

  /** Process a single available message (returns false if none / stopped). */
  async poll(now?: number): Promise<boolean> {
    if (!this.running) return false;
    const msg = this.queue.dequeue(now);
    if (!msg) return false;
    this.stats.processed += 1;
    try {
      await this.handler(msg.payload, { attempt: msg.attempts, jobId: msg.id });
      this.queue.ack(msg.id);
      this.stats.succeeded += 1;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.stats.failed += 1;
      if (msg.attempts >= this.retry.maxAttempts) {
        this.queue.nack(msg.id, { toDeadLetter: true });
        this.stats.deadLettered += 1;
        this.opts.hooks?.onDeadLetter?.(msg.payload, { attempts: msg.attempts, error });
      } else {
        const delayMs = backoffDelay(this.retry, msg.attempts);
        this.queue.nack(msg.id, { delayMs });
        this.stats.retried += 1;
        this.opts.hooks?.onRetry?.(msg.payload, { attempt: msg.attempts, delayMs, error });
      }
      return true;
    }
    this.opts.hooks?.onSuccess?.(msg.payload, { attempts: msg.attempts });
    return true;
  }

  /** Drain up to `max` available messages this tick. */
  async drain(max = 100, now?: number): Promise<number> {
    let n = 0;
    while (n < max && (await this.poll(now))) n += 1;
    return n;
  }
}

/* -------------------------------- scheduler ------------------------------- */

export interface ScheduledJob {
  id: string;
  everyMs: number;
  run: (now: number) => void;
  lastRunAt?: number;
}

/** A deterministic interval scheduler — production drives `tick()` on a timer. */
export class Scheduler {
  private readonly jobs = new Map<string, ScheduledJob>();
  constructor(private readonly clock: () => number = () => Date.now()) {}

  every(id: string, everyMs: number, run: (now: number) => void): void {
    this.jobs.set(id, { id, everyMs, run });
  }
  remove(id: string): void {
    this.jobs.delete(id);
  }

  /** Run every job whose interval has elapsed. Returns the ids that ran. */
  tick(now: number = this.clock()): string[] {
    const ran: string[] = [];
    for (const job of this.jobs.values()) {
      if (job.lastRunAt === undefined || now - job.lastRunAt >= job.everyMs) {
        job.run(now);
        job.lastRunAt = now;
        ran.push(job.id);
      }
    }
    return ran;
  }
}
