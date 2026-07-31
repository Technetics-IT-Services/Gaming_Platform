/**
 * Multi-Tenant Platform facade (Phase 3.1).
 *
 * Wires the additive tenancy capabilities into one entry point: registry, resolver,
 * lifecycle, hierarchical configuration, feature flags, brand, theme, resource isolation,
 * quotas, observability and middleware. `buildContext` resolves a request to a fully
 * hydrated `TenantContext` (flags + config + brand resolved through their hierarchies);
 * `run` executes a handler inside that context. The frozen platform is never touched —
 * this only orchestrates the wrappers around it.
 */
import { buildTenantContext } from './context';
import { ConfigurationPlatform } from './configuration';
import { BrandPlatform } from './brand';
import { FeatureFlagService } from './feature-flags';
import { TenantLifecycleManager, type LifecycleHooks } from './lifecycle';
import { TenantMiddleware, type MiddlewareHooks } from './middleware';
import { TenantObservability, type TelemetrySinks } from './observability';
import { QuotaService } from './quotas';
import { TenantRegistry } from './registry';
import { ResourceNamespace, TenantQueues, TenantScopedKV } from './isolation';
import { TenantResolver, type ResolverOptions } from './resolver';
import { ThemePlatform } from './theme';
import {
  type Tenant,
  type TenantContext,
  type TenantResolutionInput,
  TenantResolutionSource,
} from './types';

export interface MultiTenantPlatformOptions {
  clock?: () => number;
  resolver?: ResolverOptions;
  environment?: string;
  telemetry?: TelemetrySinks;
  lifecycleHooks?: LifecycleHooks;
  middlewareHooks?: MiddlewareHooks;
}

export class MultiTenantPlatform {
  readonly registry: TenantRegistry;
  readonly resolver: TenantResolver;
  readonly lifecycle: TenantLifecycleManager;
  readonly config: ConfigurationPlatform;
  readonly flags: FeatureFlagService;
  readonly brand: BrandPlatform;
  readonly theme: ThemePlatform;
  readonly quotas: QuotaService;
  readonly observability: TenantObservability;
  readonly storage: TenantScopedKV;
  readonly cache: TenantScopedKV;
  readonly queues: TenantQueues;
  readonly middleware: TenantMiddleware;
  private readonly environment: string;

  constructor(opts: MultiTenantPlatformOptions = {}) {
    const clock = opts.clock ?? (() => Date.now());
    this.environment = opts.environment ?? 'production';
    this.registry = new TenantRegistry(clock);
    this.resolver = new TenantResolver(this.registry, opts.resolver);
    this.config = new ConfigurationPlatform();
    this.flags = new FeatureFlagService();
    this.brand = new BrandPlatform();
    this.theme = new ThemePlatform();
    this.quotas = new QuotaService(clock);
    this.observability = new TenantObservability(opts.telemetry, clock);
    this.storage = new TenantScopedKV();
    this.cache = new TenantScopedKV();
    this.queues = new TenantQueues();

    // Lifecycle side-effects: reset a tenant's live counters when it stops serving.
    const hooks: LifecycleHooks = {
      ...opts.lifecycleHooks,
      onSuspend: (t) => { this.quotas.resetTenant(t.id); opts.lifecycleHooks?.onSuspend?.(t); },
      onDelete: (t) => { this.quotas.resetTenant(t.id); this.storage.clear(t.id); this.cache.clear(t.id); opts.lifecycleHooks?.onDelete?.(t); },
    };
    this.lifecycle = new TenantLifecycleManager(this.registry, hooks);
    this.middleware = new TenantMiddleware((input) => this.buildContext(input), opts.middlewareHooks);
  }

  /** Resolve a request → a fully hydrated, immutable `TenantContext`. */
  buildContext(input: TenantResolutionInput): TenantContext {
    const { tenant, source } = this.resolver.resolve(input);
    return this.contextForTenant(tenant, { ...input, source });
  }

  /** Build a context for an already-known tenant (internal / testing). */
  contextForTenant(tenant: Tenant, input: TenantResolutionInput & { source?: TenantResolutionSource } = {}): TenantContext {
    const featureFlags = this.flags.resolveAll(
      { tenantId: tenant.id, operatorId: tenant.operatorId, plan: tenant.plan },
      tenant.features,
    );
    const configuration = this.config.resolve({
      region: tenant.region,
      tenantId: tenant.id,
      tenantConfig: tenant.configuration,
      environment: this.environment,
      currency: tenant.currency,
      locale: tenant.locale,
    });
    const brand = this.brand.resolve({ tenantId: tenant.id, operatorId: tenant.operatorId, tenantBrand: tenant.brand });

    return buildTenantContext(
      { ...tenant, configuration, brand },
      { resolvedVia: input.source ?? TenantResolutionSource.InternalContext, operatorId: input.operatorId, permissions: input.permissions, requestId: input.requestId, featureFlags },
    );
  }

  /** Resolve + run a handler inside the tenant context (delegates to the middleware). */
  run<T>(input: TenantResolutionInput, handler: (ctx: TenantContext) => T | Promise<T>): Promise<T> {
    return this.middleware.dispatch(input, handler);
  }

  /** A tenant-bound resource-namespace helper. */
  namespace(tenantId: string): ResourceNamespace {
    return new ResourceNamespace(tenantId);
  }
}
