import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDemoWallet } from '@/stores/demo-wallet';

import { TenantAsyncContext } from './async-context';
import { TenantControlPlane } from './control-plane';
import { MockDomainVerificationProvider } from './domain-service';
import { rolloutBucket } from './feature-flag-service';
import { InMemorySecretManager } from './secret-namespace-service';
import { ControlPlaneError } from '../persistence/errors';
import { TABLES } from '../persistence/schema';
import type { ApiKeyRow, SecretRefRow } from '../persistence/records';
import { ControlPlaneRole, type ControlPlaneAuth } from './rbac';
import { defaultConfiguration } from '../defaults';
import { TenantPlan, TenantResolutionSource, TenantStatus } from '../types';

/**
 * Phase 3.2 — persistent control plane. Verifies provisioning (success/failure/retry/
 * idempotency), configuration versioning + rollback, feature-flag persistence + precedence,
 * domain verification + takeover protection, secure API keys (hash-only, no plaintext leak),
 * AsyncLocalStorage tenant context, RBAC + tenant isolation, secrets, recovery/restart, and
 * ZERO financial impact. Nothing here moves money or imports a frozen financial module.
 */

let CLK = 1_700_000_000_000;
const clock = () => (CLK += 1_000);
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const SUPER: ControlPlaneAuth = { actorId: 'root', actorType: 'platform', roles: [ControlPlaneRole.PlatformSuperAdmin], tenantId: '*' };

function makeCP() {
  const domainProvider = new MockDomainVerificationProvider();
  const secretManager = new InMemorySecretManager();
  const cp = new TenantControlPlane({ clock, domainProvider, secretManager, environment: 'production' });
  return { cp, domainProvider, secretManager };
}

let seq = 0;
function provision(cp: TenantControlPlane, over: Partial<{ code: string; plan: TenantPlan; operatorId: string }> = {}) {
  seq += 1;
  const code = over.code ?? `t${seq}`;
  return cp.provisionTenant(SUPER, { code, name: code.toUpperCase(), operatorId: over.operatorId ?? 'op-1', plan: over.plan ?? TenantPlan.Growth, idempotencyKey: `prov-${code}` });
}

beforeEach(() => {
  useDemoWallet.getState().reset();
  useDemoWallet.getState().deposit(1_000_000);
});

/* ------------------------------- provisioning ------------------------------- */

describe('provisioning workflow', () => {
  it('provisions to Active, is idempotent, and moves ZERO money', () => {
    const { cp } = makeCP();
    const before = useDemoWallet.getState().balance;
    const r = provision(cp, { code: 'acme' });
    expect(r.tenant.status).toBe(TenantStatus.Active);
    expect(r.reused).toBe(false);
    expect(cp.provisioning.getStatus('prov-acme')!.state).toBe('activated');

    // Idempotent replay → same tenant, not re-created.
    const again = cp.provisionTenant(SUPER, { code: 'acme', name: 'X', operatorId: 'op-1', idempotencyKey: 'prov-acme' });
    expect(again.reused).toBe(true);
    expect(again.tenant.id).toBe(r.tenant.id);

    // Financial safety: wallet untouched by the whole control-plane flow.
    expect(useDemoWallet.getState().balance).toBe(before);
  });

  it('records ProvisioningFailed and leaves NO partially-active tenant, then a retry completes', () => {
    const { cp } = makeCP();
    const spy = vi.spyOn(cp.config, 'createVersion').mockImplementationOnce(() => { throw new Error('config store down'); });

    expect(() => cp.provisionTenant(SUPER, { code: 'flaky', name: 'Flaky', operatorId: 'op', idempotencyKey: 'prov-flaky' })).toThrow(ControlPlaneError);
    const failed = cp.provisioning.getStatus('prov-flaky')!;
    expect(failed.state).toBe('failed');
    // The tenant record exists but is NOT active (no partially-active tenant).
    const row = cp.registry.getRow(failed.tenantId)!;
    expect(row.status).toBe(TenantStatus.Provisioned);

    // Retry (same idempotency key) resumes and completes.
    spy.mockRestore();
    const retry = cp.provisionTenant(SUPER, { code: 'flaky', name: 'Flaky', operatorId: 'op', idempotencyKey: 'prov-flaky' });
    expect(retry.tenant.status).toBe(TenantStatus.Active);
    expect(cp.provisioning.getStatus('prov-flaky')!.state).toBe('activated');
  });
});

/* ------------------------------- configuration ------------------------------ */

