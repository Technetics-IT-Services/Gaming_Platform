/**
 * Phase 2D.7 — CSV serialisation for operator report exports.
 *
 * Deliberately dependency-free: the repository has no CSV/spreadsheet library and no file-generation
 * infrastructure, and a report writer is small enough that adding one would be a larger liability
 * than the ~60 lines below. RFC 4180 quoting plus spreadsheet formula-injection defence.
 *
 * THE TWO RULES THAT MATTER
 *
 * 1. **Formula injection.** A spreadsheet treats a cell beginning `=`, `+`, `-`, `@`, TAB or CR as a
 *    formula. A value like `=cmd|'/c calc'!A0` sitting in a database text column would execute on
 *    open. Such values are neutralised by prefixing an apostrophe, which spreadsheets strip on
 *    display.
 *
 * 2. **...but a negative number must survive.** `-1250.00` also starts with `-`, and mangling it
 *    would corrupt a financial report — the exact failure the escaping is supposed to prevent. So a
 *    value that parses as a plain number is never escaped. `NUMERIC_RE` is deliberately strict
 *    (optional sign, digits, optional single decimal part, optional exponent) so that
 *    `-1e3-cmd` or `-1+1` do NOT qualify.
 */

/** A value that is unambiguously a number, and therefore safe to leave unescaped. */
const NUMERIC_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Leading characters a spreadsheet may interpret as the start of a formula. */
const FORMULA_LEAD = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Neutralise one cell.
 *
 * `null`/`undefined` become an empty cell (NOT the string "null", and NOT `0` — an absent value must
 * never read as a measured zero in an exported report).
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = typeof value === 'string' ? value : String(value);

  // Formula-injection defence, applied only to values that are not plainly numeric.
  if (text.length > 0 && FORMULA_LEAD.has(text[0]!) && !NUMERIC_RE.test(text)) {
    text = `'${text}`;
  }

  // RFC 4180: quote when the field contains a quote, comma, or any line break; double inner quotes.
  if (/["\n\r,]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Serialise one row. */
export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(',');
}

/**
 * Serialise a full document with `\r\n` terminators (RFC 4180) and a UTF-8 BOM.
 *
 * The BOM is present because these are operator reports opened in Excel, which otherwise mis-decodes
 * UTF-8. It is documented in PHASE_2D7_REPORT_DEFINITIONS.md and asserted by test, so a consumer
 * parsing programmatically knows to expect it.
 */
export const UTF8_BOM = '﻿';

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [csvRow(header), ...rows.map(csvRow)];
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}

/**
 * Build a safe `Content-Disposition` filename.
 *
 * Everything outside `[A-Za-z0-9._-]` is replaced, so a caller-influenced value can never introduce
 * a path separator, `..`, a quote, or a CR/LF header break.
 */
export function safeFilename(base: string): string {
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]/g, '-') // no separators, quotes, CR/LF — only a safe alphabet survives
    .replace(/\.{2,}/g, '.') // collapse `..` so the result cannot even LOOK like a traversal
    .replace(/^[.-]+/, '') // no leading dot/dash: no hidden files, no arg-looking names
    .slice(0, 100);
  return cleaned.length > 0 ? cleaned : 'report';
}
