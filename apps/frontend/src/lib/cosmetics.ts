/**
 * Cosmetics catalog for the player-identity systems (store, marketplace, avatar
 * studio, profile customization). Deterministic, prototype-only — purchases use
 * demo coins and never touch the backend.
 */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type CosmeticCategory =
  | 'frame'
  | 'theme'
  | 'title'
  | 'banner'
  | 'particle'
  | 'cursor'
  | 'music'
  | 'diceSkin'
  | 'chip'
  | 'cardBack';

export interface Cosmetic {
  id: string;
  name: string;
  category: CosmeticCategory;
  rarity: Rarity;
  price: number;
  /** Tailwind gradient (e.g. 'from-x to-y') used for previews/equipped styling. */
  gradient: string;
  /** lucide icon name for the tile. */
  icon: string;
  /** Owned by default (starter cosmetics). */
  starter?: boolean;
}

export const RARITY_RING: Record<Rarity, string> = {
  common: 'ring-muted-foreground/40',
  rare: 'ring-accent/60',
  epic: 'ring-violet/60',
  legendary: 'ring-gold/70',
};
export const RARITY_TEXT: Record<Rarity, string> = {
  common: 'text-muted-foreground',
  rare: 'text-accent',
  epic: 'text-violet',
  legendary: 'text-gold',
};

/* ---- Profile Frames ------------------------------------------------------ */
export const FRAMES: Cosmetic[] = [
  { id: 'frame-bronze', name: 'Bronze', category: 'frame', rarity: 'common', price: 0, gradient: 'from-amber-800 to-amber-700', icon: 'Shield', starter: true },
  { id: 'frame-silver', name: 'Silver', category: 'frame', rarity: 'common', price: 2500, gradient: 'from-slate-600 to-slate-500', icon: 'Shield' },
  { id: 'frame-gold', name: 'Gold', category: 'frame', rarity: 'rare', price: 8000, gradient: 'from-gold to-warning', icon: 'Shield' },
  { id: 'frame-diamond', name: 'Diamond', category: 'frame', rarity: 'epic', price: 20000, gradient: 'from-accent to-primary', icon: 'Gem' },
  { id: 'frame-master', name: 'Master', category: 'frame', rarity: 'epic', price: 35000, gradient: 'from-violet to-pink', icon: 'Crown' },
  { id: 'frame-legendary', name: 'Legendary', category: 'frame', rarity: 'legendary', price: 75000, gradient: 'from-gold via-pink to-violet', icon: 'Sparkles' },
];

/* ---- Profile Themes ------------------------------------------------------ */
export const THEMES: Cosmetic[] = [
  { id: 'theme-neon', name: 'Neon', category: 'theme', rarity: 'common', price: 0, gradient: 'from-primary via-violet to-pink', icon: 'Zap', starter: true },
  { id: 'theme-cyberpunk', name: 'Cyberpunk', category: 'theme', rarity: 'rare', price: 6000, gradient: 'from-pink via-primary to-accent', icon: 'Cpu' },
  { id: 'theme-galaxy', name: 'Galaxy', category: 'theme', rarity: 'epic', price: 12000, gradient: 'from-violet via-primary to-accent', icon: 'Sparkles' },
  { id: 'theme-casino', name: 'Casino', category: 'theme', rarity: 'rare', price: 6000, gradient: 'from-gold via-warning to-pink', icon: 'Diamond' },
  { id: 'theme-sports', name: 'Sports', category: 'theme', rarity: 'rare', price: 6000, gradient: 'from-emerald via-accent to-primary', icon: 'Trophy' },
  { id: 'theme-retro', name: 'Retro Arcade', category: 'theme', rarity: 'epic', price: 10000, gradient: 'from-pink via-gold to-accent', icon: 'Gamepad2' },
  { id: 'theme-future', name: 'Future', category: 'theme', rarity: 'epic', price: 12000, gradient: 'from-accent via-primary to-violet', icon: 'Rocket' },
  { id: 'theme-anime', name: 'Anime', category: 'theme', rarity: 'rare', price: 8000, gradient: 'from-pink via-violet to-accent', icon: 'Star' },
  { id: 'theme-ocean', name: 'Ocean', category: 'theme', rarity: 'common', price: 4000, gradient: 'from-accent via-blue-700 to-primary', icon: 'Waves' },
  { id: 'theme-forest', name: 'Forest', category: 'theme', rarity: 'common', price: 4000, gradient: 'from-emerald via-green-700 to-accent', icon: 'Trees' },
  { id: 'theme-space', name: 'Space', category: 'theme', rarity: 'legendary', price: 30000, gradient: 'from-violet via-indigo-500 to-primary', icon: 'Orbit' },
];

