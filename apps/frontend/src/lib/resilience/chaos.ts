/**
 * Chaos engineering framework (Phase 10, STEP 7).
 *
 * A failure-injection layer + experiment runner for validating resilience. A
 * `FailureInjector` wraps an async op to simulate latency, errors, or full outages;
 * category simulators cover dependency/queue/database outage and worker crashes. The
 * `ChaosExperiment` runner verifies a steady-state hypothesis before and after
 * injection and always rolls back. Test/staging tooling — never enabled in prod paths.
 */

export interface FailureProfile {
  /** Probability (0–1) of injecting a failure per call. */
  probability: number;
  /** Injected latency (ms) added before the op. */
  latencyMs?: number;
  /** When failing, throw this error instead of running the op. */
  error?: () => Error;
  /** Hard outage: always fail regardless of probability. */
  outage?: boolean;
}

/** Deterministic RNG seam so experiments are reproducible in tests. */
export type Rng = () => number;

export class FailureInjector {
  private profile: FailureProfile = { probability: 0 };
  readonly stats = { calls: 0, injectedLatency: 0, injectedErrors: 0 };

  constructor(
    private readonly rng: Rng = Math.random,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  configure(profile: FailureProfile): void {
    this.profile = profile;
  }
  reset(): void {
    this.profile = { probability: 0 };
  }

  /** Wrap an op with the current failure profile. */
  async wrap<T>(op: () => Promise<T>): Promise<T> {
    this.stats.calls += 1;
    const p = this.profile;
    const fail = p.outage || this.rng() < p.probability;
    if (p.latencyMs && (fail || p.latencyMs > 0)) {
      this.stats.injectedLatency += p.latencyMs;
      await this.sleep(p.latencyMs);
    }
    if (fail) {
      this.stats.injectedErrors += 1;
      throw (p.error ?? (() => new Error('chaos: injected failure')))();
    }
    return op();
  }
}

/** Named simulators for the required failure categories (STEP 7). */
export const simulate = {
  networkLatency(ms: number): FailureProfile {
    return { probability: 0, latencyMs: ms };
  },
  dependencyOutage(): FailureProfile {
    return { probability: 1, outage: true, error: () => new Error('chaos: dependency outage') };
  },
  intermittentErrors(probability: number): FailureProfile {
    return { probability, error: () => new Error('chaos: intermittent error') };
  },
  queueSaturation(): FailureProfile {
    return { probability: 1, outage: true, error: () => new Error('chaos: queue saturated') };
  },
  databaseOutage(): FailureProfile {
    return { probability: 1, outage: true, error: () => new Error('chaos: database unavailable') };
  },
  workerCrash(): FailureProfile {
    return { probability: 1, outage: true, error: () => new Error('chaos: worker crashed') };
  },
};

export interface ExperimentResult {
  name: string;
  steadyStateBefore: boolean;
  steadyStateAfter: boolean;
  survived: boolean;
  observations: string[];
}

/**
 * Runs a chaos experiment: verify steady state → inject failure → probe the system →
 * ALWAYS roll back → re-verify steady state. `survived` means the hypothesis held
 * under fault (the system degraded gracefully rather than breaking).
 */
export class ChaosExperiment {
  constructor(
    private readonly injector: FailureInjector,
    private readonly steadyState: () => Promise<boolean> | boolean,
  ) {}

  async run(input: { name: string; profile: FailureProfile; probe: () => Promise<boolean> | boolean }): Promise<ExperimentResult> {
    const observations: string[] = [];
    const before = await this.steadyState();
    observations.push(`steady-state before: ${before}`);

    this.injector.configure(input.profile);
    let survived = false;
    try {
      survived = await input.probe();
      observations.push(`probe under fault: ${survived ? 'handled' : 'failed'}`);
    } catch (e) {
      observations.push(`probe threw: ${(e as Error).message}`);
    } finally {
      this.injector.reset(); // rollback always
      observations.push('fault rolled back');
    }

    const after = await this.steadyState();
    observations.push(`steady-state after: ${after}`);
    return { name: input.name, steadyStateBefore: before, steadyStateAfter: after, survived, observations };
  }
}
