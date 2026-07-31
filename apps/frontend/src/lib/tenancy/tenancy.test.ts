import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigurationPlatform } from './configuration';
import { BrandPlatform } from './brand';
import { buildTenantContext, TenantScope } from './context';
import { FeatureFlagService } from './feature-flags';
import { namespaceKey, ResourceNamespace, TenantScopedKV } from './isolation';
import { canTransition, TenantLifecycleError, TenantLifecycleManager } from './lifecycle';
import { TenantMiddleware } from './middleware';
import { TenantObservability } from './observability';
import { assertOwned, TenantOwnershipError, TenantRepository } from './ownership';
import { MultiTenantPlatform } from './platform';
import { QuotaExceededError, QuotaService } from './quotas';
import { TenantRegistry } from './registry';
import { TenantResolutionError, TenantResolver } from './resolver';
import { ThemePlatform } from './theme';
import { TenantPlan, TenantResolutionSource, TenantStatus, ThemeMode } from './types';

/**
 * Enterprise Multi-Tenant Foundation (Phase 3.1). Verifies the tenant domain model,
 * registry, resolution (all sources), context propagation, hierarchical configuration,
 * feature flags, brand + theme, resource isolation, data ownership, quotas, lifecycle,
 * observability, concurrency, security and end-to-end platform wiring — all ADDITIVE and
 * with zero coupling to any frozen module (nothing here imports Runtime/Wallet/Ledger).
 */

let CLK = 1_700_000_000_000;
const clock = () => (CLK += 1_000);

function newRegistry() {
  const reg = new TenantRegistry(clock);
  return reg;
}
function activeTenant(reg: TenantRegistry, over: Partial<Parameters<TenantRegistry['create']>[0]> = {}) {
  const t = reg.create({ code: over.code ?? 'acme', name: over.name ?? 'Acme Casino', operatorId: over.operatorId ?? 'op-1', plan: over.plan ?? TenantPlan.Growth, domains: over.domains, apiKeys: over.apiKeys, ...over });
  reg.setStatus(t.id, TenantStatus.Active);
  return reg.get(t.id)!;
}

/* -------------------------------- registry ---------------------------------- */

describe('tenant registry', () => {
  it('creates, updates, searches and enforces unique code/domain/api key', () => {
    const reg = newRegistry();
    const t = reg.create({ code: 'ACME', name: 'Acme', operatorId: 'op-1', plan: TenantPlan.Enterprise, domains: ['acme.io'], apiKeys: ['key-1'] });
    expect(t.status).toBe(TenantStatus.Provisioned);
    expect(t.code).toBe('acme'); // normalised
    expect(reg.getByDomain('acme.io')!.id).toBe(t.id);
    expect(reg.getByApiKey('key-1')!.id).toBe(t.id);

    expect(() => reg.create({ code: 'acme', name: 'Dup', operatorId: 'op-2' })).toThrow(/already exists/);
    expect(() => reg.create({ code: 'x', name: 'x', operatorId: 'o', domains: ['acme.io'] })).toThrow(/already mapped/);

    reg.update(t.id, { name: 'Acme Renamed', plan: TenantPlan.Growth });
    expect(reg.get(t.id)!.name).toBe('Acme Renamed');
    expect(reg.get(t.id)!.plan).toBe(TenantPlan.Growth);
    expect(reg.get(t.id)!.limits.concurrentPlayers).toBe(5_000); // re-baselined to Growth

    reg.create({ code: 'beta', name: 'Beta', operatorId: 'op-1', plan: TenantPlan.Starter });
    expect(reg.search({ operatorId: 'op-1' })).toHaveLength(2);
    expect(reg.search({ plan: TenantPlan.Starter })).toHaveLength(1);
    expect(reg.search({ text: 'renam' })).toHaveLength(1);
  });

  it('reports health per tenant', () => {
    const reg = newRegistry();
    const t = reg.create({ code: 'acme', name: 'Acme', operatorId: 'op' });
    expect(reg.health(t.id).healthy).toBe(false); // provisioned, not active
    reg.setStatus(t.id, TenantStatus.Active);
    expect(reg.health(t.id).healthy).toBe(true);
    reg.setStatus(t.id, TenantStatus.Suspended);
    expect(reg.health(t.id).reasons).toContain('tenant is suspended');
  });
});

