/**
 * Production qualification scorecard (Phase 11, STEP 7 & 9).
 *
 * Grades measured performance against production targets across throughput, latency,
 * availability, scalability and resource utilization, and produces a pass/fail
 * scorecard + report. Pure aggregation of measurements — the qualification tool, not a
 * runtime path.
 */

export type Grade = 'pass' | 'warn' | 'fail';
export type CheckDirection = 'lower_is_better' | 'higher_is_better';

export interface QualCheck {
  category: 'throughput' | 'latency' | 'availability' | 'scalability' | 'resource';
  name: string;
  value: number;
  target: number;
  /** Optional warn boundary between target and fail. */
  warnAt?: number;
  direction: CheckDirection;
  unit?: string;
}

export interface QualResult extends QualCheck {
  grade: Grade;
}
export interface Scorecard {
  results: QualResult[];
  byCategory: Record<string, { pass: number; warn: number; fail: number }>;
  passed: boolean;
  score: number; // 0–100
  generatedAt: number;
}

function grade(check: QualCheck): Grade {
  const meets = check.direction === 'higher_is_better' ? check.value >= check.target : check.value <= check.target;
  if (meets) return 'pass';
  if (check.warnAt !== undefined) {
    const withinWarn = check.direction === 'higher_is_better' ? check.value >= check.warnAt : check.value <= check.warnAt;
    if (withinWarn) return 'warn';
  }
  return 'fail';
}

export function qualify(checks: QualCheck[], now: number): Scorecard {
  const results: QualResult[] = checks.map((c) => ({ ...c, grade: grade(c) }));
  const byCategory: Record<string, { pass: number; warn: number; fail: number }> = {};
  let points = 0;
  for (const r of results) {
    const cat = (byCategory[r.category] ??= { pass: 0, warn: 0, fail: 0 });
    cat[r.grade] += 1;
    points += r.grade === 'pass' ? 1 : r.grade === 'warn' ? 0.5 : 0;
  }
  const score = results.length ? Math.round((points / results.length) * 100) : 0;
  return { results, byCategory, passed: results.every((r) => r.grade !== 'fail'), score, generatedAt: now };
}

/** Render the scorecard as an export-ready table. */
export function scorecardReport(card: Scorecard): { columns: string[]; rows: (string | number)[][] } {
  return {
    columns: ['category', 'check', 'value', 'target', 'grade'],
    rows: card.results.map((r) => [r.category, r.name, `${r.value}${r.unit ?? ''}`, `${r.target}${r.unit ?? ''}`, r.grade.toUpperCase()]),
  };
}
