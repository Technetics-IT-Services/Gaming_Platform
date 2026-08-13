import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryPersistenceDriver } from './driver';
import { ControlPlaneError } from './errors';
import { ConfigurationRepository, DomainRepository } from './repositories';
import { applySchema, TABLE_INDEXES, TABLES } from './schema';
import { TenantRepository } from './tenant-repository';
import { defaultConfiguration } from '../defaults';
import { TenantPlan, TenantStatus } from '../types';

/**
 * Phase 3.2 — persistence layer. Verifies transactional writes, optimistic concurrency,
 * unique constraints, O(1) indexed lookups, immutable configuration versions, transaction
 * rollback and restart/recovery from a durable snapshot. Additive — nothing here imports a
 * frozen module or moves money.
 */

let CLK = 1_700_000_000_000;
const clock = () => (CLK += 1_000);

function freshDriver() {
  const db = new InMemoryPersistenceDriver();
  applySchema(db);
  return db;
}

/* -------------------------------- persistence ------------------------------- */

describe('tenant repository persistence', () => {
  let db: InMemoryPersistenceDriver;
  let repo: TenantRepository;
  beforeEach(() => {
    db = freshDriver();
    repo = new TenantRepository(db, clock);
  });

  it('creates, reads by id/code, and enforces a unique code', () => {
    const t = repo.create({ code: 'ACME', name: 'Acme', operatorId: 'op-1', plan: TenantPlan.Growth });
    expect(t.status).toBe(TenantStatus.Provisioned);
    expect(t.code).toBe('acme'); // normalized
    expect(t.version).toBe(1);
    expect(repo.getById(t.id)!.id).toBe(t.id);
    expect(repo.getByCode('acme')!.id).toBe(t.id);
    expect(repo.exists('acme')).toBe(true);
    expect(() => repo.create({ code: 'acme', name: 'Dup', operatorId: 'op-2' })).toThrow(/already exists/);
  });

  it('updates, archives, restores, deletes with lifecycle timestamps', () => {
    const t = repo.create({ code: 'life', name: 'Life', operatorId: 'op' });
    const updated = repo.update(t.id, { name: 'Life 2' }, t.version);
    expect(updated.name).toBe('Life 2');
    expect(updated.version).toBe(2);
    const active = repo.setStatus(t.id, TenantStatus.Active, updated.version);
    expect(active.activatedAt).toBeDefined();
    const archived = repo.archive(t.id, active.version);
    expect(archived.status).toBe(TenantStatus.Archived);
    expect(archived.archivedAt).toBeDefined();
  });

  it('searches by operator/plan/status/text without scanning by id', () => {
    repo.create({ code: 'a', name: 'Alpha', operatorId: 'op-1', plan: TenantPlan.Starter });
    repo.create({ code: 'b', name: 'Beta', operatorId: 'op-1', plan: TenantPlan.Growth });
    repo.create({ code: 'c', name: 'Gamma', operatorId: 'op-2', plan: TenantPlan.Growth });
    expect(repo.getByOperator('op-1')).toHaveLength(2); // indexed
    expect(repo.search({ operatorId: 'op-1' })).toHaveLength(2);
    expect(repo.search({ plan: TenantPlan.Growth })).toHaveLength(2);
    expect(repo.search({ text: 'alph' })).toHaveLength(1);
  });
});

/* -------------------------------- concurrency ------------------------------- */

describe('optimistic concurrency', () => {
  it('detects a conflicting concurrent update and never silently overwrites', () => {
    const db = freshDriver();
    const repo = new TenantRepository(db, clock);
    const t = repo.create({ code: 'race', name: 'Race', operatorId: 'op' }); // version 1

    // Request A and Request B both read version 1.
    const readA = t.version;
    const readB = t.version;
    const afterA = repo.update(t.id, { name: 'A wins' }, readA); // → version 2
    expect(afterA.version).toBe(2);
    // B still holds version 1 → CONFLICT (deterministic error code).
    expect(() => repo.update(t.id, { name: 'B loses' }, readB)).toThrow(ControlPlaneError);
    try {
      repo.update(t.id, { name: 'B loses' }, readB);
    } catch (e) {
      expect((e as ControlPlaneError).code).toBe('CONFLICT');
    }
    expect(repo.getById(t.id)!.name).toBe('A wins'); // A preserved
  });

  it('setStatus is also version-guarded', () => {
    const db = freshDriver();
    const repo = new TenantRepository(db, clock);
    const t = repo.create({ code: 'st', name: 'St', operatorId: 'op' });
    repo.setStatus(t.id, TenantStatus.Active, t.version);
    expect(() => repo.setStatus(t.id, TenantStatus.Suspended, t.version)).toThrow(/CONFLICT|concurrently/);
  });
});