/* -------------------------------- resolution -------------------------------- */

describe('tenant resolution', () => {
  let reg: TenantRegistry;
  let resolver: TenantResolver;
  beforeEach(() => {
    reg = newRegistry();
    resolver = new TenantResolver(reg, { rootDomains: ['casino.app'], requireActive: true });
    activeTenant(reg, { code: 'acme', domains: ['acme.com'], apiKeys: ['sk-acme'] });
  });

  it('resolves by hostname, subdomain, jwt, api key, header and internal context', () => {
    expect(resolver.resolve({ hostname: 'acme.com' }).source).toBe(TenantResolutionSource.Hostname);
    expect(resolver.resolve({ hostname: 'acme.casino.app' }).source).toBe(TenantResolutionSource.Subdomain);
    expect(resolver.resolve({ subdomain: 'acme' }).source).toBe(TenantResolutionSource.Subdomain);
    expect(resolver.resolve({ jwtClaims: { tid: 'acme' } }).source).toBe(TenantResolutionSource.JwtClaim);
    expect(resolver.resolve({ apiKey: 'sk-acme' }).source).toBe(TenantResolutionSource.ApiKey);
    expect(resolver.resolve({ headers: { 'x-tenant-id': 'acme' } }).source).toBe(TenantResolutionSource.Header);
    const t = reg.getByCode('acme')!;
    expect(resolver.resolve({ internalTenantId: t.id }).source).toBe(TenantResolutionSource.InternalContext);
  });

  it('background jobs & CLI can target any tenant regardless of active gating', () => {
    const reg2 = newRegistry();
    const r2 = new TenantResolver(reg2, { requireActive: true });
    const t = reg2.create({ code: 'susp', name: 'S', operatorId: 'op' });
    reg2.setStatus(t.id, TenantStatus.Suspended);
    // header resolution requires active → throws
    expect(() => r2.resolve({ headers: { 'x-tenant-id': 'susp' } })).toThrow(/is suspended/);
    // internal/background bypasses the active gate
    expect(r2.resolve({ internalTenantId: t.id, source: TenantResolutionSource.BackgroundJob }).tenant.id).toBe(t.id);
  });

  it('rejects unknown and inactive tenants', () => {
    expect(() => resolver.resolve({ apiKey: 'nope' })).toThrow(TenantResolutionError);
    expect(() => resolver.resolve({})).toThrow(/could not resolve/);
    const t = reg.create({ code: 'pending', name: 'P', operatorId: 'op' }); // provisioned
    expect(() => resolver.resolve({ headers: { 'x-tenant-id': 'pending' } })).toThrow(/provisioned/);
    expect(t.status).toBe(TenantStatus.Provisioned);
  });
});

/* ---------------------------------- context --------------------------------- */

describe('tenant context', () => {
  it('projects an immutable context and propagates via the ambient scope', async () => {
    const reg = newRegistry();
    const t = activeTenant(reg, { code: 'ctx', plan: TenantPlan.Enterprise });
    const ctx = buildTenantContext(t, { resolvedVia: TenantResolutionSource.Header, permissions: ['admin'], requestId: 'req-1' });
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(ctx.tenantId).toBe(t.id);
    expect(() => { (ctx as { tenantId: string }).tenantId = 'x'; }).toThrow();

    expect(TenantScope.current()).toBeNull();
    await TenantScope.run(ctx, async () => {
      expect(TenantScope.require().tenantId).toBe(t.id);
      await TenantScope.run(buildTenantContext(activeTenant(reg, { code: 'inner' }), { resolvedVia: TenantResolutionSource.Cli }), () => {
        expect(TenantScope.require().tenantCode).toBe('inner'); // nested override
      });
      expect(TenantScope.require().tenantCode).toBe('ctx'); // restored
    });
    expect(TenantScope.current()).toBeNull(); // cleaned up
  });
});

