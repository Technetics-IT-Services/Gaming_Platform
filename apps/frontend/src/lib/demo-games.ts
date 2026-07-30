/**
 * Deterministic demo game catalog.
 *
 * Produces valid `GameSummary[]` purely from a seed (no `Date.now()` /
 * `Math.random()`), so pages are never empty when the backend isn't reachable
 * (demo mode) and SSR/client agree with no hydration drift. Thumbnails are left
 * null on purpose so the existing `GameCover` generates premium cover art.
 * Backend-free; original game/provider names (not copied from real brands).
 */

import type { GameDetail, GameSummary } from '@gaming-platform/types';

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(arr: readonly T[], n: number): T {
  return arr[n % arr.length]!;
}

const PROVIDERS = [
  { code: 'nova', name: 'Nova Gaming' },
  { code: 'prism', name: 'Prism Studios' },
  { code: 'aurora', name: 'Aurora Play' },
  { code: 'zenith', name: 'Zenith Labs' },
  { code: 'lumen', name: 'Lumen Interactive' },
  { code: 'vortex', name: 'Vortex Games' },
  { code: 'quantum', name: 'Quantum Arcade' },
  { code: 'orbit', name: 'Orbit Originals' },
] as const;

interface Seed {
  name: string;
  category: { slug: string; name: string };
  tags: string[];
}

const CAT = {
  slots: { slug: 'slots', name: 'Slots' },
  crash: { slug: 'crash', name: 'Crash' },
  dice: { slug: 'dice', name: 'Dice' },
  roulette: { slug: 'roulette', name: 'Roulette' },
  cards: { slug: 'cards', name: 'Card Games' },
  live: { slug: 'live', name: 'Live Dealer' },
  arcade: { slug: 'arcade', name: 'Arcade' },
  instant: { slug: 'instant', name: 'Instant Win' },
  sports: { slug: 'sports', name: 'Sports' },
} as const;

