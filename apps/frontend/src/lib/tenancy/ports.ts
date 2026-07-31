/**
 * Downstream ports (Phase 3.1, STEP 5).
 *
 * Thin, LOCAL interfaces describing the shape of the frozen modules the middleware
 * injects context around — Runtime, Wallet, Ledger, CRM, Analytics, notifications,
 * logging, audit. They exist ONLY here (never inside those modules), so the tenancy layer
 * can wrap them additively: a wrapper stamps the active `TenantContext` onto references /
 * idempotency keys / dimensions before delegating, and the frozen module runs unchanged.
 *
 * These are structural, dependency-free descriptions — importing a frozen module is not
 * required, guaranteeing zero coupling and zero modification.
 */
import { namespaceKey } from './isolation';
import type { TenantContext } from './types';

/** Any callable module method the middleware can wrap. */
export type AnyFn = (...args: never[]) => unknown;

/**
 * Wrap a reference string with the tenant namespace so a SHARED downstream store keeps
 * tenant data separated without the store knowing about tenants.
 */
export function tenantReference(ctx: TenantContext, reference: string): string {
  return namespaceKey(ctx.tenantId, 'storage', reference);
}

/** Namespace an idempotency key so retries never collide across tenants. */
export function tenantIdempotencyKey(ctx: TenantContext, key: string): string {
  return `t:${ctx.tenantId}:${key}`;
}

/**
 * A generic, additive decorator: return a facade over `module` whose methods run inside
 * the given tenant context's scope and receive the context as their final argument if the
 * method opts into it. The underlying module is NOT modified — this only wraps calls.
 */
export function contextualize<T extends Record<string, AnyFn>>(module: T, ctx: TenantContext): T & { readonly context: TenantContext } {
  const facade = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(module)) {
    const fn = module[key];
    if (typeof fn === 'function') {
      facade[key] = (...args: never[]) => (fn as AnyFn).apply(module, args);
    }
  }
  facade.context = ctx;
  return facade as T & { readonly context: TenantContext };
}