/* ------------------------------- configuration ------------------------------ */

describe('configuration platform', () => {
  it('resolves Global → Region → Tenant → Environment → Request in order', () => {
    const cfg = new ConfigurationPlatform();
    cfg.setGlobal({ depositLimits: { min: 5, max: 1_000 }, currencies: ['USD'] });
    cfg.setRegion('eu-west', { currencies: ['EUR'], depositLimits: { max: 2_000 } });
    cfg.setTenant('tnt-1', { depositLimits: { max: 5_000 } });
    cfg.setEnvironment('staging', { responsibleGaming: { depositLimitEnabled: false } as never });

    const resolved = cfg.resolve({ region: 'eu-west', tenantId: 'tnt-1', environment: 'staging', requestOverride: { depositLimits: { min: 50 } } });
    expect(resolved.currencies).toEqual(['EUR']); // region overrode global
    expect(resolved.depositLimits.max).toBe(5_000); // tenant overrode region
    expect(resolved.depositLimits.min).toBe(50); // request override wins
    expect(resolved.responsibleGaming.depositLimitEnabled).toBe(false); // environment layer
  });
});

/* ------------------------------- feature flags ------------------------------ */

describe('feature flag platform', () => {
  it('applies precedence: kill switch > tenant > operator > percentage > plan > global', () => {
    const flags = new FeatureFlagService();
    flags.define('poker.enabled', { default: false, plans: { [TenantPlan.Enterprise]: true }, operatorAllowList: ['op-vip'] });

    // plan flag
    expect(flags.isEnabled('poker.enabled', { tenantId: 't1', plan: TenantPlan.Enterprise })).toBe(true);
    expect(flags.isEnabled('poker.enabled', { tenantId: 't1', plan: TenantPlan.Starter })).toBe(false);
    // operator allow-list
    expect(flags.isEnabled('poker.enabled', { tenantId: 't1', plan: TenantPlan.Starter, operatorId: 'op-vip' })).toBe(true);
    // tenant override beats everything except kill switch
    expect(flags.isEnabled('poker.enabled', { tenantId: 't1', plan: TenantPlan.Enterprise, tenantOverride: false })).toBe(false);
    // kill switch overrides all
    flags.setKillSwitch('poker.enabled', true);
    expect(flags.isEnabled('poker.enabled', { tenantId: 't1', plan: TenantPlan.Enterprise, tenantOverride: true })).toBe(false);
  });

  it('percentage rollout is deterministic and bounded', () => {
    const flags = new FeatureFlagService();
    flags.define('ai.enabled', { default: false, rolloutPercentage: 50 });
    const on = Array.from({ length: 200 }, (_, i) => flags.isEnabled('ai.enabled', { tenantId: `t${i}` })).filter(Boolean).length;
    expect(on).toBeGreaterThan(60);
    expect(on).toBeLessThan(140); // ~50% with stable hashing
    // stable across calls
    expect(flags.isEnabled('ai.enabled', { tenantId: 't5' })).toBe(flags.isEnabled('ai.enabled', { tenantId: 't5' }));
  });
});

/* --------------------------------- brand ------------------------------------ */

describe('brand platform', () => {
  it('layers platform ← operator ← tenant brand and renders templates', () => {
    const brand = new BrandPlatform();
    brand.setOperatorBrand('op-1', { primaryColor: '#111', support: { email: 'op@x.com' } });
    brand.setTenantBrand('tnt-1', { casinoName: 'Lucky Acme', emailTemplates: { welcome: 'Hi {{name}}, welcome to {{brand}}!' } });
    const resolved = brand.resolve({ tenantId: 'tnt-1', operatorId: 'op-1' });
    expect(resolved.casinoName).toBe('Lucky Acme');
    expect(resolved.primaryColor).toBe('#111'); // operator layer
    expect(resolved.support?.email).toBe('op@x.com');
    expect(brand.renderTemplate(resolved, 'email', 'welcome', { name: 'Sam', brand: 'Lucky Acme' })).toBe('Hi Sam, welcome to Lucky Acme!');
  });
});

