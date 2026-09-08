'use client';

import { Badge, cn } from '@gaming-platform/ui';
import { motion } from 'framer-motion';
import {
  Clock,
  Crown,
  Gamepad2,
  MapPin,
  Shield,
  Sparkles,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import { useMemo } from 'react';

import {
  ACCENT_HUES,
  type AvatarConfig,
  BG_GRADIENTS,
  CLOTHES_COLORS,
  cosmeticById,
  DEFAULT_AVATAR,
  HAIR_COLORS,
  SKIN_TONES,
} from '@/lib/cosmetics';
import { usePlayerProfile } from '@/stores/player-profile';

/* ------------------------------------------------------------------ helpers */

/** Safe indexed access that respects noUncheckedIndexedAccess. */
function pick<T>(arr: readonly T[], i: number, fallback: T): T {
  return arr[((i % arr.length) + arr.length) % arr.length] ?? fallback;
}

function darken(hex: string, amount = 0.22): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = Math.max(0, Math.round(parseInt(h.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(h.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(h.slice(4, 6), 16) * (1 - amount)));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function formatPlayTime(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}h ${rem.toString().padStart(2, '0')}m`;
}

/* ------------------------------------------------------------ PlayerAvatar */

interface PlayerAvatarProps {
  config?: AvatarConfig;
  size?: number;
  /** Render the surrounding gradient background disc. Default true. */
  withBackground?: boolean;
  className?: string;
}

/**
 * Deterministic friendly vector avatar composed from an `AvatarConfig`.
 * Pure SVG — no external assets. Falls back to DEFAULT_AVATAR values.
 */
export function PlayerAvatar({
  config,
  size = 120,
  withBackground = true,
  className,
}: PlayerAvatarProps) {
  const c = config ?? DEFAULT_AVATAR;

  const skin = pick(SKIN_TONES, c.skin, SKIN_TONES[0]!);
  const skinShade = darken(skin, 0.14);
  const hairColor = pick(HAIR_COLORS, c.hairColor, HAIR_COLORS[0]!);
  const clothes = pick(CLOTHES_COLORS, c.clothesColor, CLOTHES_COLORS[0]!);
  const clothesShade = darken(clothes, 0.25);
  const bgGradient = pick(BG_GRADIENTS, c.background, BG_GRADIENTS[0]!);
  const accentHue = pick(ACCENT_HUES, c.accent, ACCENT_HUES[0]!);
  const accent = `hsl(${accentHue} 90% 60%)`;

  const uid = useMemo(
    () => `av-${Math.random().toString(36).slice(2, 9)}`,
    [],
  );

  const hasHair = c.hair > 0;
  const hairShape = c.hair; // 1..5
  const beard = c.beard; // 0 none
  const hat = c.hat; // 0 none
  const mask = c.mask; // 0 none
  const headphones = c.headphones; // 0 none
  const eyes = c.eyes; // 0..3
  const brows = c.brows; // 0..2
  const mouth = c.mouth; // 0..3
  const clothesStyle = c.clothes; // 0..3

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-full',
        withBackground && 'bg-gradient-to-br',
        withBackground && bgGradient,
        className,
      )}
      style={{ width: size, height: size }}
    >
      {/* accent glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(circle at 50% 120%, ${accent}66, transparent 60%)`,
        }}
      />
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        className="relative"
        role="img"
        aria-label="Player avatar"
      >
        <defs>
          <radialGradient id={`${uid}-bg`} cx="50%" cy="35%" r="75%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.12" />
          </radialGradient>
          <linearGradient id={`${uid}-cloth`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={clothes} />
            <stop offset="100%" stopColor={clothesShade} />
          </linearGradient>
        </defs>

        {/* inner disc sheen */}
        <circle cx="50" cy="50" r="50" fill={`url(#${uid}-bg)`} />

        {/* shoulders / clothes */}
        <g>
          {clothesStyle === 0 && (
            <path
              d="M18 100 v-8 a32 32 0 0 1 64 0 v8 Z"
              fill={`url(#${uid}-cloth)`}
            />
          )}
          {clothesStyle === 1 && (
            <>
              <path
                d="M16 100 v-10 a34 34 0 0 1 68 0 v10 Z"
                fill={`url(#${uid}-cloth)`}
              />
              <path d="M44 74 h12 l-2 14 h-8 Z" fill={clothesShade} />
            </>
          )}
          {clothesStyle === 2 && (
            <>
              <path
                d="M16 100 v-9 a34 34 0 0 1 68 0 v9 Z"
                fill={`url(#${uid}-cloth)`}
              />
              <path
                d="M50 74 L40 100 M50 74 L60 100"
                stroke={clothesShade}
                strokeWidth="3"
                fill="none"
              />
            </>
          )}
          {clothesStyle === 3 && (
            <>
              <path
                d="M14 100 v-8 a36 36 0 0 1 72 0 v8 Z"
                fill={`url(#${uid}-cloth)`}
              />
              <rect x="30" y="82" width="40" height="6" rx="3" fill={accent} />
            </>
          )}
        </g>

        {/* neck */}
        <rect x="43" y="60" width="14" height="14" rx="6" fill={skinShade} />

        {/* head */}
        <ellipse cx="50" cy="44" rx="22" ry="24" fill={skin} />
        {/* ears */}
        <circle cx="28" cy="46" r="4.5" fill={skin} />
        <circle cx="72" cy="46" r="4.5" fill={skin} />

        {/* beard (behind mouth features) */}
        {beard === 1 && (
          <path d="M32 48 a18 22 0 0 0 36 0 v6 a18 18 0 0 1 -36 0 Z" fill={hairColor} opacity="0.9" />
        )}
        {beard === 2 && (
          <path d="M38 58 q12 12 24 0 q-2 10 -12 10 q-10 0 -12 -10 Z" fill={hairColor} opacity="0.9" />
        )}
        {beard === 3 && (
          <>
            <rect x="42" y="56" width="16" height="3" rx="1.5" fill={hairColor} />
            <path d="M42 60 h16 v3 a8 8 0 0 1 -16 0 Z" fill={hairColor} />
          </>
        )}

        {/* brows */}
        {brows === 0 && (
          <>
            <rect x="36" y="36" width="9" height="2.4" rx="1.2" fill={hairColor} />
            <rect x="55" y="36" width="9" height="2.4" rx="1.2" fill={hairColor} />
          </>
        )}
        {brows === 1 && (
          <>
            <path d="M36 37 q4.5 -3 9 0" stroke={hairColor} strokeWidth="2.4" fill="none" strokeLinecap="round" />
            <path d="M55 37 q4.5 -3 9 0" stroke={hairColor} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          </>
        )}
        {brows === 2 && (
          <>
            <path d="M36 35 l9 2.5" stroke={hairColor} strokeWidth="2.4" fill="none" strokeLinecap="round" />
            <path d="M64 35 l-9 2.5" stroke={hairColor} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          </>
        )}

        {/* eyes */}
        {eyes === 0 && (
          <>
            <circle cx="40.5" cy="43" r="2.6" fill="#1f2937" />
            <circle cx="59.5" cy="43" r="2.6" fill="#1f2937" />
          </>
        )}
        {eyes === 1 && (
          <>
            <ellipse cx="40.5" cy="43" rx="3" ry="3.4" fill="#ffffff" />
            <ellipse cx="59.5" cy="43" rx="3" ry="3.4" fill="#ffffff" />
            <circle cx="41" cy="43.5" r="1.7" fill="#1f2937" />
            <circle cx="60" cy="43.5" r="1.7" fill="#1f2937" />
          </>
        )}
        {eyes === 2 && (
          <>
            <path d="M37 43 q3.5 -3.5 7 0" stroke="#1f2937" strokeWidth="2.2" fill="none" strokeLinecap="round" />
            <path d="M56 43 q3.5 -3.5 7 0" stroke="#1f2937" strokeWidth="2.2" fill="none" strokeLinecap="round" />
          </>
        )}
        {eyes === 3 && (
          <>
            <circle cx="40.5" cy="43" r="3" fill={accent} />
            <circle cx="59.5" cy="43" r="3" fill={accent} />
            <circle cx="40.5" cy="43" r="1.3" fill="#0b0b12" />
            <circle cx="59.5" cy="43" r="1.3" fill="#0b0b12" />
          </>
        )}

        {/* mouth */}
        {mouth === 0 && (
          <path d="M43 54 q7 5 14 0" stroke={darken(skin, 0.4)} strokeWidth="2.2" fill="none" strokeLinecap="round" />
        )}
        {mouth === 1 && (
          <path d="M43 53 q7 7 14 0 q-7 3 -14 0 Z" fill={darken(skin, 0.45)} />
        )}
        {mouth === 2 && (
          <rect x="45" y="53" width="10" height="2.4" rx="1.2" fill={darken(skin, 0.4)} />
        )}
        {mouth === 3 && (
          <>
            <path d="M44 53 q6 6 12 0 q-6 4 -12 0 Z" fill="#7f1d1d" />
            <rect x="46" y="53" width="8" height="2.4" fill="#ffffff" />
          </>
        )}

        {/* mask (over lower face) */}
        {mask === 1 && (
          <path d="M32 46 q18 16 36 0 v8 a18 16 0 0 1 -36 0 Z" fill={accent} opacity="0.92" />
        )}
        {mask === 2 && (
          <path d="M34 48 q16 12 32 0 v6 a16 12 0 0 1 -32 0 Z" fill="#111827" opacity="0.88" />
        )}

        {/* hair */}
        {hasHair && hairShape === 1 && (
          <path d="M28 42 q0 -26 22 -26 q22 0 22 26 q-6 -12 -22 -12 q-16 0 -22 12 Z" fill={hairColor} />
        )}
        {hasHair && hairShape === 2 && (
          <path d="M27 44 q-2 -30 23 -30 q25 0 23 30 q-4 -6 -8 -8 q2 -10 -15 -10 q-17 0 -15 10 q-4 2 -8 8 Z" fill={hairColor} />
        )}
        {hasHair && hairShape === 3 && (
          <>
            <path d="M28 40 q0 -24 22 -24 q22 0 22 24 q-6 -10 -22 -10 q-16 0 -22 10 Z" fill={hairColor} />
            <path d="M50 16 q8 6 8 20 l4 -2 q0 -16 -12 -18 Z" fill={darken(hairColor, 0.2)} />
          </>
        )}
        {hasHair && hairShape === 4 && (
          <>
            <ellipse cx="50" cy="22" rx="24" ry="16" fill={hairColor} />
            <circle cx="30" cy="30" r="7" fill={hairColor} />
            <circle cx="70" cy="30" r="7" fill={hairColor} />
            <circle cx="50" cy="14" r="8" fill={hairColor} />
          </>
        )}
        {hasHair && hairShape === 5 && (
          <>
            <path d="M28 40 q0 -24 22 -24 q22 0 22 24 q-6 -10 -22 -10 q-16 0 -22 10 Z" fill={hairColor} />
            <rect x="47" y="6" width="6" height="14" rx="3" fill={hairColor} />
            <circle cx="50" cy="6" r="4" fill={hairColor} />
          </>
        )}

        {/* hat (over hair) */}
        {hat === 1 && (
          <>
            <path d="M26 34 q24 -22 48 0 Z" fill={accent} />
            <rect x="24" y="32" width="52" height="6" rx="3" fill={darken(accent, 0.25)} />
          </>
        )}
        {hat === 2 && (
          <>
            <path d="M28 32 q22 -18 44 0 v-2 a22 18 0 0 0 -44 0 Z" fill="#111827" />
            <ellipse cx="50" cy="33" rx="30" ry="5" fill="#111827" />
          </>
        )}
        {hat === 3 && (
          <>
            <path d="M30 30 q20 -20 40 0 l-2 4 q-18 -12 -36 0 Z" fill={clothes} />
            <circle cx="50" cy="10" r="4" fill="#ffffff" />
          </>
        )}

        {/* headphones */}
        {headphones >= 1 && (
          <>
            <path d="M26 44 a24 24 0 0 1 48 0" stroke={headphones === 2 ? accent : '#1f2937'} strokeWidth="3.5" fill="none" />
            <rect x="22" y="42" width="8" height="14" rx="4" fill={headphones === 2 ? accent : '#1f2937'} />
            <rect x="70" y="42" width="8" height="14" rx="4" fill={headphones === 2 ? accent : '#1f2937'} />
          </>
        )}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------ small pieces */

function XpRing({
  pct,
  level,
  size = 84,
}: {
  pct: number;
  level: number;
  size?: number;
}) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-black/5"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#xp-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: circ - (circ * clamped) / 100 }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
        />
        <defs>
          <linearGradient id="xp-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" />
            <stop offset="50%" stopColor="hsl(var(--violet))" />
            <stop offset="100%" stopColor="hsl(var(--pink))" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-lg font-bold leading-none tabular-nums">
          {level}
        </span>
        <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
          Level
        </span>
      </div>
    </div>
  );
}