describe('configuration persistence', () => {
  it('versions immutably, rolls back without destroying history, and diffs', () => {
    const { cp } = makeCP();
    const t = provision(cp, { code: 'cfg' }).tenant;
    expect(cp.config.getActiveVersion(t.id)).toBe(1); // seeded by provisioning

    const v2 = cp.createConfigVersion(SUPER, t.id, { ...defaultConfiguration(), currencies: ['EUR'] }, 'go eur');
    cp.config.activate(t.id, v2.version, SUPER.actorId);
    expect(cp.effectiveConfig(SUPER, t.id)!.currencies).toEqual(['EUR']);

    cp.rollbackConfig(SUPER, t.id, 1);
    expect(cp.effectiveConfig(SUPER, t.id)!.currencies).toEqual(['USD']);
    expect(cp.config.listVersions(t.id)).toHaveLength(2); // history intact

    const diff = cp.config.diff(t.id, 1, 2);
    expect(diff.some((d) => d.path.includes('currencies'))).toBe(true);
  });

  it('validates configuration before versioning', () => {
    const { cp } = makeCP();
    const t = provision(cp, { code: 'val' }).tenant;
    const bad = { ...defaultConfiguration(), depositLimits: { min: 100, max: 1 } };
    expect(() => cp.createConfigVersion(SUPER, t.id, bad)).toThrow(/min exceeds max/);
  });
});

/* ------------------------------- feature flags ------------------------------ */

describe('feature flag persistence & precedence', () => {
  it('applies kill-switch > tenant > operator > rollout > plan > global and persists', () => {
    const { cp } = makeCP();
    const t = provision(cp, { code: 'flags', plan: TenantPlan.Starter, operatorId: 'op-vip' }).tenant;
    cp.setGlobalFlag(SUPER, 'poker.enabled', { default: false, plans: { [TenantPlan.Enterprise]: true }, operatorAllowList: ['op-vip'] });

    expect(cp.flags.isEnabled('poker.enabled', { tenantId: t.id, plan: TenantPlan.Starter, operatorId: 'op-vip' })).toBe(true); // operator allow-list
    cp.setTenantFlag(SUPER, t.id, 'poker.enabled', false); // tenant override beats operator
    expect(cp.flags.isEnabled('poker.enabled', { tenantId: t.id, plan: TenantPlan.Starter, operatorId: 'op-vip' })).toBe(false);
    cp.flags.setKillSwitch('poker.enabled', true, SUPER.actorId); // kill switch beats all
    expect(cp.flags.isEnabled('poker.enabled', { tenantId: t.id, plan: TenantPlan.Enterprise, operatorId: 'op-vip' })).toBe(false);
  });

  it('percentage rollout is deterministic (stable hash), never random', () => {
    expect(rolloutBucket('ai.enabled', 't-5')).toBe(rolloutBucket('ai.enabled', 't-5'));
    const { cp } = makeCP();
    cp.setGlobalFlag(SUPER, 'ai.enabled', { default: false, rolloutPercentage: 50 });
    const on = Array.from({ length: 200 }, (_, i) => cp.flags.isEnabled('ai.enabled', { tenantId: `t${i}` })).filter(Boolean).length;
    expect(on).toBeGreaterThan(60);
    expect(on).toBeLessThan(140);
  });
});

/* --------------------------- domains & verification ------------------------- */

describe('domain management & verification', () => {
  it('cannot activate a domain without a genuine verification result', async () => {
    const { cp, domainProvider } = makeCP();
    const t = provision(cp, { code: 'dom' }).tenant;
    const d = cp.addDomain(SUPER, t.id, 'Play.Acme.com', 'custom');
    expect(d.status).toBe('pending-verification');
    // Verification fails until the challenge is actually published.
    await expect(cp.verifyDomain(SUPER, t.id, d.id)).rejects.toThrow(/verification failed/i);
    domainProvider.satisfy('play.acme.com', d.verificationToken); // operator publishes the DNS/HTTP record
    const verified = await cp.verifyDomain(SUPER, t.id, d.id);
    expect(verified.status).toBe('verified');
    cp.activateDomain(SUPER, t.id, d.id);
    expect(cp.resolve({ hostname: 'play.acme.com' })).toMatchObject({ tenantId: t.id, source: TenantResolutionSource.Hostname });
  });

  it('prevents duplicate/cross-tenant hostname takeover', () => {
    const { cp } = makeCP();
    const a = provision(cp, { code: 'a' }).tenant;
    const b = provision(cp, { code: 'b' }).tenant;
    cp.addDomain(SUPER, a.id, 'shared.example.com');
    expect(() => cp.addDomain(SUPER, b.id, 'shared.example.com')).toThrow(/takeover|already bound/i);
  });
});

/* -------------------------------- api keys ---------------------------------- */