/* --------------------------------- theme ------------------------------------ */

describe('theme platform', () => {
  it('resolves named/base themes, layers tokens and emits CSS variables', () => {
    const theme = new ThemePlatform();
    theme.setTenantTheme('tnt-1', { baseThemeId: 'dark', tokens: { '--color-primary': '#ff0066' } });
    const resolved = theme.resolve({ tenantId: 'tnt-1' });
    expect(resolved.mode).toBe(ThemeMode.Dark);
    expect(resolved.tokens['--color-primary']).toBe('#ff0066'); // overridden
    expect(resolved.tokens['--color-bg']).toBe('#0b0f19'); // inherited from dark base
    expect(theme.toCssVariables(resolved)).toContain('--color-primary: #ff0066;');
  });
});

/* ------------------------------- isolation ---------------------------------- */

describe('resource isolation', () => {
  it('namespaces resources and confines a scoped store to one tenant', () => {
    expect(namespaceKey('t1', 'cache', 'k')).toBe('t:t1:cache:k');
    const ns = new ResourceNamespace('t1');
    expect(ns.queueName('emails')).toBe('t:t1:queue:emails');

    const kv = new TenantScopedKV<number>();
    kv.set('t1', 'balance', 100);
    kv.set('t2', 'balance', 999);
    expect(kv.get('t1', 'balance')).toBe(100);
    expect(kv.get('t2', 'balance')).toBe(999);
    expect(kv.keys('t1')).toEqual(['balance']);
    expect(kv.scope('t2').get('balance')).toBe(999);
    kv.clear('t1');
    expect(kv.get('t1', 'balance')).toBeUndefined();
    expect(kv.get('t2', 'balance')).toBe(999); // untouched — no shared mutable state
  });
});

/* ------------------------------ data ownership ------------------------------ */

describe('data ownership', () => {
  it('every row carries a tenantId and cross-tenant access is impossible', () => {
    const repo = new TenantRepository<{ id: string; amount: number }>('wallet');
    repo.put('t1', { id: 'w1', amount: 50 });
    repo.put('t2', { id: 'w2', amount: 70 });
    expect(repo.get('t1', 'w1')!.tenantId).toBe('t1');
    expect(repo.get('t2', 'w1')).toBeNull(); // t2 cannot read t1's row
    expect(repo.owns('t1', 'w1')).toBe(true);
    expect(repo.list('t1')).toHaveLength(1);
    expect(repo.delete('t2', 'w1')).toBe(false); // cannot delete another tenant's row
    expect(() => repo.put('t2', { id: 'w1', amount: 1 })).toThrow(TenantOwnershipError); // cannot hijack id
    expect(() => assertOwned(repo.get('t1', 'w1')!, 't2')).toThrow(/belongs to tenant/);
    expect(repo.purgeTenant('t1')).toBe(1);
  });

  it('rejects data without tenant ownership', () => {
    const repo = new TenantRepository<{ id: string }>('player');
    expect(() => repo.put('', { id: 'p1' })).toThrow(/no data may exist without tenant ownership/);
  });
});

/* --------------------------------- quotas ----------------------------------- */

describe('resource quotas', () => {
  it('enforces gauge limits with acquire/release', () => {
    const q = new QuotaService(clock);
    const limits = { concurrentSessions: 2 } as never;
    q.acquire('t1', 'concurrentSessions', limits);
    q.acquire('t1', 'concurrentSessions', limits);
    expect(q.usage('t1', 'concurrentSessions')).toBe(2);
    expect(() => q.acquire('t1', 'concurrentSessions', limits)).toThrow(QuotaExceededError);
    q.release('t1', 'concurrentSessions');
    expect(q.check('t1', 'concurrentSessions', limits).allowed).toBe(true);
    // isolated per tenant
    expect(q.usage('t2', 'concurrentSessions')).toBe(0);
  });

  it('enforces rolling-rate limits', () => {
    const q = new QuotaService(clock);
    const limits = { apiRequestsPerMinute: 3 } as never;
    for (let i = 0; i < 3; i += 1) q.acquire('t1', 'apiRequestsPerMinute', limits);
    expect(() => q.acquire('t1', 'apiRequestsPerMinute', limits)).toThrow(QuotaExceededError);
  });
});

