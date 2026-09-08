import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DANGER, DANGER_SURFACE, DISABLED, INFO, INFO_SURFACE, INSET, LINE, MUTED,
  PANEL, SUCCESS, SUCCESS_SURFACE, SURFACE, TEXT, WARN, WARN_SURFACE,
} from './surface';

/**
 * Phase 2D.14 — the light surface palette, and the bug it exists to prevent.
 *
 * A run of inline-styled screens set a DARK-theme foreground (`#e5e7eb`) on their root element
 * while the app shell is light. Text inside their dark panels read fine; every heading, helper line
 * and empty state sitting directly on the shell rendered at **1.14:1** — invisible. These tests do
 * the contrast arithmetic for real, and then check the retired palette has not crept back.
 */

/* --------------------------------------------------------------- WCAG maths */

function srgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = srgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, rounded to 2dp so failures read clearly. */
export function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return Math.round(ratio * 100) / 100;
}

describe('contrast() itself is trustworthy', () => {
  it('agrees with the known reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBe(21);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
    // The exact combination that shipped broken: #e5e7eb on the light shell.
    expect(contrast('#e5e7eb', '#eef7ff')).toBeLessThan(1.2);
  });
});

/* ------------------------------------------------------- the palette clears AA */

describe('every palette colour clears WCAG AA on the surfaces it is used on', () => {
  const NORMAL = 4.5;

  it.each([
    ['TEXT', TEXT], ['MUTED', MUTED], ['DISABLED', DISABLED],
    ['DANGER', DANGER], ['WARN', WARN], ['SUCCESS', SUCCESS], ['INFO', INFO],
  ])('%s is readable on a white card and on the inset surface', (name, colour) => {
    expect(contrast(colour, SURFACE), `${name} on SURFACE`).toBeGreaterThanOrEqual(NORMAL);
    expect(contrast(colour, INSET), `${name} on INSET`).toBeGreaterThanOrEqual(NORMAL);
  });

  it.each([
    ['DANGER', DANGER, DANGER_SURFACE],
    ['WARN', WARN, WARN_SURFACE],
    ['SUCCESS', SUCCESS, SUCCESS_SURFACE],
    ['INFO', INFO, INFO_SURFACE],
  ])('%s stays readable on its own tinted surface', (_n, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(NORMAL);
  });

  it('secondary text is clearly weaker than primary but still AA — a real hierarchy', () => {
    expect(contrast(MUTED, SURFACE)).toBeLessThan(contrast(TEXT, SURFACE));
    expect(contrast(MUTED, SURFACE)).toBeGreaterThanOrEqual(NORMAL);
  });

  it('disabled text is dimmer than secondary yet still distinguishable', () => {
    expect(contrast(DISABLED, SURFACE)).toBeLessThan(contrast(MUTED, SURFACE));
    expect(contrast(DISABLED, SURFACE)).toBeGreaterThanOrEqual(NORMAL);
  });

  it('the hairline border is visible against both surfaces without becoming text-dark', () => {
    expect(contrast(LINE, SURFACE)).toBeGreaterThan(1.1);
    expect(contrast(LINE, SURFACE)).toBeLessThan(NORMAL);
  });

  it('PANEL is a light card, not a dark one', () => {
    expect(PANEL.background).toBe(SURFACE);
    expect(luminance(SURFACE)).toBeGreaterThan(0.7);
  });
});

/* ------------------------------------------- the retired palette stays retired */

const SRC = join(process.cwd(), 'src');
/** The dark-theme literals that produced the invisible text. */
const RETIRED = ['#e5e7eb', '#0b0f19', '#fca5a5', '#93c5fd', '#34d399', '#fbbf24'];

function screens(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Game boards and wheel artwork are a deliberately dark casino table, kept as brand
      // identity. They are self-consistent (dark felt, light chips) and measured separately.
      if (entry === 'games' || entry === 'roulette') continue;
      screens(full, acc);
    } else if (entry.endsWith('.tsx')) {
      acc.push(full);
    }
  }
  return acc;
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the dark palette does not come back to the account, cashier and operator screens', () => {
  const files = [...screens(join(SRC, 'app')), ...screens(join(SRC, 'components'))]
    // The player card is SVG avatar artwork: #1f2937 draws eyes and eyebrows, not a border.
    .filter((f) => !f.includes('player-card'));

  it.each(RETIRED)('no screen re-introduces %s', (literal) => {
    const offenders = files.filter((f) => stripComments(readFileSync(f, 'utf8')).toLowerCase().includes(literal));
    expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });

  it('the cashier form paints a light card with dark text', () => {
    const src = readFileSync(join(SRC, 'components/wallet/cashier/CashierForm.tsx'), 'utf8');
    expect(src).toContain(TEXT);
    expect(src).toContain(SURFACE);
    // The balance is the single most important number on the screen.
    expect(src).toContain(SUCCESS);
  });

  it('a disabled submit button keeps readable text rather than white on grey', () => {
    const src = readFileSync(join(SRC, 'components/wallet/cashier/CashierForm.tsx'), 'utf8');
    const disabled = /!valid \? '(#[0-9a-f]{6})'/i.exec(src);
    expect(disabled).not.toBeNull();
    expect(contrast('#4a5164', disabled![1])).toBeGreaterThanOrEqual(4.5);
  });
});
