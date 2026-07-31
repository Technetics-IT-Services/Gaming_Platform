/**
 * SRE platform (Phase 10, STEP 9).
 *
 * SLO definitions, SLI calculation from good/bad event counts, an error-budget model
 * with burn-rate and multi-window alerting, and availability targets. Pure math over
 * recorded signals — it measures reliability, it does not change any behavior.
 */

export interface SLO {
  name: string;
  /** Target success ratio, e.g. 0.999 (three nines). */
  target: number;
  /** Rolling window (ms) the budget is measured over, e.g. 30 days. */
  windowMs: number;
  description?: string;
}

interface Sample {
  at: number;
  good: number;
  bad: number;
}

export interface SLOStatus {
  sli: number;
  target: number;
  budgetTotal: number;
  budgetConsumed: number;
  budgetRemaining: number;
  budgetRemainingRatio: number;
  burnRate: number;
  healthy: boolean;
}

/** Records SLI events for one SLO and computes its error budget over the window. */
export class SLOTracker {
  private readonly samples: Sample[] = [];
  constructor(readonly slo: SLO, private readonly clock: () => number = () => Date.now()) {}

  /** Record request outcomes (batch-friendly). */
  record(good: number, bad: number, at: number = this.clock()): void {
    this.samples.push({ at, good, bad });
  }

  private windowSamples(now: number): Sample[] {
    const cutoff = now - this.slo.windowMs;
    return this.samples.filter((s) => s.at >= cutoff);
  }

  status(now: number = this.clock()): SLOStatus {
    const inWindow = this.windowSamples(now);
    const good = inWindow.reduce((s, x) => s + x.good, 0);
    const bad = inWindow.reduce((s, x) => s + x.bad, 0);
    const total = good + bad;
    const sli = total === 0 ? 1 : good / total;
    const allowedBadRatio = 1 - this.slo.target;
    const budgetTotal = total * allowedBadRatio;
    const budgetConsumed = bad;
    const budgetRemaining = Math.max(0, budgetTotal - budgetConsumed);
    const budgetRemainingRatio = budgetTotal === 0 ? 1 : budgetRemaining / budgetTotal;
    // Burn rate = actual error ratio / allowed error ratio (>1 means burning too fast).
    const burnRate = allowedBadRatio === 0 ? (bad > 0 ? Infinity : 0) : (total === 0 ? 0 : (bad / total) / allowedBadRatio);
    return { sli, target: this.slo.target, budgetTotal, budgetConsumed, budgetRemaining, budgetRemainingRatio, burnRate, healthy: sli >= this.slo.target };
  }

  /**
   * Multi-window burn-rate alert (Google SRE): page when the budget would be exhausted
   * fast. Returns the highest severity triggered.
   */
  burnAlert(now: number = this.clock()): 'none' | 'ticket' | 'page' {
    const burn = this.status(now).burnRate;
    if (burn >= 14.4) return 'page'; // ~2% budget in 1h → page
    if (burn >= 3) return 'ticket'; // ~10% budget in 6h → ticket
    return 'none';
  }
}

/** Manage a set of SLOs (availability, latency, quality) as an SRE dashboard source. */
export class SREPlatform {
  private readonly trackers = new Map<string, SLOTracker>();
  constructor(private readonly clock: () => number = () => Date.now()) {}

  defineSLO(slo: SLO): SLOTracker {
    const tracker = new SLOTracker(slo, this.clock);
    this.trackers.set(slo.name, tracker);
    return tracker;
  }
  tracker(name: string): SLOTracker | undefined {
    return this.trackers.get(name);
  }

  /** Dashboard rollup across all SLOs. */
  dashboard(now: number = this.clock()): { name: string; status: SLOStatus; alert: ReturnType<SLOTracker['burnAlert']> }[] {
    return [...this.trackers.values()].map((t) => ({ name: t.slo.name, status: t.status(now), alert: t.burnAlert(now) }));
  }

  /** Convert an availability target to allowed downtime per 30-day window (minutes). */
  static downtimeBudgetMinutes(target: number, windowDays = 30): number {
    return Math.round((1 - target) * windowDays * 24 * 60 * 100) / 100;
  }
}
