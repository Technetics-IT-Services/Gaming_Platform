/**
 * Configuration Platform (Phase 3.1, STEP 6).
 *
 * Hierarchical configuration resolution:
 *   Global → Region → Tenant → Environment → Request Override
 * Each layer contributes a partial `TenantConfiguration`; `resolve` deep-merges them in
 * precedence order (later wins). Supports deposit/withdrawal limits, currencies,
 * languages, responsible gaming, payment providers, game availability and notification
 * settings. Pure + deterministic; owns no money and touches no frozen module.
 */
import { defaultConfiguration } from './defaults';
import type { TenantConfiguration } from './types';

export type PartialConfig = DeepPartial<TenantConfiguration>;

export interface ConfigResolveInput {
  region?: string;
  tenantId?: string;
  /** The tenant's own stored configuration (highest non-request tenant layer). */
  tenantConfig?: PartialConfig;
  environment?: string;
  requestOverride?: PartialConfig;
  /** Currency/locale used to seed the global defaults. */
  currency?: string;
  locale?: string;
}

export class ConfigurationPlatform {
  private global: PartialConfig = {};
  private readonly byRegion = new Map<string, PartialConfig>();
  private readonly byTenant = new Map<string, PartialConfig>();
  private readonly byEnvironment = new Map<string, PartialConfig>();

  setGlobal(config: PartialConfig): void {
    this.global = config;
  }
  setRegion(region: string, config: PartialConfig): void {
    this.byRegion.set(region, config);
  }
  setTenant(tenantId: string, config: PartialConfig): void {
    this.byTenant.set(tenantId, config);
  }
  setEnvironment(environment: string, config: PartialConfig): void {
    this.byEnvironment.set(environment, config);
  }

  /** Resolve the effective configuration for a request through the full hierarchy. */
  resolve(input: ConfigResolveInput): TenantConfiguration {
    const layers: PartialConfig[] = [
      defaultConfiguration(input.currency, input.locale),
      this.global,
      input.region ? this.byRegion.get(input.region) ?? {} : {},
      input.tenantId ? this.byTenant.get(input.tenantId) ?? {} : {},
      input.tenantConfig ?? {},
      input.environment ? this.byEnvironment.get(input.environment) ?? {} : {},
      input.requestOverride ?? {},
    ];
    return layers.reduce<TenantConfiguration>((acc, layer) => deepMerge(acc, layer), {} as TenantConfiguration);
  }

  /** Explain which layers contributed (for debugging / audit). */
  describe(input: ConfigResolveInput): { layer: string; present: boolean }[] {
    return [
      { layer: 'global', present: Object.keys(this.global).length > 0 },
      { layer: `region:${input.region ?? '-'}`, present: !!(input.region && this.byRegion.has(input.region)) },
      { layer: `tenant:${input.tenantId ?? '-'}`, present: !!(input.tenantId && this.byTenant.has(input.tenantId)) || !!input.tenantConfig },
      { layer: `environment:${input.environment ?? '-'}`, present: !!(input.environment && this.byEnvironment.has(input.environment)) },
      { layer: 'requestOverride', present: !!input.requestOverride },
    ];
  }
}

/* --------------------------------- helpers ---------------------------------- */

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer _U> ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-merge `patch` onto `base` (arrays replace; objects merge). */
export function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (patch === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch as unknown as T) ?? base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const prev = out[key];
    out[key] = isPlainObject(prev) && isPlainObject(value) ? deepMerge(prev, value as DeepPartial<typeof prev>) : value;
  }
  return out as T;
}