describe('api key security', () => {
  it('stores only a hash + prefix, shows plaintext once, and enforces revoke/expiry/scopes', () => {
    const { cp } = makeCP();
    const t = provision(cp, { code: 'keys' }).tenant;
    const issued = cp.issueApiKey(SUPER, t.id, { name: 'server', scopes: ['read', 'write'] });
    expect(issued.plaintext).toMatch(/^tk_live_/);
    expect(issued.key.scopes).toEqual(['read', 'write']);

    // The DB row contains a hash + prefix but NEVER the plaintext.
    const row = cp.driver.all<ApiKeyRow>(TABLES.apiKeys).find((k) => k.id === issued.key.id)!;
    expect(row.hash).not.toContain(issued.plaintext);
    expect(row.prefix).toBe(issued.key.prefix);
    expect(JSON.stringify(row)).not.toContain(issued.plaintext);
    expect(cp.listApiKeys(SUPER, t.id).some((k) => 'hash' in (k as object))).toBe(false); // view hides the hash

    // Verify resolves the tenant; revoke invalidates.
    expect(cp.apiKeys.verify(issued.plaintext)!.tenantId).toBe(t.id);
    cp.revokeApiKey(SUPER, t.id, issued.key.id);
    expect(cp.apiKeys.verify(issued.plaintext)).toBeNull();

    // Expired key does not verify.
    const exp = cp.issueApiKey(SUPER, t.id, { name: 'temp', expiresAt: clock() - 1 });
    expect(cp.apiKeys.verify(exp.plaintext)).toBeNull();
  });

  it('never writes the plaintext key into the audit trail', () => {
    const { cp } = makeCP();
    const t = provision(cp, { code: 'auditkeys' }).tenant;
    const issued = cp.issueApiKey(SUPER, t.id, { name: 'k' });
    const dump = JSON.stringify(cp.audit.all());
    expect(dump).not.toContain(issued.plaintext);
  });
});

/* ------------------------------ async context ------------------------------- */

describe('async tenant context (AsyncLocalStorage)', () => {
  it('keeps concurrent tenants isolated across promises and timers', async () => {
    const { cp } = makeCP();
    const a = provision(cp, { code: 'ctxa' }).tenant;
    const b = provision(cp, { code: 'ctxb' }).tenant;
    const ctxA = cp.buildContext({ internalTenantId: a.id })!;
    const ctxB = cp.buildContext({ internalTenantId: b.id })!;

    const results = await Promise.all([
      TenantAsyncContext.run(ctxA, async () => { await tick(); await tick(); return TenantAsyncContext.require().tenantId; }),
      TenantAsyncContext.run(ctxB, async () => { await tick(); return TenantAsyncContext.require().tenantId; }),
    ]);
    expect(results).toEqual([a.id, b.id]); // A never leaked into B
    expect(TenantAsyncContext.current()).toBeNull(); // cleaned up
  });

  it('supports nested contexts and capture() for detached work', async () => {
    const { cp } = makeCP();
    const a = provision(cp, { code: 'nesta' }).tenant;
    const b = provision(cp, { code: 'nestb' }).tenant;
    const ctxA = cp.buildContext({ internalTenantId: a.id })!;
    const ctxB = cp.buildContext({ internalTenantId: b.id })!;

    const captured = await TenantAsyncContext.run(ctxA, async () => {
      const inner = await TenantAsyncContext.run(ctxB, () => TenantAsyncContext.require().tenantId);
      expect(inner).toBe(b.id);
      expect(TenantAsyncContext.require().tenantId).toBe(a.id); // restored
      return TenantAsyncContext.capture(() => TenantAsyncContext.require().tenantId);
    });
    // Detached continuation re-enters A's context.
    await new Promise<void>((resolve) => setTimeout(async () => { expect(await captured()).toBe(a.id); resolve(); }, 0));
    expect(() => TenantAsyncContext.require()).toThrow(/no active tenant context/);
  });
});

/* ---------------------------------- RBAC ------------------------------------ */

describe('RBAC & tenant isolation', () => {
  it('denies cross-tenant access, denies missing permissions, and audits denials', () => {
    const { cp } = makeCP();
    const a = provision(cp, { code: 'rbaca' }).tenant;
    const b = provision(cp, { code: 'rbacb' }).tenant;
    const adminA: ControlPlaneAuth = { actorId: 'admin-a', actorType: 'tenant', roles: [ControlPlaneRole.TenantAdmin], tenantId: a.id };

    expect(cp.getTenant(adminA, a.id)!.id).toBe(a.id); // own tenant OK
    expect(() => cp.getTenant(adminA, b.id)).toThrow(/cross-tenant/); // IDOR blocked
    expect(() => cp.provisionTenant(adminA, { code: 'x', name: 'X', operatorId: 'o', idempotencyKey: 'x' })).toThrow(/permission/); // no create
    expect(cp.getTenant(SUPER, b.id)!.id).toBe(b.id); // super admin sees all

    const denials = cp.audit.all().filter((e) => e.result === 'deny');
    expect(denials.length).toBeGreaterThanOrEqual(2);
  });

  it('read-only role cannot mutate', () => {
    const { cp } = makeCP();
    const t = provision(cp, { code: 'ro' }).tenant;
    const ro: ControlPlaneAuth = { actorId: 'viewer', actorType: 'tenant', roles: [ControlPlaneRole.ReadOnly], tenantId: t.id };
    expect(cp.getTenant(ro, t.id)!.id).toBe(t.id);
    expect(() => cp.setTenantFlag(ro, t.id, 'poker.enabled', true)).toThrow(/permission/);
  });
});

