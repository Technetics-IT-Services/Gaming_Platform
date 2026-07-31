/**
 * Tenant Context (Phase 3.1, STEP 4).
 *
 * Builds the immutable per-request `TenantContext` from a resolved tenant, and provides
 * an ambient scope (`TenantScope.run` / `current` / `require`) so downstream code can
 * read the active tenant WITHOUT being passed it explicitly and WITHOUT knowing how it
 * was resolved. The scope is a save/restore stack around the (awaited) unit of work; a
 * production deployment swaps the holder for `AsyncLocalStorage` with no API change.
 */
import {
  type Tenant,
  type TenantContext,
  type TenantResolutionSource,
  TenantStatus,
} from './types';

let REQ = 0;
function requestId(): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) crypto.getRandomValues(bytes);
  REQ += 1;
  return `req_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}${REQ.toString(36)}`;
}

/** Project a tenant + request details into an immutable context. */
export function buildTenantContext(
  tenant: Tenant,
  input: {
    resolvedVia: TenantResolutionSource;
    operatorId?: string;
    permissions?: string[];
    requestId?: string;
    featureFlags?: Record<string, boolean>;
    now?: number;
  },
): TenantContext {
  const ctx: TenantContext = {
    tenantId: tenant.id,
    tenantCode: tenant.code,
    operatorId: input.operatorId ?? tenant.operatorId,
    region: tenant.region,
    timezone: tenant.timezone,
    currency: tenant.currency,
    locale: tenant.locale,
    plan: tenant.plan,
    brand: tenant.brand,
    permissions: [...(input.permissions ?? [])],
    featureFlags: { ...(input.featureFlags ?? tenant.features) },
    configuration: tenant.configuration,
    resolvedVia: input.resolvedVia,
    requestId: input.requestId ?? requestId(),
    issuedAt: input.now ?? Date.now(),
  };
  return Object.freeze(ctx);
}

/** True if the tenant may serve traffic (Active only). */
export function isServable(status: TenantStatus): boolean {
  return status === TenantStatus.Active;
}

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantContextError';
  }
}

/**
 * Ambient tenant scope. `run` binds a context for the duration of the (awaited) callback;
 * `current` / `require` read it. Save/restore stack keeps nested `run`s correct.
 */
export class TenantScope {
  private static stack: TenantContext[] = [];

  static current(): TenantContext | null {
    return TenantScope.stack[TenantScope.stack.length - 1] ?? null;
  }

  static require(): TenantContext {
    const ctx = TenantScope.current();
    if (!ctx) throw new TenantContextError('no active tenant context — resolve a tenant before business logic runs');
    return ctx;
  }

  static async run<T>(ctx: TenantContext, fn: () => T | Promise<T>): Promise<T> {
    TenantScope.stack.push(ctx);
    try {
      return await fn();
    } finally {
      TenantScope.stack.pop();
    }
  }

  /** Synchronous variant for non-async units of work. */
  static runSync<T>(ctx: TenantContext, fn: () => T): T {
    TenantScope.stack.push(ctx);
    try {
      return fn();
    } finally {
      TenantScope.stack.pop();
    }
  }

  static get depth(): number {
    return TenantScope.stack.length;
  }
}
