'use client';

import { cn } from '@gaming-platform/ui';
import {
  CircleDot,
  Club,
  Dice5,
  Gamepad2,
  Gem,
  Rocket,
  Spade,
  Swords,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';

/**
 * Always-visual game cover. Uses the real artwork when present; otherwise
 * generates ORIGINAL, deterministic cover art (seeded gradient + themed icon +
 * decorative shapes) so no card is ever an empty placeholder. Animated on hover
 * (gradient drift + floating icon + sheen) as a lightweight "trailer" feel.
 */

const PALETTES: [number, number, number][] = [
  [263, 326, 222], // purple → pink
  [190, 263, 210], // cyan → purple
  [326, 38, 268], // pink → gold
  [152, 190, 210], // emerald → cyan
  [222, 263, 190], // blue → purple
  [38, 326, 263], // gold → pink
  [270, 210, 190], // violet → blue
];

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function iconFor(key: string): LucideIcon {
  const k = key.toLowerCase();
  if (k.includes('crash') || k.includes('rocket')) return Rocket;
  if (k.includes('dice')) return Dice5;
  if (k.includes('roulette') || k.includes('wheel')) return CircleDot;
  if (k.includes('card') || k.includes('poker') || k.includes('patti') || k.includes('baccarat'))
    return Spade;
  if (k.includes('black') || k.includes('21')) return Club;
  if (k.includes('sport') || k.includes('bet')) return TrendingUp;
  if (k.includes('tournament') || k.includes('vip')) return Trophy;
  if (k.includes('gem') || k.includes('mine') || k.includes('plinko')) return Gem;
  if (k.includes('arcade') || k.includes('battle') || k.includes('war')) return Swords;
  return Gamepad2;
}

export interface GameCoverProps {
  src?: string | null;
  name: string;
  /** Stable seed for the generated art (game id or slug). */
  seed?: string;
  /** Category/type hint to pick the themed icon. */
  hint?: string | null;
  className?: string;
  sizes?: string;
  priority?: boolean;
  /** Set on a hoverable parent with `group` for the hover animation. */
  rounded?: boolean;
  /** Show the game name plate on generated art (default true). */
  showTitle?: boolean;
}

export function GameCover({
  src,
  name,
  seed,
  hint,
  className,
  sizes = '(max-width: 768px) 45vw, 220px',
  priority,
  rounded = false,
  showTitle = true,
}: GameCoverProps) {
  if (src) {
    return (
      <Image
        src={src}
        alt={name}
        fill
        sizes={sizes}
        priority={priority}
        loading={priority ? undefined : 'lazy'}
        className={cn('object-cover transition-transform duration-500 group-hover:scale-110', className)}
      />
    );
  }

  const seedStr = seed ?? name;
  const h = hash(seedStr);
  const [a, b, c] = PALETTES[h % PALETTES.length]!;
  const Icon = iconFor(`${hint ?? ''} ${name}`);
  const angle = 120 + (h % 90);

  return (
    <div
      aria-label={name}
      role="img"
      className={cn('absolute inset-0 overflow-hidden', rounded && 'rounded-xl', className)}
      style={{
        backgroundImage: `linear-gradient(${angle}deg, hsl(${a} 88% 64%), hsl(${b} 84% 60%) 55%, hsl(${c} 80% 56%))`,
      }}
    >
      {/* animated wash */}
      <div
        className="absolute inset-0 opacity-70 mix-blend-soft-light transition-transform duration-700 group-hover:scale-110"
        style={{
          backgroundImage: `radial-gradient(120% 90% at ${20 + (h % 60)}% 12%, hsl(0 0% 100% / 0.55), transparent 55%)`,
        }}
      />
      {/* decorative blurred orbs */}
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/30 blur-2xl" />
      <div className="absolute -bottom-8 -left-4 h-28 w-28 rounded-full bg-black/10 blur-2xl" />
      {/* dotted grid */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'radial-gradient(hsl(0 0% 100% / 0.7) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
        }}
      />
      {/* floating themed icon */}
      <Icon className="absolute right-3 top-3 h-10 w-10 text-white/40" />
      <Icon className="absolute left-1/2 top-[42%] h-20 w-20 -translate-x-1/2 -translate-y-1/2 text-white/90 drop-shadow-[0_6px_18px_rgba(0,0,0,0.25)] transition-transform duration-500 group-hover:-translate-y-[58%] group-hover:scale-110" />
      {/* title plate */}
      {showTitle ? (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/55 to-transparent p-3 pt-8">
          <p className="line-clamp-2 font-display text-sm font-bold leading-tight text-white drop-shadow">
            {name}
          </p>
        </div>
      ) : null}
      {/* sheen */}
      <div className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/35 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
    </div>
  );
}