/* --------------------------------- secrets ---------------------------------- */

describe('tenant secret namespace', () => {
  it('persists only references (never plaintext) and isolates by tenant', async () => {
    const { cp, secretManager } = makeCP();
    const a = provision(cp, { code: 'seca' }).tenant;
    const b = provision(cp, { code: 'secb' }).tenant;
    await cp.setSecret(SUPER, a.id, 'payments', 'stripe_key', 'sk_live_SUPERSECRET');

    // The persisted secret-ref row holds only an opaque reference — no plaintext.
    const row = cp.driver.all<SecretRefRow>(TABLES.secretRefs).find((r) => r.tenantId === a.id)!;
    expect(row.path).toBe(`tenant/${a.id}/payments/stripe_key`);
    expect(JSON.stringify(row)).not.toContain('sk_live_SUPERSECRET');
    expect(secretManager.has(row.reference)).toBe(true); // the value lives out-of-band

    // Resolution works for the owner; cross-tenant access is denied.
    expect(await cp.secrets.resolveSecret(a.id, 'payments', 'stripe_key')).toBe('sk_live_SUPERSECRET');
    expect(() => cp.secrets.getReference(b.id, 'payments', 'stripe_key')).not.toThrow(); // b's own path is null
    expect(cp.secrets.getReference(b.id, 'payments', 'stripe_key')).toBeNull();
  });
});

/* -------------------------------- recovery ---------------------------------- */

describe('recovery & restart', () => {
  it('rebuilds the control plane from a durable snapshot with caches rebuilt lazily', () => {
    const { cp } = makeCP();
    const t = provision(cp, { code: 'recover', plan: TenantPlan.Enterprise }).tenant;
    cp.setTenantFlag(SUPER, t.id, 'marketplace.enabled', true);
    cp.createConfigVersion(SUPER, t.id, { ...defaultConfiguration(), currencies: ['GBP'] }, 'gbp');
    cp.config.activate(t.id, 2, SUPER.actorId);
    const snapshot = cp.snapshot();

    // "restart": brand-new control plane from the snapshot only.
    const recovered = TenantControlPlane.recover(snapshot, { clock });
    const rt = recovered.getTenant(SUPER, t.id)!;
    expect(rt.status).toBe(TenantStatus.Active);
    expect(rt.plan).toBe(TenantPlan.Enterprise);
    expect(recovered.flags.isEnabled('marketplace.enabled', { tenantId: t.id, plan: TenantPlan.Enterprise })).toBe(true);
    expect(recovered.effectiveConfig(SUPER, t.id)!.currencies).toEqual(['GBP']);
  });

  it('survives cache loss — persistence remains the source of truth', () => {
    const { cp } = makeCP();
    const t = provision(cp, { code: 'cacheloss' }).tenant;
    cp.effectiveConfig(SUPER, t.id); // warm cache
    cp.cache.clear(); // lose the cache
    expect(cp.effectiveConfig(SUPER, t.id)!.currencies.length).toBeGreaterThan(0); // rebuilt from persistence
  });
});

/* ---------------------------- financial safety ------------------------------ */

describe('financial safety — zero money impact', () => {
  it('a full control-plane session leaves wallet/ledger/treasury untouched', async () => {
    const before = useDemoWallet.getState().balance;
    const { cp, domainProvider } = makeCP();
    const t = provision(cp, { code: 'fin' }).tenant;
    cp.createConfigVersion(SUPER, t.id, { ...defaultConfiguration(), currencies: ['JPY'] }, 'jpy');
    cp.setTenantFlag(SUPER, t.id, 'poker.enabled', true);
    const d = cp.addDomain(SUPER, t.id, 'fin.example.com');
    domainProvider.satisfy('fin.example.com', d.verificationToken);
    await cp.verifyDomain(SUPER, t.id, d.id);
    cp.issueApiKey(SUPER, t.id, { name: 'k' });
    await cp.setSecret(SUPER, t.id, 'payments', 'key', 'secret');
    cp.suspendTenant(SUPER, t.id);
    cp.restoreTenant(SUPER, t.id);
    // The wallet balance is unchanged — the control plane never touches money.
    expect(useDemoWallet.getState().balance).toBe(before);
  });
});
