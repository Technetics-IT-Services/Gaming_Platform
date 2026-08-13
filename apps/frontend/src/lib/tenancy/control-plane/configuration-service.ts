/**
 * Persistent Configuration Service (Phase 3.2, STEP 5).
 *
 * Immutable, versioned tenant configuration: create versions, activate, roll back, diff,
 * validate, and compute the effective configuration through the Phase 3.1 hierarchy
 * (Global → Region → Tenant → Environment → Request). History is NEVER destroyed; a
 * rollback simply re-points the active version. Version-aware caching keeps reads O(1).
 * Additive; owns no money and touches no frozen module.
 */
import { ConfigurationPlatform, type PartialConfig } from '../configuration';
import type { TenantConfiguration } from '../types';
import type { ConfigVersionRow } from '../persistence/records';
import type { ConfigurationRepository } from '../persistence/repositories';
import { validation } from '../persistence/errors';
import { ControlPlaneCache } from './cache';

export interface ConfigDiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}

export interface EffectiveConfigInput {
  region?: string;
  environment?: string;
  requestOverride?: PartialConfig;
  currency?: string;
  locale?: string;
}

export class ConfigurationService {
  constructor(
    private readonly repo: ConfigurationRepository,
    private readonly hierarchy: ConfigurationPlatform = new ConfigurationPlatform(),
    private readonly cache: ControlPlaneCache = new ControlPlaneCache(),
  ) {}

  /** Validate a configuration payload before it can be versioned. */
  validate(config: TenantConfiguration): void {
    if (config.depositLimits.min > config.depositLimits.max) throw validation('deposit min exceeds max');
    if (config.withdrawalLimits.min > config.withdrawalLimits.max) throw validation('withdrawal min exceeds max');
    if (config.currencies.length === 0) throw validation('at least one currency is required');
  }

  /** Create a new immutable version. If it is the first version, it becomes active. */
  createVersion(tenantId: string, config: TenantConfiguration, opts: { reason?: string; actor?: string } = {}): ConfigVersionRow {
    this.validate(config);
    const row = this.repo.createVersion({ tenantId, config, reason: opts.reason, actor: opts.actor });
    if (this.repo.getActiveVersion(tenantId) === null) {
      this.repo.setActiveVersion(tenantId, row.version, null, opts.actor);
    }
    this.cache.invalidateKind(tenantId, 'config');
    return row;
  }

  /** Activate an existing version (roll forward). */
  activate(tenantId: string, version: number, actor?: string): void {
    const pointer = this.repo.getPointer(tenantId);
    this.repo.setActiveVersion(tenantId, version, pointer?.version ?? null, actor);
    this.cache.invalidateKind(tenantId, 'config');
  }

  /** Roll back to an earlier version (history is preserved). */
  rollback(tenantId: string, toVersion: number, actor?: string): void {
    if (!this.repo.getVersion(tenantId, toVersion)) throw validation(`no configuration version ${toVersion}`);
    this.activate(tenantId, toVersion, actor);
  }

  getActiveVersion(tenantId: string): number | null {
    return this.repo.getActiveVersion(tenantId);
  }
  getVersion(tenantId: string, version: number): ConfigVersionRow | null {
    return this.repo.getVersion(tenantId, version);
  }
  listVersions(tenantId: string): ConfigVersionRow[] {
    return this.repo.listVersions(tenantId);
  }

  /** The active configuration snapshot. */
  getActive(tenantId: string): TenantConfiguration | null {
    const active = this.repo.getActiveVersion(tenantId);
    if (active === null) return null;
    return this.repo.getVersion(tenantId, active)?.config ?? null;
  }

  /** Effective configuration through the full hierarchy, cached by the active version. */
  effective(tenantId: string, input: EffectiveConfigInput = {}): TenantConfiguration | null {
    const activeVersion = this.repo.getActiveVersion(tenantId);
    if (activeVersion === null) return null;
    // Cache only the pure-tenant resolution (no per-request override) by version.
    const cacheable = !input.requestOverride && !input.environment;
    if (cacheable) {
      const hit = this.cache.get<TenantConfiguration>(tenantId, 'config', activeVersion);
      if (hit) return hit;
    }
    const tenantConfig = this.repo.getVersion(tenantId, activeVersion)!.config;
    const resolved = this.hierarchy.resolve({
      region: input.region,
      tenantId,
      tenantConfig,
      environment: input.environment,
      requestOverride: input.requestOverride,
      currency: input.currency,
      locale: input.locale,
    });
    if (cacheable) this.cache.set(tenantId, 'config', resolved, activeVersion);
    return resolved;
  }

  /** Deep diff two versions' configurations. */
  diff(tenantId: string, versionA: number, versionB: number): ConfigDiffEntry[] {
    const a = this.repo.getVersion(tenantId, versionA)?.config;
    const b = this.repo.getVersion(tenantId, versionB)?.config;
    if (!a || !b) throw validation('cannot diff — missing version');
    const out: ConfigDiffEntry[] = [];
    diffInto('', a, b, out);
    return out;
  }
}

function diffInto(path: string, a: unknown, b: unknown, out: ConfigDiffEntry[]): void {
  if (a === b) return;
  const bothObj = isObj(a) && isObj(b);
  if (!bothObj) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: path || '.', before: a, after: b });
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) diffInto(path ? `${path}.${k}` : k, (a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], out);
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
