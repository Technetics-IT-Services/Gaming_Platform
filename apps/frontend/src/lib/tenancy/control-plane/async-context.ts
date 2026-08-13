/**
 * Async Tenant Context (Phase 3.2, STEP 10).
 *
 * Upgrades the Phase 3.1 ambient `TenantScope` (a save/restore stack) to Node
 * `AsyncLocalStorage`, so the tenant context propagates correctly across Promise chains,
 * timers, background jobs and detached async operations — Tenant A's context can NEVER
 * leak into Tenant B, even under concurrent interleaved requests. The Phase 3.1
 * conceptual API (`run` / `current` / `require` / `capture`) is preserved. Falls back to a
 * stack where `AsyncLocalStorage` is unavailable (browser), keeping the module isomorphic.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import type { TenantContext } from '../types';

interface Store {
  run<T>(ctx: TenantContext, fn: () => T): T;
  current(): TenantContext | null;
}

/**
 * Backed by `AsyncLocalStorage` (this control-plane layer is server-only — it already uses
 * `node:crypto`). A stack fallback is retained only for the theoretical case where the
 * async-hooks store is unavailable, keeping the conceptual API stable.
 */
function createStore(): Store {
  if (typeof AsyncLocalStorage === 'function') {
    const als = new AsyncLocalStorage<TenantContext>();
    return {
      run: (ctx, fn) => als.run(ctx, fn),
      current: () => als.getStore() ?? null,
    };
  }
  const stack: TenantContext[] = [];
  return {
    run: (ctx, fn) => {
      stack.push(ctx);
      try {
        return fn();
      } finally {
        stack.pop();
      }
    },
    current: () => stack[stack.length - 1] ?? null,
  };
}

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantContextError';
  }
}

const STORE = createStore();

/** The async-propagating tenant context. */
export const TenantAsyncContext = {
  /** Bind `ctx` for the duration of `fn` and everything it awaits. */
  run<T>(ctx: TenantContext, fn: () => T | Promise<T>): T | Promise<T> {
    return STORE.run(ctx, fn as () => T);
  },
  /** The active context, or null. */
  current(): TenantContext | null {
    return STORE.current();
  },
  /** The active context, or throw. */
  require(): TenantContext {
    const ctx = STORE.current();
    if (!ctx) throw new TenantContextError('no active tenant context — resolve a tenant before business logic runs');
    return ctx;
  },
  /**
   * Capture the current context and return a function that re-enters it — for detached
   * async work (timers, queues, fire-and-forget) that would otherwise lose the context.
   */
  capture<T>(fn: () => T | Promise<T>): () => T | Promise<T> {
    const ctx = TenantAsyncContext.require();
    return () => STORE.run(ctx, fn as () => T);
  },
} as const;