function StatChip({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Trophy;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-black/5 bg-white/60 px-3 py-2 backdrop-blur">
      <Icon className={cn('h-4 w-4 shrink-0', accent ?? 'text-primary')} />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="truncate text-sm font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- PlayerCard */

const STATUS_DOT: Record<string, string> = {
  Online: 'bg-emerald',
  Away: 'bg-gold',
  Busy: 'bg-destructive',
  Offline: 'bg-muted-foreground',
};

export function PlayerCard({ className }: { className?: string }) {
  const p = usePlayerProfile();

  const banner = cosmeticById(p.equippedBanner);
  const frame = cosmeticById(p.equippedFrame);
  const title = cosmeticById(p.equippedTitle);

  const bannerGradient = banner?.gradient ?? 'from-primary via-violet to-pink';
  const frameGradient = frame?.gradient ?? 'from-gold to-warning';
  const titleGradient = title?.gradient ?? 'from-primary to-accent';

  const xpPct = Math.min(100, Math.round((p.xp / Math.max(1, p.xpToNext)) * 100));
  const done = p.completion();
  const statusDot = STATUS_DOT[p.status] ?? 'bg-emerald';

  // deterministic particle positions
  const particles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        left: (i * 37) % 100,
        top: (i * 53) % 100,
        delay: (i % 7) * 0.4,
        dur: 3 + (i % 5),
        size: 2 + (i % 3),
      })),
    [],
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      whileHover={{ y: -4 }}
      className={cn(
        'card-premium group relative overflow-hidden transition-shadow duration-300 hover:shadow-glow',
        className,
      )}
    >
      {/* ---------------- Banner header ---------------- */}
      <div
        className={cn(
          'bg-grid relative h-36 w-full overflow-hidden bg-gradient-to-br sm:h-40',
          bannerGradient,
        )}
      >
        <div className="absolute inset-0 bg-black/10" />
        {/* floating particles */}
        {particles.map((pt, i) => (
          <motion.span
            key={i}
            className="absolute rounded-full bg-white/70"
            style={{
              left: `${pt.left}%`,
              top: `${pt.top}%`,
              width: pt.size,
              height: pt.size,
            }}
            animate={{ y: [0, -14, 0], opacity: [0.2, 0.9, 0.2] }}
            transition={{
              duration: pt.dur,
              delay: pt.delay,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        ))}
        {/* sheen sweep intensifies on hover */}
        <div className="absolute -inset-x-10 -top-10 h-24 rotate-12 bg-white/20 blur-2xl transition-opacity duration-500 group-hover:opacity-80" />

        {/* banner meta: season + status */}
        <div className="absolute right-4 top-4 flex items-center gap-2">
          <Badge variant="gold" className="shadow-glow-gold">
            <Trophy className="mr-1 h-3 w-3" /> Tier {p.seasonTier}
          </Badge>
        </div>
        <div className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
          <span className={cn('h-2 w-2 rounded-full', statusDot)} />
          {p.status}
        </div>
      </div>

      {/* ---------------- Body ---------------- */}
      <div className="relative px-5 pb-6 sm:px-7">
        {/* Avatar + frame (overlaps banner) */}
        <div className="-mt-14 flex flex-col items-center gap-4 sm:flex-row sm:items-end">
          <motion.div
            whileHover={{ scale: 1.04, rotate: -1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="relative shrink-0"
          >
            <div
              className={cn(
                'rounded-full bg-gradient-to-br p-[3px] shadow-glow',
                frameGradient,
              )}
            >
              <div className="rounded-full bg-white p-1">
                <PlayerAvatar config={p.avatar} size={104} />
              </div>
            </div>
            {/* frame glow ring on hover */}
            <div
              className={cn(
                'pointer-events-none absolute -inset-1 rounded-full bg-gradient-to-br opacity-0 blur-md transition-opacity duration-300 group-hover:opacity-60',
                frameGradient,
              )}
            />
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-primary to-violet px-2.5 py-0.5 text-[11px] font-bold text-white shadow-glow">
              LVL {p.level}
            </span>
          </motion.div>

          {/* name / title / id */}
          <div className="min-w-0 flex-1 pb-1 text-center sm:pb-2 sm:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <h1 className="font-display text-2xl font-bold sm:text-3xl">
                {p.username}
              </h1>
              <span className="text-xl" title="Country">
                {p.country}
              </span>
              {p.clan && (
                <Badge variant="neon" className="font-mono">
                  [{p.clan.tag}]
                </Badge>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <span
                className={cn(
                  'bg-gradient-to-r bg-clip-text font-display text-sm font-bold text-transparent',
                  titleGradient,
                )}
              >
                {title?.name ?? 'Rookie'}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {p.playerId}
              </span>
            </div>
          </div>

          {/* XP ring */}
          <div className="flex shrink-0 flex-col items-center gap-1 pb-1">
            <XpRing pct={xpPct} level={p.level} />
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {p.xp.toLocaleString('en-US')} / {p.xpToNext.toLocaleString('en-US')} XP
            </span>
          </div>
        </div>

        {/* stat chips */}
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <StatChip
            icon={Trophy}
            label="Season"
            value={`Tier ${p.seasonTier}`}
            accent="text-gold"
          />
          <StatChip
            icon={Gamepad2}
            label="Favorite"
            value={p.favoriteGame}
            accent="text-accent"
          />
          <StatChip
            icon={Users}
            label="Clan"
            value={p.clan ? p.clan.name : 'No clan'}
            accent="text-violet"
          />
          <StatChip
            icon={Clock}
            label="Play time"
            value={formatPlayTime(p.playMinutes)}
            accent="text-primary"
          />
          <StatChip
            icon={Zap}
            label="Level"
            value={`${p.level}`}
            accent="text-pink"
          />
          <StatChip
            icon={Shield}
            label="Frame"
            value={frame?.name ?? 'Bronze'}
            accent="text-emerald"
          />
          <StatChip
            icon={Crown}
            label="Joined"
            value={`${p.joinedDays}d ago`}
            accent="text-gold"
          />
          <StatChip
            icon={MapPin}
            label="Region"
            value={p.country}
            accent="text-accent"
          />
        </div>

        {/* profile completion */}
        <div className="mt-5">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-semibold text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-violet" /> Profile completion
            </span>
            <span className="font-mono font-bold tabular-nums text-gradient">
              {done}%
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-black/5">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${done}%` }}
              transition={{ duration: 1.1, ease: 'easeOut' }}
              className="h-full rounded-full bg-gradient-to-r from-accent via-primary to-pink shadow-glow-sm"
            />
          </div>
        </div>
      </div>
    </motion.section>
  );
}
