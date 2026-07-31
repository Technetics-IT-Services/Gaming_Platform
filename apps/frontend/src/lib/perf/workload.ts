/**
 * Synthetic traffic generation, load & stress testing (Phase 11, STEP 2 & 3).
 *
 * A workload generator (steady/burst/ramp/mixed arrival schedules), a closed-loop load
 * simulator that drives an op at bounded concurrency and reports throughput + latency +
 * errors, and a stress runner that ramps concurrency until an SLO breaks (the "knee").
 * Ops report their own `{ok, latencyMs}` so runs are deterministic in tests and bind to
 * real, wall-clock-measured calls in production. Measurement only.
 */
import { LatencyHistogram, type LatencyStats } from './histogram';

/* --------------------------- workload generation -------------------------- */

export type WorkloadPattern =
  | { kind: 'steady'; rps: number; durationSec: number }
  | { kind: 'burst'; baseRps: number; spikeRps: number; spikeAtSec: number; spikeDurationSec: number; durationSec: number }
  | { kind: 'ramp'; fromRps: number; toRps: number; durationSec: number }
  | { kind: 'mixed'; segments: WorkloadPattern[] };

/** Produce request arrival offsets (ms from start) for a pattern. */
export function arrivalSchedule(pattern: WorkloadPattern, offsetMs = 0): number[] {
  switch (pattern.kind) {
    case 'steady': {
      const out: number[] = [];
      const gap = 1000 / pattern.rps;
      for (let t = 0; t < pattern.durationSec * 1000; t += gap) out.push(offsetMs + t);
      return out;
    }
    case 'ramp': {
      const out: number[] = [];
      const totalMs = pattern.durationSec * 1000;
      let t = 0;
      while (t < totalMs) {
        const frac = t / totalMs;
        const rps = pattern.fromRps + (pattern.toRps - pattern.fromRps) * frac;
        out.push(offsetMs + t);
        t += 1000 / Math.max(1, rps);
      }
      return out;
    }
    case 'burst': {
      const out: number[] = [];
      const totalMs = pattern.durationSec * 1000;
      const spikeStart = pattern.spikeAtSec * 1000;
      const spikeEnd = spikeStart + pattern.spikeDurationSec * 1000;
      for (let t = 0; t < totalMs; ) {
        const inSpike = t >= spikeStart && t < spikeEnd;
        const rps = inSpike ? pattern.spikeRps : pattern.baseRps;
        out.push(offsetMs + t);
        t += 1000 / Math.max(1, rps);
      }
      return out;
    }
    case 'mixed': {
      let cursor = offsetMs;
      const out: number[] = [];
      for (const seg of pattern.segments) {
        const sched = arrivalSchedule(seg, cursor);
        out.push(...sched);
        cursor = (sched[sched.length - 1] ?? cursor) + 1;
      }
      return out;
    }
  }
}

/* ------------------------------ load simulator ---------------------------- */

/** An op reports success + its measured latency (real runs measure wall time). */
export type LoadOp = (requestIndex: number) => Promise<{ ok: boolean; latencyMs: number }>;

export interface LoadResult {
  requests: number;
  errors: number;
  errorRate: number;
  /** Closed-loop throughput: concurrency / mean-latency. */
  throughputPerSec: number;
  latency: LatencyStats;
  concurrency: number;
}

/**
 * Closed-loop load: `concurrency` virtual users each issue requests until `requests`
 * are served. Throughput is derived from the concurrency and observed mean latency
 * (Little's Law), so results are deterministic given deterministic op latencies.
 */
export async function runLoad(op: LoadOp, opts: { requests: number; concurrency: number }): Promise<LoadResult> {
  const hist = new LatencyHistogram();
  let errors = 0;
  let issued = 0;
  const worker = async () => {
    while (issued < opts.requests) {
      const idx = issued++;
      if (idx >= opts.requests) break;
      const r = await op(idx);
      hist.record(r.latencyMs);
      if (!r.ok) errors += 1;
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency }, () => worker()));
  const latency = hist.stats();
  const throughputPerSec = latency.mean > 0 ? Math.round((opts.concurrency * 1000) / latency.mean) : 0;
  return { requests: opts.requests, errors, errorRate: opts.requests ? errors / opts.requests : 0, throughputPerSec, latency, concurrency: opts.concurrency };
}

/* ------------------------------ stress testing ---------------------------- */

export interface StressResult {
  levels: { concurrency: number; result: LoadResult }[];
  /** The concurrency just before the SLO/error breach — the sustainable knee. */
  kneeConcurrency: number;
  breachedAt?: number;
}

/**
 * Ramp concurrency until p95 latency exceeds `sloP95Ms` or error rate exceeds
 * `maxErrorRate`. `makeOp(concurrency)` returns an op whose latency reflects that load
 * (a model in tests; a real system call in staging). Finds the sustainable knee.
 */
export async function stressRamp(
  makeOp: (concurrency: number) => LoadOp,
  opts: { startConcurrency: number; step: number; maxConcurrency: number; requestsPerLevel: number; sloP95Ms: number; maxErrorRate?: number },
): Promise<StressResult> {
  const maxErrorRate = opts.maxErrorRate ?? 0.01;
  const levels: StressResult['levels'] = [];
  let knee = opts.startConcurrency;
  let breachedAt: number | undefined;
  for (let c = opts.startConcurrency; c <= opts.maxConcurrency; c += opts.step) {
    const result = await runLoad(makeOp(c), { requests: opts.requestsPerLevel, concurrency: c });
    levels.push({ concurrency: c, result });
    if (result.latency.p95 > opts.sloP95Ms || result.errorRate > maxErrorRate) {
      breachedAt = c;
      break;
    }
    knee = c;
  }
  return { levels, kneeConcurrency: knee, breachedAt };
}
