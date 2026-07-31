/**
 * Enterprise Multi-Tenant Foundation (Version 3.0, Phase 3.1) — public surface.
 *
 * An ADDITIVE SaaS layer over the permanently FROZEN Enterprise Casino Platform. One
 * shared platform, unlimited tenants, isolated purely by `TenantContext`. Nothing here
 * modifies, forks or duplicates Runtime, Wallet, Ledger, Treasury, Payments, Games,
 * Poker, Lottery, CRM, Analytics, Security or Infrastructure — it wraps them.
 */
export * from './types';
export { PLAN_LIMITS, PLAN_FEATURES, defaultBrand, defaultTheme, defaultConfiguration } from './defaults';

export { TenantRegistry, TenantError, type CreateTenantInput, type UpdateTenantInput, type TenantQuery } from './registry';
export { TenantResolver, TenantResolutionError, type ResolvedTenant, type ResolverOptions } from './resolver';
export { TenantScope, TenantContextError, buildTenantContext, isServable } from './context';
export { TenantMiddleware, type ContextFactory, type MiddlewareHooks } from './middleware';

export { ConfigurationPlatform, deepMerge, type PartialConfig, type ConfigResolveInput, type DeepPartial } from './configuration';
export { FeatureFlagService, contextFlag, type FlagRule, type FlagEvaluationInput } from './feature-flags';
export { BrandPlatform } from './brand';
export { ThemePlatform } from './theme';

export { ResourceNamespace, TenantScopedKV, TenantQueues, namespaceKey, type ResourceKind } from './isolation';
export { TenantRepository, TenantOwnershipError, assertOwned, OWNED_ENTITY_KINDS, type TenantOwned, type OwnedEntityKind } from './ownership';
export { QuotaService, QuotaExceededError, type QuotaResource, type QuotaDecision } from './quotas';
export { TenantObservability, dimensionsOf, type TenantDimensions, type TelemetrySinks, type TenantLogEntry, type TenantMetric, type TenantAuditEvent } from './observability';

export { TenantLifecycleManager, TenantLifecycleError, canTransition, type LifecycleHooks } from './lifecycle';
export { tenantReference, tenantIdempotencyKey, contextualize, type AnyFn } from './ports';
export { MultiTenantPlatform, type MultiTenantPlatformOptions } from './platform';
