/**
 * Adaptive rate limiting, backpressure & graceful degradation (Phase 10, STEP 3).
 *
 * A token-bucket rate limiter that **adapts** its rate to observed error load (AIMD),
 * a backpressure monitor that signals when to shed load, and a degradation registry
 * that flips features into reduced modes. Pure control logic — it decides, it does not
 * change any business behavior.
 */

/* ------------------------- adaptive rate limiter -------------------------- */

export interface AdaptiveRateLimiterOptions {
  /** Steady-state permits per second. */
  baseRatePerSec: number;
  minRatePerSec?: number;
  maxRatePerSec?: number;
  /** Multiplicative decrease factor on overload. */
  decreaseFactor?: number;
  /** Additive increase (permits/sec) on healthy windows. */
  increaseStep?: number;
  burst?: number;
  clock?: () => number;
}

export class AdaptiveRateLimiter {
  private rate: number;
  private tokens: number;
  private lastRefill: number;
  private readonly min: number;
  private readonly max: number;
  private readonly decrease: number;
  private readonly increase: number;
  private readonly burst: number;
  private readonly clock: () => number;

  constructor(opts: AdaptiveRateLimiterOptions) {
    this.rate = opts.baseRatePerSec;
    this.min = opts.minRatePerSec ?? Math.max(1, Math.floor(opts.baseRatePerSec / 10));
    this.max = opts.maxRatePerSec ?? opts.baseRatePerSec * 4;
    this.decrease = opts.decreaseFactor ?? 0.5;
    this.increase = opts.increaseStep ?? Math.max(1, Math.floor(opts.baseRatePerSec / 20));
    this.burst = opts.burst ?? opts.baseRatePerSec;
    this.clock = opts.clock ?? (() => Date.now());
    this.tokens = this.burst;
    this.lastRefill = this.clock();
  }

  currentRate(): number {
    return this.rate;
  }

  private refill(): void {
    const now = this.clock();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate);
      this.lastRefill = now;
    }
  }

  /** Try to admit a request. */
  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Feedback: overload (e.g. high latency / 429s) → multiplicatively decrease. */
  onOverload(): void {
    this.rate = Math.max(this.min, Math.floor(this.rate * this.decrease));
  }
  /** Feedback: a healthy window → additively increase toward the ceiling. */
  onHealthy(): void {
    this.rate = Math.min(this.max, this.rate + this.increase);
  }
}

/* ------------------------------ backpressure ------------------------------ */

export interface BackpressureThresholds {
  /** Queue depth at which to start shedding non-critical load. */
  warn: number;
  /** Queue depth at which to shed all non-critical load. */
  shed: number;
}
export enum LoadLevel {
  Normal = 'normal',
  Elevated = 'elevated',
  Shedding = 'shedding',
}

/** Turns a live queue-depth / in-flight signal into an admission decision. */
export class BackpressureMonitor {
  constructor(private readonly thresholds: BackpressureThresholds) {}

  level(depth: number): LoadLevel {
    if (depth >= this.thresholds.shed) return LoadLevel.Shedding;
    if (depth >= this.thresholds.warn) return LoadLevel.Elevated;
    return LoadLevel.Normal;
  }

  /** Should a request of the given priority be admitted at this depth? */
  admit(depth: number, priority: 'critical' | 'normal' | 'low'): boolean {
    const level = this.level(depth);
    if (level === LoadLevel.Normal) return true;
    if (level === LoadLevel.Elevated) return priority !== 'low'; // drop low-priority first
    return priority === 'critical'; // shedding: only critical (e.g. money paths)
  }
}

/* --------------------------- graceful degradation ------------------------- */

export interface DegradationMode {
  feature: string;
  degraded: boolean;
  /** e.g. 'serve_cache', 'disable_recommendations', 'read_only'. */
  strategy?: string;
  since?: number;
}

/**
 * A registry of features that can be flipped into a degraded mode during incidents,
 * so the platform sheds cost while keeping money-critical paths intact.
 */
export class DegradationRegistry {
  private readonly modes = new Map<string, DegradationMode>();
  constructor(private readonly clock: () => number = () => Date.now()) {}

  degrade(feature: string, strategy: string): void {
    this.modes.set(feature, { feature, degraded: true, strategy, since: this.clock() });
  }
  restore(feature: string): void {
    this.modes.set(feature, { feature, degraded: false });
  }
  isDegraded(feature: string): boolean {
    return this.modes.get(feature)?.degraded ?? false;
  }
  strategyFor(feature: string): string | undefined {
    const m = this.modes.get(feature);
    return m?.degraded ? m.strategy : undefined;
  }
  active(): DegradationMode[] {
    return [...this.modes.values()].filter((m) => m.degraded);
  }
}
