/**
 * Persistence driver (Phase 3.2, STEP 1 & 23).
 *
 * A framework-agnostic, transactional table store — the seam between the control plane
 * and a real database. `InMemoryPersistenceDriver` is the default implementation used by
 * unit tests, local dev and isolated engine tests; a production deployment implements the
 * same `PersistenceDriver` interface over Postgres/Prisma (mapping documented in
 * `docs/TENANT_DATABASE.md`). The store maintains named indexes for O(1) lookups, enforces
 * unique constraints, and supports snapshot-isolated transactions with rollback. Additive;
 * no frozen module is touched.
 */
import { ControlPlaneError, uniqueViolation } from './errors';

export interface IndexDef<R> {
  name: string;
  unique: boolean;
  /** Return the index key for a row, or null to exclude the row from this index. */
  keyFn: (row: R) => string | null;
}

interface TableIndex<R> {
  def: IndexDef<R>;
  map: Map<string, Set<string>>; // key → row ids
}

interface TableData<R extends { id: string }> {
  rows: Map<string, R>;
  indexes: Map<string, TableIndex<R>>;
}

/** The persistence contract every store (in-memory or SQL) implements. */
export interface PersistenceDriver {
  defineTable<R extends { id: string }>(name: string, indexes?: IndexDef<R>[]): void;
  insert<R extends { id: string }>(table: string, row: R): R;
  update<R extends { id: string }>(table: string, row: R): R;
  remove(table: string, id: string): boolean;
  get<R extends { id: string }>(table: string, id: string): R | null;
  byIndex<R extends { id: string }>(table: string, index: string, key: string): R[];
  oneByIndex<R extends { id: string }>(table: string, index: string, key: string): R | null;
  all<R extends { id: string }>(table: string): R[];
  count(table: string): number;
  transaction<T>(fn: () => T): T;
}

export class InMemoryPersistenceDriver implements PersistenceDriver {
  private tables = new Map<string, TableData<{ id: string }>>();

  defineTable<R extends { id: string }>(name: string, indexes: IndexDef<R>[] = []): void {
    if (this.tables.has(name)) return;
    const idx = new Map<string, TableIndex<{ id: string }>>();
    for (const def of indexes) idx.set(def.name, { def: def as IndexDef<{ id: string }>, map: new Map() });
    this.tables.set(name, { rows: new Map(), indexes: idx });
  }

  private table<R extends { id: string }>(name: string): TableData<R> {
    const t = this.tables.get(name);
    if (!t) throw new ControlPlaneError('VALIDATION', `unknown table "${name}"`);
    return t as unknown as TableData<R>;
  }

  private checkUnique<R extends { id: string }>(t: TableData<R>, row: R, ignoreId?: string): void {
    for (const idx of t.indexes.values()) {
      if (!idx.def.unique) continue;
      const key = idx.def.keyFn(row);
      if (key === null) continue;
      const owners = idx.map.get(key);
      if (owners) for (const owner of owners) if (owner !== ignoreId) throw uniqueViolation(`${idx.def.name}`, key);
    }
  }

  private indexRow<R extends { id: string }>(t: TableData<R>, row: R): void {
    for (const idx of t.indexes.values()) {
      const key = idx.def.keyFn(row);
      if (key === null) continue;
      const set = idx.map.get(key) ?? new Set<string>();
      set.add(row.id);
      idx.map.set(key, set);
    }
  }

  private deindexRow<R extends { id: string }>(t: TableData<R>, row: R): void {
    for (const idx of t.indexes.values()) {
      const key = idx.def.keyFn(row);
      if (key === null) continue;
      const set = idx.map.get(key);
      if (set) {
        set.delete(row.id);
        if (set.size === 0) idx.map.delete(key);
      }
    }
  }

  insert<R extends { id: string }>(table: string, row: R): R {
    const t = this.table<R>(table);
    if (t.rows.has(row.id)) throw uniqueViolation(`${table} id`, row.id);
    this.checkUnique(t, row);
    t.rows.set(row.id, row);
    this.indexRow(t, row);
    return row;
  }

