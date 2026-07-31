/**
 * Production infrastructure library (Phase 7) — public surface.
 *
 * Framework-agnostic building blocks for operating the enterprise platform: a
 * validated configuration loader with secrets + feature flags + tenant config, a
 * queue abstraction with dead-lettering, a retry-aware background-job framework and
 * scheduler, a liveness/readiness health registry, and build/version metadata. It
 * changes no business logic and touches no frozen module — pure operational plumbing.
 */
export {
  Environment,
  ConfigValidationError,
  loadConfig,
  FeatureFlags,
  TenantConfigRegistry,
  profileDefaults,
  type FieldSpec,
  type ConfigSchema,
  type ConfigIssue,
  type LoadOptions,
  type LoadedConfig,
  type FlagScope,
  type TenantConfig,
} from './config';
export { InMemoryQueue, type IQueue, type QueueMessage } from './queue';
export {
  Worker,
  Scheduler,
  backoffDelay,
  DEFAULT_RETRY,
  type RetryPolicy,
  type JobHandler,
  type WorkerHooks,
  type WorkerStats,
  type ScheduledJob,
} from './jobs';
export { HealthRegistry, HealthState, probes, type HealthCheck, type ProbeResult, type ComponentReport, type HealthReport } from './health';
export { buildInfo, compareVersions, type BuildInfo } from './version';
