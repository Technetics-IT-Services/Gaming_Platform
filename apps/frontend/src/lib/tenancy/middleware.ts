/**
 * Tenant Middleware (Phase 3.1, STEP 5).
 *
 * Injects a resolved `TenantContext` around every unit of work — REST handlers, GraphQL
 * resolvers, background workers and scheduled jobs — and makes it ambient (`TenantScope`)
 * so downstream code (Runtime, Wallet, Ledger, CRM, Analytics, logging, audit) executes
 * within the context WITHOUT any change inside those modules. Resolution always happens
 * BEFORE the handler runs. Additive; the middleware owns no business logic.
 */
import { TenantScope } from './context';
import {
  type TenantContext,
  type TenantResolutionInput,
  TenantResolutionSource,
} from './types';

/** Builds a `TenantContext` from a resolution input (provided by the platform facade). */
export type ContextFactory = (input: TenantResolutionInput) => TenantContext;

export interface MiddlewareHooks {
  /** Called once the context is resolved, before the handler. */
  onEnter?: (ctx: TenantContext) => void;
  /** Called after the handler settles (success or error). */
  onExit?: (ctx: TenantContext, error?: unknown) => void;
}

export class TenantMiddleware {
  constructor(private readonly contextFactory: ContextFactory, private readonly hooks: MiddlewareHooks = {}) {}

  /** Resolve → bind scope → run the handler with the context. Core of every transport. */
  async dispatch<T>(input: TenantResolutionInput, handler: (ctx: TenantContext) => T | Promise<T>): Promise<T> {
    const ctx = this.contextFactory(input);
    this.hooks.onEnter?.(ctx);
    try {
      const out = await TenantScope.run(ctx, () => handler(ctx));
      this.hooks.onExit?.(ctx);
      return out;
    } catch (error) {
      this.hooks.onExit?.(ctx, error);
      throw error;
    }
  }

  /** REST API entry point (hostname / header / api-key / jwt). */
  rest<T>(input: TenantResolutionInput, handler: (ctx: TenantContext) => T | Promise<T>): Promise<T> {
    return this.dispatch(input, handler);
  }

  /** GraphQL resolver entry point. */
  graphql<T>(input: TenantResolutionInput, handler: (ctx: TenantContext) => T | Promise<T>): Promise<T> {
    return this.dispatch(input, handler);
  }

  /** Background worker: tenant is known internally. */
  worker<T>(tenantId: string, handler: (ctx: TenantContext) => T | Promise<T>, extra?: Partial<TenantResolutionInput>): Promise<T> {
    return this.dispatch({ ...extra, internalTenantId: tenantId, source: TenantResolutionSource.BackgroundJob }, handler);
  }

  /** Scheduled job: tenant is known internally. */
  scheduled<T>(tenantId: string, handler: (ctx: TenantContext) => T | Promise<T>, extra?: Partial<TenantResolutionInput>): Promise<T> {
    return this.dispatch({ ...extra, internalTenantId: tenantId, source: TenantResolutionSource.BackgroundJob }, handler);
  }

  /** CLI / internal call. */
  cli<T>(tenantId: string, handler: (ctx: TenantContext) => T | Promise<T>): Promise<T> {
    return this.dispatch({ internalTenantId: tenantId, source: TenantResolutionSource.Cli }, handler);
  }

  /**
   * Capture the current context so a detached async continuation (e.g. a fire-and-forget
   * notification) re-enters the SAME tenant scope. Guarantees propagation across an await
   * boundary that would otherwise lose the ambient context.
   */
  propagate<T>(handler: (ctx: TenantContext) => T | Promise<T>): () => Promise<T> {
    const ctx = TenantScope.require();
    return () => TenantScope.run(ctx, () => handler(ctx));
  }
}