  update<R extends { id: string }>(table: string, row: R): R {
    const t = this.table<R>(table);
    const prev = t.rows.get(row.id);
    if (!prev) throw new ControlPlaneError('NOT_FOUND', `${table} "${row.id}" not found`);
    this.checkUnique(t, row, row.id);
    this.deindexRow(t, prev);
    t.rows.set(row.id, row);
    this.indexRow(t, row);
    return row;
  }

  remove(table: string, id: string): boolean {
    const t = this.table(table);
    const prev = t.rows.get(id);
    if (!prev) return false;
    this.deindexRow(t, prev);
    return t.rows.delete(id);
  }

  get<R extends { id: string }>(table: string, id: string): R | null {
    return (this.table<R>(table).rows.get(id) ?? null) as R | null;
  }

  byIndex<R extends { id: string }>(table: string, index: string, key: string): R[] {
    const t = this.table<R>(table);
    const idx = t.indexes.get(index);
    if (!idx) throw new ControlPlaneError('VALIDATION', `unknown index "${index}" on "${table}"`);
    const ids = idx.map.get(key);
    if (!ids) return [];
    return [...ids].map((id) => t.rows.get(id)!).filter(Boolean) as R[];
  }

  oneByIndex<R extends { id: string }>(table: string, index: string, key: string): R | null {
    return this.byIndex<R>(table, index, key)[0] ?? null;
  }

  all<R extends { id: string }>(table: string): R[] {
    return [...this.table<R>(table).rows.values()] as R[];
  }

  count(table: string): number {
    return this.table(table).rows.size;
  }

  /**
   * Snapshot-isolated transaction: clones every table's rows + index maps, runs `fn`, and
   * restores the snapshot if `fn` throws (rollback). Rows are treated as immutable (always
   * replaced, never mutated in place) so shallow row copies are safe.
   */
  transaction<T>(fn: () => T): T {
    const snapshot = this.snapshotTables();
    try {
      return fn();
    } catch (err) {
      this.restoreTables(snapshot);
      throw err;
    }
  }

  private snapshotTables(): Map<string, TableData<{ id: string }>> {
    const copy = new Map<string, TableData<{ id: string }>>();
    for (const [name, t] of this.tables) {
      const indexes = new Map<string, TableIndex<{ id: string }>>();
      for (const [iname, idx] of t.indexes) {
        const map = new Map<string, Set<string>>();
        for (const [k, set] of idx.map) map.set(k, new Set(set));
        indexes.set(iname, { def: idx.def, map });
      }
      copy.set(name, { rows: new Map(t.rows), indexes });
    }
    return copy;
  }

  private restoreTables(snapshot: Map<string, TableData<{ id: string }>>): void {
    this.tables = snapshot;
  }

  /* --------------------- durability / recovery simulation --------------------- */

  /** Serialize the durable state (survives a simulated process restart). */
  snapshot(): string {
    const dump: Record<string, unknown[]> = {};
    for (const [name, t] of this.tables) dump[name] = [...t.rows.values()];
    return JSON.stringify(dump);
  }

  /** Rebuild a driver from a serialized snapshot, replaying rows into the given index defs. */
  static fromSnapshot(snapshot: string, tableIndexes: Record<string, IndexDef<{ id: string }>[]>): InMemoryPersistenceDriver {
    const driver = new InMemoryPersistenceDriver();
    const dump = JSON.parse(snapshot) as Record<string, { id: string }[]>;
    for (const [name, indexes] of Object.entries(tableIndexes)) driver.defineTable(name, indexes);
    for (const [name, rows] of Object.entries(dump)) {
      if (!driver.tables.has(name)) driver.defineTable(name, []);
      for (const row of rows) driver.insert(name, row);
    }
    return driver;
  }
}
