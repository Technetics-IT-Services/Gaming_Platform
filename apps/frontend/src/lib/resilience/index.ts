/**
 * Scalability, HA & resilience platform (Phase 10) — public surface.
 *
 * Operational resilience added as WRAPPERS/ADAPTERS around the frozen platform:
 * circuit breakers, bulkheads, timeouts, retry budgets, fallbacks, adaptive rate
 * limiting, backpressure, graceful degradation, leader election, health-based routing,
 * a chaos-engineering framework, capacity math and an SRE/SLO engine. It changes no
 * business, financial or architectural logic — it only protects and measures.
 */
export {
  ResilienceError,
  CircuitBreaker,
  CircuitState,
  Bulkhead,
  withTimeout,
  RetryBudget,
  withFallback,
  type CircuitBreakerOptions,
  type TimeoutOptions,
} from './patterns';
export { Resilience, type ResilienceOptions } from './resilient';
export {
  AdaptiveRateLimiter,
  BackpressureMonitor,
  LoadLevel,
  DegradationRegistry,
  type AdaptiveRateLimiterOptions,
  type BackpressureThresholds,
  type DegradationMode,
} from './load-shedding';
export {
  LeaderElection,
  InMemoryLeaseStore,
  type LeaseStore,
  HealthBasedRouter,
  EndpointState,
  type Endpoint,
} from './ha';
export {
  FailureInjector,
  ChaosExperiment,
  simulate,
  type FailureProfile,
  type ExperimentResult,
} from './chaos';
export {
  sizeReplicas,
  sizeWorkers,
  sizeConnectionPool,
  planPeak,
  estimateCost,
  projectGrowth,
  type ServiceProfile,
  type QueueProfile,
  type CostModel,
} from './capacity';
export { SLOTracker, SREPlatform, type SLO, type SLOStatus } from './sre';
