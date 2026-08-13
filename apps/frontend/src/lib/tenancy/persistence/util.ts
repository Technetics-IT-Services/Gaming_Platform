/**
 * Persistence utilities (Phase 3.2) — id generation, version bumping, optimistic checks.
 * Pure + deterministic-friendly (ids use crypto random; sequence suffix keeps them unique
 * even within the same millisecond). No frozen module.
 */
import { conflict } from './errors';
import type { BaseRow } from './records';

let SEQ = 0;
export function secureId(prefix: string): string {
  const bytes = new Uint8Array(9);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) crypto.getRandomValues(bytes);
  SEQ += 1;
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}${SEQ.toString(36)}`;
}

/** Assert the caller's optimistic version matches the stored row. */
export function assertVersion(what: string, row: BaseRow, expectedVersion?: number): void {
  if (expectedVersion !== undefined && expectedVersion !== row.version) throw conflict(what, expectedVersion, row.version);
}

/** Produce the next version of a row (bumped version + audit columns). */
export function bump<R extends BaseRow>(row: R, patch: Partial<R>, now: number, actor?: string): R {
  return { ...row, ...patch, version: row.version + 1, updatedAt: now, updatedBy: actor ?? row.updatedBy };
}
