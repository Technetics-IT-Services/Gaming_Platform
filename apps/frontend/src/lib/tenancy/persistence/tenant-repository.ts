/**
 * Tenant Repository (Phase 3.2, STEP 2).
 *
 * The persistence abstraction for tenant records: transactional writes, optimistic
 * concurrency, unique tenant code, immutable tenant id, soft deletion, deterministic
 * error codes, and NO raw database details exposed to callers. Backed by a
 * `PersistenceDriver` (in-memory for tests/dev, SQL/Prisma in production — same interface).
 */
import type { PersistenceDriver } from './driver';
import { ControlPlaneError, notFound } from './errors';
import type { TenantRow } from './records';
import { TABLES } from './schema';
import { assertVersion, bump, secureId } from './util';
import {
  defaultBrand,
  defaultTheme,
  PLAN_LIMITS,
} from '../defaults';
import {
  type BrandConfiguration,
  type TenantLimits,
  type TenantMetadata,
  TenantPlan,
  type TenantRegion,
  TenantStatus,
  type ThemeConfiguration,
} from '../types';

export interface CreateTenantRecord {
  code: string;
  name: string;
  operatorId: string;
  plan?: TenantPlan;
  region?: TenantRegion;
  timezone?: string;
  currency?: string;
  locale?: string;
  brand?: Partial<BrandConfiguration>;
  theme?: Partial<ThemeConfiguration>;
  limits?: Partial<TenantLimits>;
  metadata?: TenantMetadata;
  actor?: string;
}

export interface UpdateTenantRecord {
  name?: string;
  plan?: TenantPlan;
  region?: TenantRegion;
  timezone?: string;
  currency?: string;
  locale?: string;
  brand?: Partial<BrandConfiguration>;
  theme?: Partial<ThemeConfiguration>;
  limits?: Partial<TenantLimits>;
  metadata?: TenantMetadata;
}

export interface TenantSearch {
  status?: TenantStatus;
  plan?: TenantPlan;
  region?: TenantRegion;
  operatorId?: string;
  text?: string;
}

export interface ITenantRepository {
  create(input: CreateTenantRecord): TenantRow;
  getById(id: string): TenantRow | null;
  getByCode(code: string): TenantRow | null;
  getByOperator(operatorId: string): TenantRow[];
  update(id: string, patch: UpdateTenantRecord, expectedVersion: number, actor?: string): TenantRow;
  setStatus(id: string, status: TenantStatus, expectedVersion: number, actor?: string): TenantRow;
  suspend(id: string, expectedVersion: number, actor?: string): TenantRow;
  restore(id: string, expectedVersion: number, actor?: string): TenantRow;
  archive(id: string, expectedVersion: number, actor?: string): TenantRow;
  delete(id: string, expectedVersion: number, actor?: string): TenantRow;
  purge(id: string): void;
  list(): TenantRow[];
  search(query: TenantSearch): TenantRow[];
  exists(code: string): boolean;
}

const CODE = (c: string) => c.trim().toLowerCase();

export class TenantRepository implements ITenantRepository {
  constructor(private readonly db: PersistenceDriver, private readonly clock: () => number = () => Date.now()) {}

  create(input: CreateTenantRecord): TenantRow {
    const code = CODE(input.code);
    if (!code) throw new ControlPlaneError('VALIDATION', 'tenant code is required');
    const now = this.clock();
    const plan = input.plan ?? TenantPlan.Starter;
    const row: TenantRow = {
      id: secureId('tnt'),
      code,
      name: input.name,
      operatorId: input.operatorId,
      status: TenantStatus.Provisioned,
      plan,
      region: input.region ?? 'global',
      timezone: input.timezone ?? 'UTC',
      currency: input.currency ?? 'USD',
      locale: input.locale ?? 'en-US',
      brand: { ...defaultBrand(input.name), ...input.brand },
      theme: { ...defaultTheme(), ...input.theme },
      limits: { ...PLAN_LIMITS[plan], ...input.limits },
      metadata: { ...input.metadata },
      createdAt: now,
      updatedAt: now,
      createdBy: input.actor,
      updatedBy: input.actor,
      version: 1,
      provisionedAt: now,
    };
    // Transactional insert (unique code enforced by the driver index).
    return this.db.transaction(() => this.db.insert(TABLES.tenants, row));
  }

