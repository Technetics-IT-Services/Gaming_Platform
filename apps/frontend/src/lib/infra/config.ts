/**
 * Configuration platform (Phase 7, STEP 3).
 *
 * A framework-agnostic runtime configuration loader: environment profiles, a
 * declarative + validated schema, secret injection (with masking), feature flags
 * (env- and tenant-scoped) and tenant configuration. It reads config values only —
 * it changes no business logic and touches no frozen module. Pure TS (no Node/Next).
 */

export enum Environment {
  Development = 'development',
  Staging = 'staging',
  Production = 'production',
  Test = 'test',
}

export type FieldType = 'string' | 'number' | 'boolean' | 'url' | 'enum';

export interface FieldSpec {
  type: FieldType;
  required?: boolean;
  default?: string | number | boolean;
  /** Sourced from the secret provider and masked in safe output. */
  secret?: boolean;
  /** Allowed values for `type: 'enum'`. */
  values?: string[];
  min?: number;
  max?: number;
  description?: string;
}
export type ConfigSchema = Record<string, FieldSpec>;

export interface ConfigIssue {
  key: string;
  message: string;
}
export class ConfigValidationError extends Error {
  constructor(readonly issues: ConfigIssue[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i.key}: ${i.message}`).join('\n')}`);
    this.name = 'ConfigValidationError';
  }
}

export interface LoadOptions {
  env?: Environment;
  /** Secret values injected out-of-band (e.g. from a mounted secret volume / vault). */
  secrets?: Record<string, string | undefined>;
}

export interface LoadedConfig<T> {
  env: Environment;
  values: T;
  get<K extends keyof T>(key: K): T[K];
  /** Config with secret fields masked — safe to log. */
  masked(): Record<string, unknown>;
}

function coerce(spec: FieldSpec, raw: string): { value?: string | number | boolean; error?: string } {
  switch (spec.type) {
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { error: `expected a number, got "${raw}"` };
      if (spec.min !== undefined && n < spec.min) return { error: `must be ≥ ${spec.min}` };
      if (spec.max !== undefined && n > spec.max) return { error: `must be ≤ ${spec.max}` };
      return { value: n };
    }
    case 'boolean': {
      if (['true', '1', 'yes', 'on'].includes(raw.toLowerCase())) return { value: true };
      if (['false', '0', 'no', 'off'].includes(raw.toLowerCase())) return { value: false };
      return { error: `expected a boolean, got "${raw}"` };
    }
    case 'url':
      try {
        const parsed = new URL(raw);
        return { value: parsed.href ? raw : raw };
      } catch {
        return { error: `expected a valid URL, got "${raw}"` };
      }
    case 'enum':
      if (!spec.values?.includes(raw)) return { error: `must be one of ${spec.values?.join(', ')}` };
      return { value: raw };
    default:
      return { value: raw };
  }
}

/**
 * Validate + load a typed configuration from a raw source (env vars), pulling secret
 * fields from the injected secret provider. Aggregates ALL issues before throwing.
 */
export function loadConfig<T = Record<string, unknown>>(raw: Record<string, string | undefined>, schema: ConfigSchema, opts: LoadOptions = {}): LoadedConfig<T> {
  const env = opts.env ?? Environment.Development;
  const issues: ConfigIssue[] = [];
  const values: Record<string, unknown> = {};
  const secretKeys = new Set<string>();

  for (const [key, spec] of Object.entries(schema)) {
    const source = spec.secret ? (opts.secrets?.[key] ?? raw[key]) : raw[key];
    if (spec.secret) secretKeys.add(key);

    if (source === undefined || source === '') {
      if (spec.default !== undefined) {
        values[key] = spec.default;
      } else if (spec.required) {
        issues.push({ key, message: spec.secret ? 'required secret is missing' : 'required value is missing' });
      }
      continue;
    }
    const { value, error } = coerce(spec, source);
    if (error) issues.push({ key, message: error });
    else values[key] = value;
  }

  if (issues.length > 0) throw new ConfigValidationError(issues);

  return {
    env,
    values: values as T,
    get: (key) => values[key as string] as never,
    masked: () => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) out[k] = secretKeys.has(k) ? '***' : v;
      return out;
    },
  };
}

/* ------------------------------ feature flags ----------------------------- */

export interface FlagScope {
  env?: Environment;
  tenantId?: string;
}

/**
 * Feature flags with a base default plus env- and tenant-scoped overrides. Most
 * specific scope wins: tenant+env > tenant > env > base.
 */
export class FeatureFlags {
  private readonly base: Record<string, boolean>;
  private readonly overrides = new Map<string, boolean>();

  constructor(base: Record<string, boolean> = {}) {
    this.base = { ...base };
  }

  private key(flag: string, scope: FlagScope): string {
    return `${flag}::${scope.tenantId ?? '*'}::${scope.env ?? '*'}`;
  }

  setOverride(flag: string, enabled: boolean, scope: FlagScope = {}): this {
    this.overrides.set(this.key(flag, scope), enabled);
    return this;
  }

  isEnabled(flag: string, scope: FlagScope = {}): boolean {
    const candidates = [
      this.key(flag, { tenantId: scope.tenantId, env: scope.env }),
      this.key(flag, { tenantId: scope.tenantId }),
      this.key(flag, { env: scope.env }),
    ];
    for (const c of candidates) {
      const v = this.overrides.get(c);
      if (v !== undefined) return v;
    }
    return this.base[flag] ?? false;
  }

  all(scope: FlagScope = {}): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const flag of Object.keys(this.base)) out[flag] = this.isEnabled(flag, scope);
    return out;
  }
}

/* ------------------------------ tenant config ----------------------------- */

export interface TenantConfig {
  tenantId: string;
  values: Record<string, unknown>;
}

/** Per-tenant configuration with fallback to a shared default. */
export class TenantConfigRegistry {
  private readonly tenants = new Map<string, Record<string, unknown>>();
  constructor(private readonly defaults: Record<string, unknown> = {}) {}

  set(tenantId: string, values: Record<string, unknown>): void {
    this.tenants.set(tenantId, { ...this.tenants.get(tenantId), ...values });
  }
  resolve(tenantId: string): TenantConfig {
    return { tenantId, values: { ...this.defaults, ...this.tenants.get(tenantId) } };
  }
  get<T = unknown>(tenantId: string, key: string): T {
    return (this.tenants.get(tenantId)?.[key] ?? this.defaults[key]) as T;
  }
}

/** Baseline profile defaults per environment (safe, overridable). */
export function profileDefaults(env: Environment): Record<string, string> {
  const common = { LOG_LEVEL: 'info', METRICS_ENABLED: 'true' };
  switch (env) {
    case Environment.Production:
      return { ...common, LOG_LEVEL: 'warn', NODE_ENV: 'production' };
    case Environment.Staging:
      return { ...common, NODE_ENV: 'production' };
    case Environment.Test:
      return { ...common, LOG_LEVEL: 'error', NODE_ENV: 'test' };
    default:
      return { ...common, LOG_LEVEL: 'debug', NODE_ENV: 'development' };
  }
}