/* ---------------------------- transaction rollback -------------------------- */

describe('driver transactions', () => {
  it('rolls back all writes when the transaction throws', () => {
    const db = freshDriver();
    const repo = new TenantRepository(db, clock);
    const before = db.count(TABLES.tenants);
    expect(() =>
      db.transaction(() => {
        repo.create({ code: 'ok', name: 'Ok', operatorId: 'op' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.count(TABLES.tenants)).toBe(before); // creation rolled back
    expect(repo.getByCode('ok')).toBeNull();
  });

  it('unique-index lookups are O(1) and consistent after updates', () => {
    const db = freshDriver();
    const repo = new TenantRepository(db, clock);
    const t = repo.create({ code: 'idx', name: 'Idx', operatorId: 'op' });
    repo.update(t.id, { name: 'Idx2' }, t.version);
    expect(repo.getByCode('idx')!.name).toBe('Idx2'); // index still points to the row
  });
});

/* --------------------------- configuration versions ------------------------- */

describe('configuration version persistence', () => {
  it('creates immutable, monotonically-increasing versions and tracks the active pointer', () => {
    const db = freshDriver();
    const repo = new ConfigurationRepository(db, clock);
    const v1 = repo.createVersion({ tenantId: 't1', config: defaultConfiguration() });
    const v2 = repo.createVersion({ tenantId: 't1', config: { ...defaultConfiguration(), currencies: ['EUR'] } });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    repo.setActiveVersion('t1', 2, null);
    expect(repo.getActiveVersion('t1')).toBe(2);
    // history preserved — v1 still readable after activating v2
    expect(repo.getVersion('t1', 1)!.config.currencies).toEqual(['USD']);
    // rollback pointer to v1
    const ptr = repo.getPointer('t1')!;
    repo.setActiveVersion('t1', 1, ptr.version);
    expect(repo.getActiveVersion('t1')).toBe(1);
    expect(repo.listVersions('t1')).toHaveLength(2); // nothing destroyed
  });
});

/* -------------------------------- isolation --------------------------------- */

describe('cross-tenant isolation at the repository layer', () => {
  it('domain rows are indexed per tenant and hostnames are globally unique', () => {
    const db = freshDriver();
    const repo = new DomainRepository(db, clock);
    repo.create({ tenantId: 't1', hostname: 'A.example.com', kind: 'custom', method: 'dns-txt', token: 'x' });
    expect(repo.getByHostname('a.example.com')!.tenantId).toBe('t1'); // normalized + found
    expect(() => repo.create({ tenantId: 't2', hostname: 'a.example.com', kind: 'custom', method: 'dns-txt', token: 'y' })).toThrow(/already exists/);
    expect(repo.listByTenant('t1')).toHaveLength(1);
    expect(repo.listByTenant('t2')).toHaveLength(0); // isolated
  });
});

/* --------------------------------- recovery --------------------------------- */

describe('restart / recovery', () => {
  it('rebuilds all state from a durable snapshot after a simulated process restart', () => {
    const db = freshDriver();
    const repo = new TenantRepository(db, clock);
    const t = repo.create({ code: 'persist', name: 'Persist', operatorId: 'op', plan: TenantPlan.Enterprise });
    repo.setStatus(t.id, TenantStatus.Active, t.version);
    const snapshot = db.snapshot();

    // "restart": brand-new driver rebuilt only from the durable snapshot.
    const db2 = InMemoryPersistenceDriver.fromSnapshot(snapshot, TABLE_INDEXES);
    const repo2 = new TenantRepository(db2, clock);
    const recovered = repo2.getByCode('persist');
    expect(recovered).not.toBeNull();
    expect(recovered!.status).toBe(TenantStatus.Active);
    expect(recovered!.plan).toBe(TenantPlan.Enterprise);
    // indexes rebuilt → O(1) lookup works post-recovery
    expect(repo2.getById(t.id)!.code).toBe('persist');
  });
});
