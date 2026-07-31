/**
 * Performance validation & qualification tooling (Phase 11) — public surface.
 *
 * Benchmarking, synthetic load/stress/soak testing, latency histograms, profiling,
 * performance-regression checks and a production-qualification scorecard. All pure
 * measurement/reporting tooling — it observes and grades the frozen platform and
 * changes no business, financial or architectural logic.
 */
export { LatencyHistogram, type LatencyStats } from './histogram';
export { Benchmark, BenchmarkSuite, defaultClock, type BenchmarkResult, type BenchmarkOptions, type Clock } from './benchmark';
export {
  arrivalSchedule,
  runLoad,
  stressRamp,
  type WorkloadPattern,
  type LoadOp,
  type LoadResult,
  type StressResult,
} from './workload';
export { analyzeTrend, soakReport, type ResourceSample, type TrendResult, type SoakReport } from './soak';
export { Profiler, QueryProfiler, CacheStats, type QueryStat } from './profiling';
export {
  RegressionChecker,
  metricTrend,
  type Baseline,
  type MetricThreshold,
  type RegressionReport,
  type MetricComparison,
} from './regression';
export { qualify, scorecardReport, type QualCheck, type Scorecard, type Grade } from './qualification';