/* -------------------------------- lifecycle --------------------------------- */

describe('tenant lifecycle', () => {
  it('drives the state machine with validated transitions + hooks', () => {
    const reg = newRegistry();
    const events: string[] = [];
    const mgr = new TenantLifecycleManager(reg, {
      onProvision: () => events.push('provision'), onActivate: () => events.push('activate'),
      onSuspend: () => events.push('suspend'), onArchive: () => events.push('archive'),
      onRestore: () => events.push('restore'), onDelete: () => events.push('delete'),
    });
    const t = mgr.provision({ code: 'life', name: 'Life', operatorId: 'op' });
    expect(t.status).toBe(TenantStatus.Provisioned);
    mgr.activate(t.id);
    mgr.suspend(t.id);
    mgr.restore(t.id);
    mgr.archive(t.id);
    mgr.restore(t.id);
    mgr.delete(t.id);
    expect(reg.get(t.id)!.status).toBe(TenantStatus.Deleted);
    expect(events).toEqual(['provision', 'activate', 'suspend', 'restore', 'archive', 'restore', 'delete']);
  });

  it('rejects illegal transitions and purges only deleted tenants', () => {
    const reg = newRegistry();
    const mgr = new TenantLifecycleManager(reg);
    const t = mgr.provision({ code: 'x', name: 'X', operatorId: 'op' });
    expect(canTransition(TenantStatus.Provisioned, TenantStatus.Suspended)).toBe(false);
    expect(() => mgr.suspend(t.id)).toThrow(TenantLifecycleError); // provisioned → suspended illegal
    mgr.activate(t.id);
    mgr.delete(t.id);
    expect(() => mgr.restore(t.id)).toThrow(); // deleted is terminal
    mgr.purge(t.id);
    expect(reg.get(t.id)).toBeNull();
  });
});

/* ------------------------------- observability ------------------------------ */

describe('observability', () => {
  it('stamps tenantId/operatorId/plan/region onto logs, metrics and audit', () => {
    const reg = newRegistry();
    const t = activeTenant(reg, { code: 'obs', plan: TenantPlan.Enterprise, region: 'us-east' });
    const ctx = buildTenantContext(t, { resolvedVia: TenantResolutionSource.Header });
    const sink = { log: vi.fn(), metric: vi.fn(), audit: vi.fn() };
    const obs = new TenantObservability(sink, clock);
    const bound = obs.forContext(ctx);
    bound.log('info', 'hello');
    bound.metric('sessions', 5);
    bound.audit('tenant.viewed', { actor: 'admin' });
    expect(sink.log).toHaveBeenCalledWith(expect.objectContaining({ dimensions: expect.objectContaining({ tenantId: t.id, plan: 'enterprise', region: 'us-east' }) }));
    expect(obs.metricsFor(t.id)).toHaveLength(1);
    expect(obs.auditsFor(t.id)[0]!.actor).toBe('admin');
  });
});

/* ----------------------- middleware / concurrency / e2e --------------------- */