/* ---- Titles -------------------------------------------------------------- */
export const TITLES: Cosmetic[] = [
  { id: 'title-rookie', name: 'Rookie', category: 'title', rarity: 'common', price: 0, gradient: 'from-muted-foreground to-muted-foreground', icon: 'User', starter: true },
  { id: 'title-champion', name: 'Champion', category: 'title', rarity: 'legendary', price: 40000, gradient: 'from-gold to-warning', icon: 'Trophy' },
  { id: 'title-lucky', name: 'Lucky Player', category: 'title', rarity: 'rare', price: 5000, gradient: 'from-emerald to-accent', icon: 'Clover' },
  { id: 'title-crash-king', name: 'Crash King', category: 'title', rarity: 'epic', price: 15000, gradient: 'from-pink to-violet', icon: 'Rocket' },
  { id: 'title-dice-master', name: 'Dice Master', category: 'title', rarity: 'epic', price: 15000, gradient: 'from-primary to-accent', icon: 'Dice5' },
  { id: 'title-roulette-legend', name: 'Roulette Legend', category: 'title', rarity: 'epic', price: 15000, gradient: 'from-destructive to-warning', icon: 'CircleDot' },
  { id: 'title-hero', name: 'Tournament Hero', category: 'title', rarity: 'legendary', price: 45000, gradient: 'from-gold via-pink to-violet', icon: 'Medal' },
  { id: 'title-collector', name: 'Collector', category: 'title', rarity: 'rare', price: 8000, gradient: 'from-violet to-accent', icon: 'Package' },
  { id: 'title-explorer', name: 'Explorer', category: 'title', rarity: 'rare', price: 8000, gradient: 'from-accent to-emerald', icon: 'Compass' },
  { id: 'title-veteran', name: 'Veteran', category: 'title', rarity: 'epic', price: 18000, gradient: 'from-primary to-violet', icon: 'ShieldCheck' },
];

/* ---- Banners ------------------------------------------------------------- */
export const BANNERS: Cosmetic[] = [
  { id: 'banner-default', name: 'Aurora', category: 'banner', rarity: 'common', price: 0, gradient: 'from-primary via-violet to-pink', icon: 'Image', starter: true },
  { id: 'banner-neon', name: 'Neon Grid', category: 'banner', rarity: 'rare', price: 5000, gradient: 'from-accent via-primary to-pink', icon: 'Grid3x3' },
  { id: 'banner-gold', name: 'Golden Hour', category: 'banner', rarity: 'epic', price: 14000, gradient: 'from-gold via-warning to-pink', icon: 'Sunrise' },
  { id: 'banner-galaxy', name: 'Galaxy', category: 'banner', rarity: 'epic', price: 16000, gradient: 'from-violet via-primary to-accent', icon: 'Sparkles' },
  { id: 'banner-legendary', name: 'Season Legend', category: 'banner', rarity: 'legendary', price: 50000, gradient: 'from-gold via-pink to-violet', icon: 'Flame' },
];