  getById(id: string): TenantRow | null {
    return this.db.get<TenantRow>(TABLES.tenants, id);
  }
  getByCode(code: string): TenantRow | null {
    return this.db.oneByIndex<TenantRow>(TABLES.tenants, 'tenants_code_uq', CODE(code));
  }
  getByOperator(operatorId: string): TenantRow[] {
    return this.db.byIndex<TenantRow>(TABLES.tenants, 'tenants_operator', operatorId);
  }
  exists(code: string): boolean {
    return this.getByCode(code) !== null;
  }

  private mustGet(id: string): TenantRow {
    const row = this.getById(id);
    if (!row) throw notFound('tenant', id);
    return row;
  }

  update(id: string, patch: UpdateTenantRecord, expectedVersion: number, actor?: string): TenantRow {
    return this.db.transaction(() => {
      const row = this.mustGet(id);
      assertVersion('tenant', row, expectedVersion);
      const limits = patch.plan && patch.plan !== row.plan
        ? { ...PLAN_LIMITS[patch.plan], ...patch.limits }
        : patch.limits ? { ...row.limits, ...patch.limits } : row.limits;
      const next = bump(row, {
        name: patch.name ?? row.name,
        plan: patch.plan ?? row.plan,
        region: patch.region ?? row.region,
        timezone: patch.timezone ?? row.timezone,
        currency: patch.currency ?? row.currency,
        locale: patch.locale ?? row.locale,
        brand: patch.brand ? { ...row.brand, ...patch.brand } : row.brand,
        theme: patch.theme ? { ...row.theme, ...patch.theme } : row.theme,
        limits,
        metadata: patch.metadata ? { ...row.metadata, ...patch.metadata } : row.metadata,
      }, this.clock(), actor);
      return this.db.update(TABLES.tenants, next);
    });
  }

  setStatus(id: string, status: TenantStatus, expectedVersion: number, actor?: string): TenantRow {
    return this.db.transaction(() => {
      const row = this.mustGet(id);
      assertVersion('tenant', row, expectedVersion);
      const now = this.clock();
      const stamp: Partial<TenantRow> =
        status === TenantStatus.Active ? { activatedAt: now }
        : status === TenantStatus.Suspended ? { suspendedAt: now }
        : status === TenantStatus.Archived ? { archivedAt: now }
        : status === TenantStatus.Deleted ? { deletedAt: now }
        : {};
      const next = bump(row, { status, ...stamp }, now, actor);
      return this.db.update(TABLES.tenants, next);
    });
  }

  suspend(id: string, expectedVersion: number, actor?: string): TenantRow {
    return this.setStatus(id, TenantStatus.Suspended, expectedVersion, actor);
  }
  restore(id: string, expectedVersion: number, actor?: string): TenantRow {
    return this.setStatus(id, TenantStatus.Active, expectedVersion, actor);
  }
  archive(id: string, expectedVersion: number, actor?: string): TenantRow {
    return this.setStatus(id, TenantStatus.Archived, expectedVersion, actor);
  }
  delete(id: string, expectedVersion: number, actor?: string): TenantRow {
    return this.setStatus(id, TenantStatus.Deleted, expectedVersion, actor);
  }
  purge(id: string): void {
    this.db.transaction(() => this.db.remove(TABLES.tenants, id));
  }

  list(): TenantRow[] {
    return this.db.all<TenantRow>(TABLES.tenants).sort((a, b) => a.createdAt - b.createdAt);
  }
  search(query: TenantSearch): TenantRow[] {
    const text = query.text?.trim().toLowerCase();
    const base = query.operatorId ? this.getByOperator(query.operatorId) : this.list();
    return base
      .filter((t) =>
        (query.status === undefined || t.status === query.status) &&
        (query.plan === undefined || t.plan === query.plan) &&
        (query.region === undefined || t.region === query.region) &&
        (!text || t.code.includes(text) || t.name.toLowerCase().includes(text)),
      )
      .sort((a, b) => a.createdAt - b.createdAt);
  }
}