describe('middleware, concurrency & platform wiring', () => {
  it('injects context around a handler and propagates to detached continuations', async () => {
    const reg = newRegistry();
    activeTenant(reg, { code: 'mw', apiKeys: ['sk-mw'] });
    const resolver = new TenantResolver(reg);
    const mw = new TenantMiddleware((input) => buildTenantContext(resolver.resolve(input).tenant, { resolvedVia: TenantResolutionSource.ApiKey }));

    const seen = await mw.rest({ apiKey: 'sk-mw' }, () => TenantScope.require().tenantCode);
    expect(seen).toBe('mw');
    expect(TenantScope.current()).toBeNull(); // scope closed after dispatch

    // propagate() re-enters the same context in a detached task
    let deferred!: () => Promise<string>;
    await mw.rest({ apiKey: 'sk-mw' }, () => { deferred = mw.propagate(() => TenantScope.require().tenantCode); });
    expect(await deferred()).toBe('mw');
  });

  it('concurrent tenants keep isolated data + quotas via the platform facade', async () => {
    const platform = new MultiTenantPlatform({ clock, environment: 'production' });
    const a = platform.lifecycle.provision({ code: 'a', name: 'A', operatorId: 'op', plan: TenantPlan.Growth, apiKeys: ['sk-a'] });
    const b = platform.lifecycle.provision({ code: 'b', name: 'B', operatorId: 'op', plan: TenantPlan.Enterprise, apiKeys: ['sk-b'] });
    platform.lifecycle.activate(a.id);
    platform.lifecycle.activate(b.id);

    const work = (apiKey: string, value: number) =>
      platform.run({ apiKey }, (ctx) => {
        platform.storage.set(ctx.tenantId, 'v', value);
        return { tenantCode: ctx.tenantCode, plan: ctx.plan, poker: ctx.featureFlags['poker.enabled'] };
      });

    const [ra, rb] = await Promise.all([work('sk-a', 1), work('sk-b', 2)]);
    expect(ra.tenantCode).toBe('a');
    expect(rb.tenantCode).toBe('b');
    expect(ra.poker).toBe(true); // Growth plan → poker enabled by plan default
    expect(rb.plan).toBe(TenantPlan.Enterprise);
    // stored data stays isolated
    expect(platform.storage.get(a.id, 'v')).toBe(1);
    expect(platform.storage.get(b.id, 'v')).toBe(2);

    // resolving a suspended tenant is blocked; internal still works
    platform.lifecycle.suspend(a.id);
    await expect(platform.run({ apiKey: 'sk-a' }, () => 'x')).rejects.toThrow();
  });

  it('the whole context carries resolved flags, config and brand', () => {
    const platform = new MultiTenantPlatform({ clock, environment: 'production' });
    // Environment layer sits BELOW the tenant's own stored config in precedence, so it
    // wins for fields the tenant leaves at default — demonstrating the hierarchy end-to-end.
    platform.config.setEnvironment('production', { paymentProviders: ['stripe'] });
    platform.flags.define('marketplace.enabled', { default: false, plans: { [TenantPlan.Enterprise]: true } });
    platform.brand.setOperatorBrand('op', { support: { email: 'ops@op.com' } });
    const t = platform.lifecycle.provision({ code: 'full', name: 'Full', operatorId: 'op', plan: TenantPlan.Enterprise });
    platform.lifecycle.activate(t.id);

    const ctx = platform.buildContext({ headers: { 'x-tenant-id': 'full' } });
    expect(ctx.featureFlags['marketplace.enabled']).toBe(true);
    expect(ctx.configuration.paymentProviders).toContain('stripe'); // environment layer resolved
    expect(ctx.brand.support?.email).toBe('ops@op.com'); // operator brand layer resolved
    expect(ctx.resolvedVia).toBe(TenantResolutionSource.Header);
  });
});

/* -------------------------------- security ---------------------------------- */

describe('security & isolation guarantees', () => {
  it('a tenant context cannot be mutated and cross-tenant reads are denied', () => {
    const reg = newRegistry();
    const a = activeTenant(reg, { code: 'sec-a' });
    const b = activeTenant(reg, { code: 'sec-b' });
    const repo = new TenantRepository<{ id: string; secret: string }>('crm');
    repo.put(a.id, { id: 'rec', secret: 'a-only' });
    // b resolves its own context and must not see a's data
    expect(repo.get(b.id, 'rec')).toBeNull();
    expect(repo.list(b.id)).toHaveLength(0);
  });
});