/** Original, on-theme catalog — enough variety to fill every shelf. */
const CATALOG: Seed[] = [
  { name: 'Neon Rush', category: CAT.slots, tags: ['neon', 'megaways'] },
  { name: 'Golden Pharaoh', category: CAT.slots, tags: ['egypt', 'jackpot'] },
  { name: 'Cosmic Fortune', category: CAT.slots, tags: ['space', 'bonus'] },
  { name: 'Dragon Gold', category: CAT.slots, tags: ['dragon', 'asia'] },
  { name: 'Fruit Blast', category: CAT.slots, tags: ['classic', 'fruit'] },
  { name: 'Pirate Treasure', category: CAT.slots, tags: ['pirate', 'adventure'] },
  { name: 'Wild Safari', category: CAT.slots, tags: ['animals', 'wild'] },
  { name: 'Crystal Caverns', category: CAT.slots, tags: ['gems', 'cascade'] },
  { name: 'Rocket Riot', category: CAT.crash, tags: ['crash', 'multiplier'] },
  { name: 'Skyfall Crash', category: CAT.crash, tags: ['crash', 'fast'] },
  { name: 'Moon Launch', category: CAT.crash, tags: ['crash', 'space'] },
  { name: 'Turbo Ascent', category: CAT.crash, tags: ['crash', 'turbo'] },
  { name: 'Lucky Dice', category: CAT.dice, tags: ['dice', 'classic'] },
  { name: 'Sic Bo Royale', category: CAT.dice, tags: ['dice', 'asia'] },
  { name: 'Triple Sevens', category: CAT.dice, tags: ['dice', 'lucky'] },
  { name: 'European Roulette', category: CAT.roulette, tags: ['roulette', 'classic'] },
  { name: 'Lightning Roulette', category: CAT.roulette, tags: ['roulette', 'live'] },
  { name: 'VIP Roulette', category: CAT.roulette, tags: ['roulette', 'vip'] },
  { name: 'Teen Patti Gold', category: CAT.cards, tags: ['cards', 'india'] },
  { name: 'Dragon Tiger', category: CAT.cards, tags: ['cards', 'live'] },
  { name: 'Blackjack Pro', category: CAT.cards, tags: ['cards', 'blackjack'] },
  { name: 'Baccarat Deluxe', category: CAT.cards, tags: ['cards', 'baccarat'] },
  { name: 'Andar Bahar', category: CAT.cards, tags: ['cards', 'india'] },
  { name: 'Live Casino Hold’em', category: CAT.live, tags: ['live', 'poker'] },
  { name: 'Speed Baccarat Live', category: CAT.live, tags: ['live', 'fast'] },
  { name: 'Mega Wheel Live', category: CAT.live, tags: ['live', 'wheel'] },
  { name: 'Crazy Coin Flip', category: CAT.live, tags: ['live', 'bonus'] },
  { name: 'Neon Breaker', category: CAT.arcade, tags: ['arcade', 'retro'] },
  { name: 'Pixel Dash', category: CAT.arcade, tags: ['arcade', 'runner'] },
  { name: 'Block Stack', category: CAT.arcade, tags: ['arcade', 'puzzle'] },
  { name: 'Color Match', category: CAT.arcade, tags: ['arcade', 'casual'] },
  { name: 'Memory Grid', category: CAT.arcade, tags: ['arcade', 'brain'] },
  { name: 'Reaction Rush', category: CAT.arcade, tags: ['arcade', 'reflex'] },
  { name: 'Plinko Drop', category: CAT.instant, tags: ['instant', 'plinko'] },
  { name: 'Mines Master', category: CAT.instant, tags: ['instant', 'mines'] },
  { name: 'Keno Nights', category: CAT.instant, tags: ['instant', 'keno'] },
  { name: 'Scratch Gold', category: CAT.instant, tags: ['instant', 'scratch'] },
  { name: 'Penalty Shootout', category: CAT.sports, tags: ['sports', 'football'] },
  { name: 'Derby Sprint', category: CAT.sports, tags: ['sports', 'racing'] },
  { name: 'Slam Dunk Arena', category: CAT.sports, tags: ['sports', 'basketball'] },
  { name: 'Aviator X', category: CAT.crash, tags: ['crash', 'aviator'] },
  { name: 'Fortune Tiger', category: CAT.slots, tags: ['tiger', 'jackpot'] },
  { name: 'Sweet Bonanza', category: CAT.slots, tags: ['candy', 'tumble'] },
  { name: 'Gates of Olympus', category: CAT.slots, tags: ['greek', 'multiplier'] },
  // — PPP-7: named casino table titles so the lobby ordering resolves —
  { name: 'Teen Patti', category: CAT.cards, tags: ['cards', 'india', 'poker'] },
  { name: 'Poker', category: CAT.cards, tags: ['cards', 'poker'] },
  { name: 'Casino Hold’em', category: CAT.cards, tags: ['cards', 'poker', 'holdem'] },
  { name: 'Blackjack', category: CAT.cards, tags: ['cards', 'blackjack'] },
  { name: 'Live Teen Patti', category: CAT.live, tags: ['live', 'india', 'poker'] },
  { name: 'Live Andar Bahar', category: CAT.live, tags: ['live', 'india'] },
  { name: 'Live Blackjack', category: CAT.live, tags: ['live', 'blackjack'] },
  { name: 'Live Casino', category: CAT.live, tags: ['live', 'lobby'] },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Build one deterministic GameSummary for a catalog entry + seed. */
function toSummary(seed: Seed, index: number, key: string): GameSummary {
  const h = hash(`demo-${key}-${seed.name}`);
  const provider = pick(PROVIDERS, h);
  const ratingCount = 40 + (h % 4000);
  return {
    id: `demo-${slugify(seed.name)}`,
    slug: slugify(seed.name),
    name: seed.name,
    thumbnailUrl: null,
    bannerUrl: null,
    category: seed.category,
    provider: { code: provider.code, name: provider.name },
    tags: seed.tags,
    ageRating: '18+',
    status: 'published',
    visibility: 'public',
    isNew: h % 5 === 0,
    isFeatured: h % 7 === 0,
    isTrending: h % 4 === 0,
    maintenanceMode: false,
    ratingAverage: Number((3.9 + (h % 110) / 100).toFixed(1)),
    ratingCount,
    popularityScore: 1000 - index * 7 + (h % 300),
    rtp: Number((95 + (h % 400) / 100).toFixed(2)),
  };
}

/** A deterministic slice of the catalog, rotated by seed. */
export function demoGames(key: string, count = 12): GameSummary[] {
  const start = hash(key) % CATALOG.length;
  return Array.from({ length: Math.min(count, CATALOG.length) }, (_, i) => {
    const entry = pick(CATALOG, start + i);
    return toSummary(entry, i, key);
  });
}

/** Deterministic games filtered to a category (falls back to the full pool). */
export function demoGamesByCategory(categorySlug: string, count = 12): GameSummary[] {
  const matches = CATALOG.filter((c) => c.category.slug === categorySlug);
  const pool = matches.length >= 4 ? matches : CATALOG;
  const start = hash(`cat-${categorySlug}`) % pool.length;
  return Array.from({ length: Math.min(count, pool.length) }, (_, i) => {
    const entry = pick(pool, start + i);
    return toSummary(entry, i, `cat-${categorySlug}`);
  });
}

/* ------------------------------------------------------------------ */
/* Slug registry — every card links to /games/[slug] which must resolve */
/* ------------------------------------------------------------------ */

const BY_SLUG = new Map<string, Seed>(CATALOG.map((s) => [slugify(s.name), s] as const));

/** Maps a game category to the runtime engine that can play it. */
const CATEGORY_ENGINE: Record<string, string> = {
  crash: 'crash-engine',
  dice: 'dice-engine',
  roulette: 'roulette-engine',
  cards: 'card-engine',
  live: 'card-engine',
  sports: 'sports-engine',
  slots: 'dice-engine',
  arcade: 'dice-engine',
  instant: 'dice-engine',
};

/** The runtime engine key for a demo slug (falls back to the dice engine). */
export function demoLauncherFor(slug: string): string {
  const s = BY_SLUG.get(slug);
  return (s && CATEGORY_ENGINE[s.category.slug]) || 'dice-engine';
}

/** Categories that play in the presentation-only Slot/Instant demo (no engine). */
const SLOT_EXPERIENCE = new Set(['slots', 'instant', 'arcade']);

/** True when a demo slug should open the animated Slot/Instant demo experience. */
export function isSlotExperience(slug: string): boolean {
  const s = BY_SLUG.get(slug);
  return !!s && SLOT_EXPERIENCE.has(s.category.slug);
}

/** The catalog category slug for a demo slug (undefined if unknown). */
export function demoCategoryFor(slug: string): string | undefined {
  return BY_SLUG.get(slug)?.category.slug;
}

/** Every slug the demo catalog can produce — used by routing self-validation. */
export function allDemoSlugs(): string[] {
  return Array.from(BY_SLUG.keys());
}

/** A demo summary for a known slug (undefined if the slug is not in the catalog). */
export function demoGameBySlug(slug: string): GameSummary | undefined {
  const s = BY_SLUG.get(slug);
  return s ? toSummary(s, 0, 'detail') : undefined;
}

const VOLATILITY = ['Low', 'Medium', 'High'] as const;

/**
 * A full, deterministic `GameDetail` for ANY slug — known slugs resolve to their
 * catalog entry, unknown slugs fall back to the featured game. Never fails, so
 * `/games/[slug]` never shows "Game not found".
 */
export function demoGameDetail(slug: string): GameDetail {
  const seed = BY_SLUG.get(slug) ?? CATALOG[0]!;
  const summary = toSummary(seed, 0, 'detail');
  const h = hash(`detail-${slug}`);
  const engine = CATEGORY_ENGINE[seed.category.slug] ?? 'dice-engine';
  return {
    ...summary,
    slug,
    description: `Dive into ${seed.name} — a premium ${seed.category.name.toLowerCase()} experience with immersive visuals, provably-fair rounds and rewarding gameplay. Play instantly in demo mode with free coins.`,
    volatility: pick(VOLATILITY, h),
    minBet: '0.10',
    maxBet: '1,000.00',
    supportedDevices: ['web', 'mobile', 'tablet'],
    supportedLanguages: ['en'],
    supportedCurrencies: ['USD'],
    seo: { title: seed.name, description: null, keywords: seed.tags },
    launch: { type: 'html5', launcherKey: engine, url: null, deepLink: null, routePath: `/play/${slug}` },
    releaseNotes: null,
    releaseDate: null,
    assets: [],
    versions: [],
  };
}

/* ------------------------------------------------------------------ */
/* Casino vs Games classification + ordered lobby sections (PPP-7)      */
/* ------------------------------------------------------------------ */

/** Categories that belong in the Casino lobby (gambling titles). */
const CASINO_CATEGORIES = new Set(['cards', 'live', 'roulette', 'slots', 'crash', 'dice', 'instant']);
/** Categories that belong ONLY in the Games library (non-casino). */
const NON_CASINO_CATEGORIES = new Set(['arcade', 'sports']);

/** True when a category slug is a casino category. */
export function isCasinoCategory(categorySlug: string): boolean {
  return CASINO_CATEGORIES.has(categorySlug);
}

/** True when a summary is a casino game (not arcade / sports / casual). */
export function isCasinoGame(g: GameSummary): boolean {
  const c = g.category?.slug ?? '';
  return !NON_CASINO_CATEGORIES.has(c) && isCasinoCategory(c);
}

/** True when a slug is a casino title (used by the independent casino routes). */
export function isCasinoSlug(slug: string): boolean {
  const s = BY_SLUG.get(slug);
  return !!s && CASINO_CATEGORIES.has(s.category.slug);
}

/**
 * Registry view: every CASINO title only (cards/live/roulette/slots/crash/dice/
 * instant). Casino components read this — never arcade/casual titles.
 */
export function casinoGames(): GameSummary[] {
  return CATALOG.filter((s) => CASINO_CATEGORIES.has(s.category.slug)).map((s, i) =>
    toSummary(s, i, 'casino-registry'),
  );
}

/** Registry view: the COMPLETE game library (casino + arcade + casual). */
export function gameLibrary(): GameSummary[] {
  return CATALOG.map((s, i) => toSummary(s, i, 'library-registry'));
}

/** Build ordered summaries from an explicit slug list (skips unknown slugs). */
export function demoGamesBySlugs(slugs: string[], key = 'casino'): GameSummary[] {
  const out: GameSummary[] = [];
  slugs.forEach((slug, i) => {
    const seed = BY_SLUG.get(slug);
    if (seed) out.push({ ...toSummary(seed, i, `${key}-${slug}`), slug });
  });
  return out;
}

/**
 * Curated, ordered casino lobby sections — table games first, slots after.
 * Every slug here exists in CATALOG (validated by the routing spec).
 */
export const CASINO_SECTIONS = {
  popularTables: [
    'teen-patti-gold', 'teen-patti', 'andar-bahar', 'dragon-tiger', 'baccarat-deluxe',
    'blackjack', 'blackjack-pro', 'european-roulette', 'lightning-roulette', 'poker',
    'casino-holdem', 'sic-bo-royale',
  ],
  liveCasino: [
    'live-teen-patti', 'live-andar-bahar', 'live-casino-holdem', 'speed-baccarat-live',
    'live-blackjack', 'mega-wheel-live', 'crazy-coin-flip', 'live-casino',
  ],
  slots: [
    'golden-pharaoh', 'dragon-gold', 'fruit-blast', 'wild-safari', 'pirate-treasure',
    'cosmic-fortune', 'neon-rush', 'crystal-caverns', 'fortune-tiger', 'sweet-bonanza',
    'gates-of-olympus', 'lucky-dice',
  ],
  featured: [
    'teen-patti-gold', 'golden-pharaoh', 'european-roulette', 'dragon-tiger', 'rocket-riot',
    'blackjack-pro', 'sweet-bonanza', 'mega-wheel-live', 'andar-bahar', 'gates-of-olympus',
    'baccarat-deluxe', 'lightning-roulette',
  ],
  jackpots: [
    'golden-pharaoh', 'fortune-tiger', 'gates-of-olympus', 'dragon-gold', 'cosmic-fortune',
    'sweet-bonanza', 'pirate-treasure', 'wild-safari',
  ],
} as const;

/* ------------------------------------------------------------------ */
/* Play experience resolver — every slug maps to a self-contained,      */
/* backend-free playable component (no runtime/websocket required).     */
/* ------------------------------------------------------------------ */

/** Which self-contained card prototype a card/live slug plays in. */
const CARD_PROTO: Record<string, string> = {
  'teen-patti-gold': 'teen-patti', 'teen-patti': 'teen-patti', 'live-teen-patti': 'teen-patti',
  'three-card-poker': 'teen-patti', 'poker-showdown': 'teen-patti',
  poker: 'teen-patti', 'casino-holdem': 'teen-patti', 'live-casino-holdem': 'teen-patti',
  'andar-bahar': 'andar-bahar', 'live-andar-bahar': 'andar-bahar',
  'dragon-tiger': 'dragon-tiger',
  'baccarat-deluxe': 'baccarat', 'speed-baccarat-live': 'baccarat', 'lucky-nine': 'baccarat',
  blackjack: 'blackjack', 'blackjack-pro': 'blackjack', 'live-blackjack': 'blackjack',
  'casino-war': 'casino-war', 'crazy-coin-flip': 'casino-war',
  'lucky-7': 'lucky-7', 'hi-lo': 'lucky-7', 'red-dog': 'lucky-7', 'thirty-two-cards': 'lucky-7',
};

export type CardProto =
  | 'teen-patti' | 'andar-bahar' | 'dragon-tiger' | 'baccarat' | 'blackjack' | 'casino-war' | 'lucky-7';

/** Phase 4/4B instant games with a bespoke UI. Unmapped instant slugs fall
 * through to the generic slot demo. */
export type InstantProto =
  | 'limbo' | 'coin-flip' | 'wheel' | 'mines' | 'bomb-hunt' | 'tower' | 'keno' | 'bingo' | 'lucky-pick';
const INSTANT_PROTO: Record<string, InstantProto> = {
  limbo: 'limbo',
  'coin-flip': 'coin-flip', 'coinflip': 'coin-flip',
  wheel: 'wheel', 'lucky-wheel': 'wheel', 'wheel-of-fortune': 'wheel',
  mines: 'mines', minesweeper: 'mines',
  'bomb-hunt': 'bomb-hunt', bombs: 'bomb-hunt',
  tower: 'tower', towers: 'tower', 'dragon-tower': 'tower',
  keno: 'keno',
  bingo: 'bingo',
  'lucky-pick': 'lucky-pick', 'lucky-box': 'lucky-pick',
};

export type DemoExperience =
  | { kind: 'card'; game: CardProto }
  | { kind: 'instant'; game: InstantProto }
  | { kind: 'crash' }
  | { kind: 'dice' }
  | { kind: 'roulette' }
  | { kind: 'slot' };

/** Map a raw category / engine key to a base experience. */
function categoryExperience(category: string | undefined): DemoExperience {
  switch (category) {
    case 'crash':
    case 'crash-engine':
      return { kind: 'crash' };
    case 'dice':
    case 'dice-engine':
      return { kind: 'dice' };
    case 'roulette':
    case 'roulette-engine':
      return { kind: 'roulette' };
    case 'cards':
    case 'card-engine':
      return { kind: 'card', game: 'blackjack' };
    default:
      // slots / instant / arcade / live-wheel / sports / lottery → slot demo
      return { kind: 'slot' };
  }
}

/**
 * Resolve ANY slug (catalog slug, card-table variant, or engine key) to a
 * self-contained, backend-free experience. Never throws; unknown → slot demo.
 */
export function demoExperienceFor(slug: string): DemoExperience {
  const instant = INSTANT_PROTO[slug];
  if (instant) return { kind: 'instant', game: instant };
  const proto = CARD_PROTO[slug];
  if (proto) return { kind: 'card', game: proto as CardProto };
  const seed = BY_SLUG.get(slug);
  return categoryExperience(seed?.category.slug ?? slug);
}

/** Deterministic "related" games — casino games recommend casino games. */
export function relatedDemoGames(slug: string, count = 12): GameSummary[] {
  const seed = BY_SLUG.get(slug);
  if (seed && isCasinoCategory(seed.category.slug)) {
    const pool = demoGamesBySlugs(
      [...CASINO_SECTIONS.popularTables, ...CASINO_SECTIONS.liveCasino, ...CASINO_SECTIONS.slots],
      'related',
    );
    const seen = new Set<string>();
    return pool.filter((g) => g.slug !== slug && !seen.has(g.slug) && seen.add(g.slug)).slice(0, count);
  }
  const pool = seed ? demoGamesByCategory(seed.category.slug, count + 4) : demoGames('related', count + 4);
  return pool.filter((g) => g.slug !== slug).slice(0, count);
}

/* ------------------------------------------------------------------ */
/* Demo-mode search (registry-backed, casino-first) — Objectives 5, 11  */
/* ------------------------------------------------------------------ */

interface DemoSearchOpts {
  search?: string;
  category?: string;
  provider?: string;
  sort?: string;
}

/** Filter/sort the catalog entirely client-side; casino games rank first. */
export function demoSearch(opts: DemoSearchOpts = {}): GameSummary[] {
  let items = CATALOG.map((s, i) => toSummary(s, i, 'search'));
  if (opts.category) items = items.filter((g) => g.category?.slug === opts.category);
  if (opts.provider) items = items.filter((g) => g.provider?.code === opts.provider);
  const q = opts.search?.trim().toLowerCase();
  if (q) {
    items = items.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.category?.name.toLowerCase().includes(q) ?? false) ||
        (g.provider?.name.toLowerCase().includes(q) ?? false) ||
        g.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }
  const cmp: Record<string, (a: GameSummary, b: GameSummary) => number> = {
    name: (a, b) => a.name.localeCompare(b.name),
    rating: (a, b) => b.ratingAverage - a.ratingAverage,
    newest: (a, b) => Number(b.isNew) - Number(a.isNew),
    trending: (a, b) => Number(b.isTrending) - Number(a.isTrending),
    popular: (a, b) => b.popularityScore - a.popularityScore,
  };
  const tiebreak = cmp[opts.sort ?? 'popular'] ?? cmp.popular!;
  // Casino games first (Objective 11), then the chosen sort.
  return items.sort((a, b) => Number(isCasinoGame(b)) - Number(isCasinoGame(a)) || tiebreak(a, b));
}
