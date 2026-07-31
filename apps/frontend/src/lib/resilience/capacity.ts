/**
 * Capacity engineering (Phase 10, STEP 8).
 *
 * Pure sizing math: replicas from RPS + per-pod capacity (Little's Law), worker count
 * from queue arrival/service rate, DB connection-pool sizing, peak-traffic planning,
 * a simple cost model and growth projection. Deterministic, side-effect-free —
 * planning tooling, not a runtime path.
 */

export interface ServiceProfile {
  /** Sustained requests per second at steady state. */
  rps: number;
  /** Mean request service time (ms). */
  latencyMs: number;
  /** Target per-pod CPU utilization (0–1) to size against. */
  targetUtilization?: number;
  /** Max concurrent requests one pod can serve at target utilization. */
  perPodConcurrency: number;
  /** Headroom multiplier for spikes (e.g. 1.3 = +30%). */
  headroom?: number;
}

/** Replicas needed for a service (Little's Law: concurrency = rps × latency). */
export function sizeReplicas(profile: ServiceProfile): { concurrency: number; replicas: number } {
  const headroom = profile.headroom ?? 1.3;
  const targetUtil = profile.targetUtilization ?? 0.65;
  const concurrency = (profile.rps * profile.latencyMs) / 1000; // avg in-flight requests
  const perPodEffective = profile.perPodConcurrency * targetUtil;
  const replicas = Math.max(1, Math.ceil((concurrency * headroom) / perPodEffective));
  return { concurrency: Math.ceil(concurrency), replicas };
}

export interface QueueProfile {
  /** Jobs arriving per second. */
  arrivalRatePerSec: number;
  /** Jobs one worker completes per second. */
  serviceRatePerWorker: number;
  /** Target max utilization per worker (0–1). */
  targetUtilization?: number;
}
/** Workers needed to keep the queue stable (ρ = λ / (c·μ) < target). */
export function sizeWorkers(profile: QueueProfile): { workers: number; utilization: number } {
  const target = profile.targetUtilization ?? 0.7;
  const workers = Math.max(1, Math.ceil(profile.arrivalRatePerSec / (profile.serviceRatePerWorker * target)));
  const utilization = profile.arrivalRatePerSec / (workers * profile.serviceRatePerWorker);
  return { workers, utilization: Math.round(utilization * 100) / 100 };
}

/** DB connections: pods × per-pod pool, checked against the server max. */
export function sizeConnectionPool(input: { replicas: number; workers?: number; perInstancePool: number; serverMaxConnections: number; reservedForAdmin?: number }): { requested: number; withinLimit: boolean; recommendedPerInstance: number } {
  const instances = input.replicas + (input.workers ?? 0);
  const requested = instances * input.perInstancePool;
  const available = input.serverMaxConnections - (input.reservedForAdmin ?? 10);
  const withinLimit = requested <= available;
  const recommendedPerInstance = Math.max(1, Math.floor(available / Math.max(1, instances)));
  return { requested, withinLimit, recommendedPerInstance };
}

/** Peak planning: scale the steady-state profile by a peak multiplier. */
export function planPeak(profile: ServiceProfile, peakMultiplier: number): { replicas: number; concurrency: number } {
  return sizeReplicas({ ...profile, rps: profile.rps * peakMultiplier });
}

export interface CostModel {
  /** Monthly cost per pod (compute). */
  perPodMonthly: number;
  perWorkerMonthly: number;
  /** Fixed monthly (DB, Redis, LB, egress baseline). */
  fixedMonthly: number;
}
/** Rough monthly cost for a sizing. */
export function estimateCost(replicas: number, workers: number, cost: CostModel): number {
  return replicas * cost.perPodMonthly + workers * cost.perWorkerMonthly + cost.fixedMonthly;
}

/** Compound monthly-growth projection of RPS over N months. */
export function projectGrowth(currentRps: number, monthlyGrowthRate: number, months: number): number[] {
  const out: number[] = [];
  let rps = currentRps;
  for (let m = 0; m < months; m += 1) {
    rps *= 1 + monthlyGrowthRate;
    out.push(Math.round(rps));
  }
  return out;
}
