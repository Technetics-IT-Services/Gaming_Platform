/**
 * Soak testing & leak detection (Phase 11, STEP 4).
 *
 * Analyzes a long-duration series of resource samples (memory, connections, queue
 * depth) and flags a sustained upward trend via least-squares linear regression + fit
 * quality (R²). Deterministic pure math — it observes stability, it changes nothing.
 */

export interface ResourceSample {
  at: number;
  value: number;
}
export interface TrendResult {
  slopePerSample: number;
  /** Projected growth over the observed window. */
  totalGrowth: number;
  rSquared: number;
  leaking: boolean;
}

/** Least-squares slope + R² over a series; flags a leak on a strong positive trend. */
export function analyzeTrend(samples: ResourceSample[], opts: { slopeThreshold?: number; minRSquared?: number } = {}): TrendResult {
  const n = samples.length;
  if (n < 3) return { slopePerSample: 0, totalGrowth: 0, rSquared: 0, leaking: false };
  const xs = samples.map((_, i) => i);
  const ys = samples.map((s) => s.value);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const rSquared = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  const slopeThreshold = opts.slopeThreshold ?? 0.5; // value units per sample
  const minRSquared = opts.minRSquared ?? 0.8;
  const leaking = slope > slopeThreshold && rSquared >= minRSquared;
  return { slopePerSample: Math.round(slope * 1000) / 1000, totalGrowth: Math.round(slope * (n - 1) * 1000) / 1000, rSquared: Math.round(rSquared * 1000) / 1000, leaking };
}

export interface SoakReport {
  durationSamples: number;
  memory: TrendResult;
  connections: TrendResult;
  queueDepth: TrendResult;
  stable: boolean;
}

/** Aggregate a soak run's stability across resource dimensions. */
export function soakReport(input: { memory: ResourceSample[]; connections: ResourceSample[]; queueDepth: ResourceSample[] }): SoakReport {
  const memory = analyzeTrend(input.memory);
  const connections = analyzeTrend(input.connections);
  const queueDepth = analyzeTrend(input.queueDepth);
  return {
    durationSamples: Math.max(input.memory.length, input.connections.length, input.queueDepth.length),
    memory,
    connections,
    queueDepth,
    stable: !memory.leaking && !connections.leaking && !queueDepth.leaking,
  };
}