/* ---- Extra store items (particles/cursors/music/skins/chips/cards) ------- */
export const EXTRAS: Cosmetic[] = [
  { id: 'particle-sparks', name: 'Neon Sparks', category: 'particle', rarity: 'rare', price: 6000, gradient: 'from-accent to-primary', icon: 'Sparkles' },
  { id: 'particle-coins', name: 'Coin Rain', category: 'particle', rarity: 'epic', price: 12000, gradient: 'from-gold to-warning', icon: 'Coins' },
  { id: 'particle-stars', name: 'Starfall', category: 'particle', rarity: 'legendary', price: 28000, gradient: 'from-violet to-pink', icon: 'Star' },
  { id: 'cursor-glow', name: 'Glow Cursor', category: 'cursor', rarity: 'rare', price: 4000, gradient: 'from-primary to-accent', icon: 'MousePointer2' },
  { id: 'cursor-trail', name: 'Comet Trail', category: 'cursor', rarity: 'epic', price: 9000, gradient: 'from-pink to-violet', icon: 'MousePointer2' },
  { id: 'music-lounge', name: 'Lounge Pack', category: 'music', rarity: 'rare', price: 5000, gradient: 'from-accent to-emerald', icon: 'Music' },
  { id: 'music-synth', name: 'Synthwave Pack', category: 'music', rarity: 'epic', price: 11000, gradient: 'from-pink to-primary', icon: 'Music' },
  { id: 'dice-gold', name: 'Golden Dice', category: 'diceSkin', rarity: 'epic', price: 13000, gradient: 'from-gold to-warning', icon: 'Dice5' },
  { id: 'dice-neon', name: 'Neon Dice', category: 'diceSkin', rarity: 'rare', price: 7000, gradient: 'from-accent to-primary', icon: 'Dice5' },
  { id: 'chip-diamond', name: 'Diamond Chips', category: 'chip', rarity: 'legendary', price: 26000, gradient: 'from-accent to-primary', icon: 'CircleDollarSign' },
  { id: 'chip-royal', name: 'Royal Chips', category: 'chip', rarity: 'epic', price: 12000, gradient: 'from-violet to-pink', icon: 'CircleDollarSign' },
  { id: 'card-dragon', name: 'Dragon Card Back', category: 'cardBack', rarity: 'epic', price: 12000, gradient: 'from-destructive to-warning', icon: 'Spade' },
  { id: 'card-cyber', name: 'Cyber Card Back', category: 'cardBack', rarity: 'rare', price: 7000, gradient: 'from-primary to-accent', icon: 'Spade' },
];

export const ALL_COSMETICS: Cosmetic[] = [...FRAMES, ...THEMES, ...TITLES, ...BANNERS, ...EXTRAS];

export function cosmeticById(id: string): Cosmetic | undefined {
  return ALL_COSMETICS.find((c) => c.id === id);
}
export function cosmeticsByCategory(cat: CosmeticCategory): Cosmetic[] {
  return ALL_COSMETICS.filter((c) => c.category === cat);
}

/* ---- Avatar Studio parts ------------------------------------------------- */
export interface AvatarConfig {
  skin: number;
  hair: number;
  hairColor: number;
  eyes: number;
  brows: number;
  mouth: number;
  beard: number;
  hat: number;
  mask: number;
  headphones: number;
  clothes: number;
  clothesColor: number;
  background: number;
  accent: number; // RGB accent hue index
}

export const DEFAULT_AVATAR: AvatarConfig = {
  skin: 1, hair: 1, hairColor: 0, eyes: 1, brows: 0, mouth: 1, beard: 0,
  hat: 0, mask: 0, headphones: 0, clothes: 1, clothesColor: 0, background: 2, accent: 0,
};

export const SKIN_TONES = ['#f2d3b8', '#e5b892', '#c68642', '#8d5524', '#5a3a22', '#efc9b3'];
export const HAIR_COLORS = ['#1f1300', '#5a3210', '#a55b1e', '#d9a441', '#e2e2e2', '#7c3aed', '#22d3ee', '#ec4899'];
export const CLOTHES_COLORS = ['#7c3aed', '#22d3ee', '#ec4899', '#f59e0b', '#22c55e', '#ef4444', '#3b82f6', '#111827'];
export const ACCENT_HUES = [263, 190, 326, 38, 152, 210, 0, 280];
export const BG_GRADIENTS = [
  'from-primary to-violet', 'from-accent to-primary', 'from-pink to-violet', 'from-gold to-warning',
  'from-emerald to-accent', 'from-violet to-pink', 'from-primary to-emerald', 'from-destructive to-warning',
];

/** Options counts per part (how many variants the studio cycles through). */
export const AVATAR_OPTIONS = {
  skin: SKIN_TONES.length,
  hair: 6, // 0 = bald
  hairColor: HAIR_COLORS.length,
  eyes: 4,
  brows: 3,
  mouth: 4,
  beard: 4, // 0 = none
  hat: 4, // 0 = none
  mask: 3, // 0 = none
  headphones: 2, // 0 = none
  clothes: 4,
  clothesColor: CLOTHES_COLORS.length,
  background: BG_GRADIENTS.length,
  accent: ACCENT_HUES.length,
} as const;
