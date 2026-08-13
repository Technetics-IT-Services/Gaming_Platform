/**
 * Tenant Control Plane — server-only public surface (Phase 3.2).
 *
 * The persistent, operational control plane over the Phase 3.1 Multi-Tenant Foundation.
 * This barrel is SERVER-ONLY (it uses `node:crypto` / `node:async_hooks`) and is therefore
 * NOT re-exported from the browser-safe `../index.ts`. Additive — it wraps the permanently
 * frozen Enterprise Platform and never modifies it.
 */
export { TenantControlPlane, type ControlPlaneOptions } from './control-plane';
export { PersistentTenantRegistry } from './persistent-registry';

export { TenantAsyncContext, TenantContextError } from './async-context';
export {
  ControlPlaneRole,
  ControlPlanePermission,
  authorize,
  hasPermission,
  isPlatformScoped,
  SYSTEM_AUTH,
  type ControlPlaneAuth,
  type AuthDecision,
} from './rbac';
export { ControlPlaneCache, cacheKey, type CacheKind } from './cache';
export { ControlPlaneObservability, type ControlPlaneSink, type ControlPlaneOperationRecord, type CounterName } from './observability';

export { generateApiKey, hashSecret, verifyAgainstHash, verificationToken, correlationId, type GeneratedApiKey } from './crypto';

export { AuditService, type AuditInput } from './audit-service';
export { ConfigurationService, type ConfigDiffEntry, type EffectiveConfigInput } from './configuration-service';
export { FeatureFlagService, rolloutBucket, type FlagContext } from './feature-flag-service';
export { DomainService, MockDomainVerificationProvider, type DomainVerificationProvider } from './domain-service';
export { ApiKeyService, type ApiKeyView, type IssuedApiKey } from './api-key-service';
export { SecretNamespaceService, InMemorySecretManager, secretPath, type SecretManagerPort, type SecretNamespace } from './secret-namespace-service';
export { LifecycleService, type TransitionInput } from './lifecycle-service';
export { ProvisioningService, type ProvisionInput, type ProvisionResult } from './provisioning-service';
