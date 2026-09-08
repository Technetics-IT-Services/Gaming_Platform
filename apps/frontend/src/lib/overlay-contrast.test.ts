import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contrast } from './surface.test';

/**
 * Phase 2D.14 cleanup — text that sits ON TOP of colour.
 *
 * The wallet/account fix made light surfaces readable. The demo and discovery pages fail a
 * different way: a chip or badge is dropped onto a colourful game tile, and because its own
 * background is translucent (`bg-emerald/15`, `bg-white/80`) the tile shows straight through, so
 * the text has nothing to sit on. Measured 1.36:1 on `/games`.
 *
 * The second failure mode is a gradient that carries white text but contains a LIGHT stop —
 * `--warning` was a pale amber surface token paired with a dark foreground and had no business
 * under white text. These tests pin both rules.
 */

const UI = join(process.cwd(), '..', '..', 'packages', 'ui', 'src');
const SRC = join(process.cwd(), 'src');
const read = (p: string) => readFileSync(p, 'utf8');

/* --------------------------------------------------- badges over artwork ---- */

describe('a badge must not rely on whatever it is dropped onto', () => {
  const badge = read(join(UI, 'components', 'badge.tsx'));
  const variants = badge.slice(badge.indexOf('variant: {'), badge.indexOf('defaultVariants'));

  it.each(['neon', 'live', 'new'])(
    'the %s badge paints its own opaque surface, not a translucent tint',
    (name) => {
      const line = variants.split('\n').find((l) => l.trim().startsWith(`${name}:`));
      expect(line, `${name} variant present`).toBeDefined();
      // A `/NN` alpha on the BACKGROUND is what let the tile through.
      expect(line).not.toMatch(/bg-[a-z-]+\/\d+/);
      expect(line).toContain('bg-card');
    },
  );

  it('gradient badges carrying white text contain no light stop', () => {
    // `--warning` used to be the pale stop under white text in `hot` and `jackpot`.
    for (const name of ['hot', 'jackpot']) {
      const idx = variants.indexOf(`${name}:`);
      expect(idx, `${name} variant present`).toBeGreaterThan(-1);
      const line = variants.slice(idx, idx + 200);
      if (!line.includes('text-white')) continue;
      expect(`${name}: ${/(from|via|to)-warning/.test(line)}`).toBe(`${name}: false`);
    }
  });
});

/* ------------------------------------------- tokens that carry white text ---- */

describe('every accent token used under white text clears AA', () => {
  const css = read(join(UI, 'styles', 'globals.css'));
  const light = css.slice(css.indexOf(':root,'), css.indexOf('/* Legacy dark fallback'));

  /** hsl channels from a token declaration -> hex. */
  function tokenHex(name: string): string {
    const m = new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`).exec(light);
    expect(m, `--${name} declared in the light block`).not.toBeNull();
    const [h, s, l] = [Number(m![1]), Number(m![2]) / 100, Number(m![3]) / 100];
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const mm = l - c / 2;
    const seg = Math.floor(h / 60) % 6;
    const rgb = [
      [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
    ][seg]!.map((v) => Math.round((v + mm) * 255));
    return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  it.each(['primary', 'accent', 'success', 'warning', 'gold', 'emerald', 'pink', 'destructive', 'violet'])(
    '--%s carries white text at AA',
    (name) => {
      expect(contrast('#ffffff', tokenHex(name)), `white on --${name}`).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(['primary', 'accent', 'success', 'warning', 'gold', 'emerald', 'pink', 'destructive', 'violet'])(
    '--%s is also readable AS text on a white card',
    (name) => {
      expect(contrast(tokenHex(name), '#ffffff'), `--${name} on white`).toBeGreaterThanOrEqual(4.5);
    },
  );
});

/* ------------------------------------------------- no opacity-dimmed text ---- */

describe('readable tokens are not dimmed back below AA', () => {
  it('nothing applies an opacity modifier to text-muted-foreground', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.tsx') && /text-muted-foreground\/\d+/.test(read(full))) {
          offenders.push(full.slice(SRC.length + 1));
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});

/* ---------------------------------------------- metals stay readable metals -- */

describe('metal plates carry their white labels', () => {
  it('no VIP tier or cosmetic frame uses a pale metal gradient under white text', () => {
    for (const file of ['lib/vip.ts', 'lib/cosmetics.ts']) {
      const src = read(join(SRC, file));
      // slate-100..300 and amber-400..600 are too light to hold white text.
      expect(`${file}: ${/from-(slate|amber|gray|zinc)-(100|200|300|400)/.test(src)}`).toBe(`${file}: false`);
      expect(`${file}: ${/to-(slate|amber|gray|zinc)-(100|200|300|400)/.test(src)}`).toBe(`${file}: false`);
    }
  });

  it('every lucky-wheel segment colour carries its white label', () => {
    const src = read(join(SRC, 'components/rewards/lucky-wheel.tsx'));
    const colours = [...src.matchAll(/color: '(#[0-9a-f]{6})'/gi)].map((m) => m[1]!);
    expect(colours.length).toBeGreaterThan(4);
    for (const c of colours) {
      expect(contrast('#ffffff', c), `white on ${c}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
