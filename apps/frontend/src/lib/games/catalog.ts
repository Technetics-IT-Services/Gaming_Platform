import { apiClient } from '../api-client';

/**
 * Canonical real-money game catalog (Phase 2C.8) — presentation/discovery metadata for the mobile
 * lobby. Availability (`enabled`/`maintenance`) and `limits` are SERVER-AUTHORITATIVE (from
 * `GET /catalog`); this module supplies the client presentation layer (icons, categories, copy) and a
 * static fallback so the lobby still renders if the endpoint is briefly unavailable. It contains NO
 * payout/RTP mathematics and never decides whether money moves — the per-game `config`/`play`
 * endpoints remain the authority. This path does not use the demo wallet.
 */

export type CatalogCategory = 'instant' | 'table' | 'card' | 'crash' | 'dice';
export type BridgeType = 'dice' | 'crash' | 'roulette' | 'lottery' | 'card' | 'plinko' | 'mines' | 'instant';

export interface GameDefinition {
  key: string;
  slug: string;
  name: string;
  shortDescription: string;
  category: CatalogCategory;
  subcategory?: string;
  icon: string;
  route: string;
  status: 'live' | 'maintenance' | 'disabled';
  realMoney: boolean;
  multiplayer: boolean;
  popularity: number;
  difficulty: 'easy' | 'medium' | 'hard';
  mobileOptimized: boolean;
  minStake: number;
  maxStake: number;
  supportedCurrencies: string[];
  tags: string[];
  featured: boolean;
  isNew: boolean;
  responsibleGamingEligible: boolean;
  engineKey: string;
  bridgeType: BridgeType;
  sortOrder: number;
}

/** Client presentation defaults per game (icon, difficulty). Server owns availability + limits. */
const PRESENTATION: Record<string, { icon: string; difficulty: GameDefinition['difficulty'] }> = {
  dice: { icon: '🎲', difficulty: 'easy' },
  crash: { icon: '🚀', difficulty: 'medium' },
  roulette: { icon: '🎡', difficulty: 'easy' },
  'sic-bo': { icon: '🀄', difficulty: 'medium' },
  lottery: { icon: '🎱', difficulty: 'easy' },
  baccarat: { icon: '🃏', difficulty: 'easy' },
  blackjack: { icon: '♠️', difficulty: 'medium' },
  plinko: { icon: '🔻', difficulty: 'easy' },
  mines: { icon: '💎', difficulty: 'medium' },
  limbo: { icon: '📈', difficulty: 'easy' },
  'coin-flip': { icon: '🪙', difficulty: 'easy' },
  wheel: { icon: '🎯', difficulty: 'easy' },
  'dragon-tiger': { icon: '🐉', difficulty: 'easy' },
  'andar-bahar': { icon: '🎴', difficulty: 'easy' },
  'teen-patti': { icon: '🂡', difficulty: 'medium' },
};

/** The server catalog row (safe metadata). */
export interface CatalogGame {
  key: string;
  name: string;
  shortDescription: string;
  category: CatalogCategory;
  tags: string[];
  route: string;
  realMoney: true;
  multiplayer: boolean;
  engineKey: string;
  bridgeType: BridgeType;
  currencies: string[];
  popularity: number;
  isNew: boolean;
  featured: boolean;
  responsibleGamingEligible: true;
  sortOrder: number;
  enabled: boolean;
  maintenance: boolean;
  limits: { min: number; max: number };
}

/** Merge a server catalog row with client presentation into a full GameDefinition. */
export function toDefinition(g: CatalogGame): GameDefinition {
  const pres = PRESENTATION[g.key] ?? { icon: '🎮', difficulty: 'easy' as const };
  return {
    key: g.key,
    slug: g.key,
    name: g.name,
    shortDescription: g.shortDescription,
    category: g.category,
    icon: pres.icon,
    route: g.route,
    status: g.enabled ? 'live' : g.maintenance ? 'maintenance' : 'disabled',
    realMoney: g.realMoney,
    multiplayer: g.multiplayer,
    popularity: g.popularity,
    difficulty: pres.difficulty,
    mobileOptimized: true,
    minStake: g.limits.min,
    maxStake: g.limits.max,
    supportedCurrencies: g.currencies,
    tags: g.tags,
    featured: g.featured,
    isNew: g.isNew,
    responsibleGamingEligible: g.responsibleGamingEligible,
    engineKey: g.engineKey,
    bridgeType: g.bridgeType,
    sortOrder: g.sortOrder,
  };
}

/**
 * Static canonical list (presentation fallback + test source of truth). Mirrors the server catalog;
 * `status: 'live'` and default limits are placeholders overridden by the authoritative server values.
 */
export const CANONICAL_GAMES: GameDefinition[] = [
  fb('dice', 'Dice', 'Roll under/over a target', 'dice', ['popular', 'classic'], '/dice-money', false, 'dice', 'dice', 95, false, true, 10),
  fb('crash', 'Crash', 'Cash out before the crash', 'crash', ['popular', 'live'], '/crash-money', false, 'crash', 'crash', 98, false, true, 20),
  fb('roulette', 'Roulette', 'European single-zero wheel', 'table', ['popular', 'table'], '/roulette-money', false, 'roulette', 'roulette', 90, false, true, 30),
  fb('sic-bo', 'Sic Bo', 'Three-dice betting board', 'dice', ['table'], '/sic-bo-money', false, 'dice', 'dice', 70, false, false, 40),
  fb('lottery', 'Number Lottery', 'Pick numbers for the shared draw', 'instant', ['draw'], '/lottery-money', true, 'lottery', 'lottery', 65, false, false, 50),
  fb('baccarat', 'Baccarat', 'Player vs Banker point total', 'card', ['table', 'card'], '/baccarat-money', false, 'card', 'card', 80, false, false, 60),
  fb('blackjack', 'Blackjack', 'Beat the dealer to 21', 'card', ['popular', 'card'], '/blackjack-money', false, 'card', 'card', 92, false, true, 70),
  fb('plinko', 'Plinko', 'Drop the ball, hit a multiplier', 'instant', ['popular', 'arcade'], '/plinko-money', false, 'plinko', 'plinko', 94, false, true, 80),
  fb('mines', 'Mines', 'Reveal gems, dodge the mines', 'instant', ['popular', 'arcade'], '/mines-money', false, 'mines', 'mines', 93, false, true, 90),
  fb('limbo', 'Limbo', 'Beat your target multiplier', 'instant', ['new', 'instant'], '/limbo-money', false, 'limbo', 'instant', 60, true, false, 100),
  fb('coin-flip', 'Coin Flip', 'Call heads or tails', 'instant', ['new', 'instant'], '/coin-flip-money', false, 'coin-flip', 'instant', 55, true, false, 110),
  fb('wheel', 'Wheel', 'Spin for a segment multiplier', 'instant', ['new', 'instant'], '/wheel-money', false, 'wheel', 'instant', 58, true, false, 120),
  fb('dragon-tiger', 'Dragon Tiger', 'Higher card wins', 'card', ['new', 'india', 'card'], '/dragon-tiger-money', false, 'card', 'card', 75, true, true, 130),
  fb('andar-bahar', 'Andar Bahar', 'Pick the winning side', 'card', ['new', 'india', 'card'], '/andar-bahar-money', false, 'card', 'card', 78, true, true, 140),
  fb('teen-patti', 'Teen Patti', 'Player vs dealer, best 3-card hand', 'card', ['new', 'india', 'card'], '/teen-patti-money', false, 'card', 'card', 85, true, true, 150),
];

function fb(key: string, name: string, desc: string, category: CatalogCategory, tags: string[], route: string, multiplayer: boolean, engineKey: string, bridgeType: BridgeType, popularity: number, isNew: boolean, featured: boolean, sortOrder: number): GameDefinition {
  const pres = PRESENTATION[key] ?? { icon: '🎮', difficulty: 'easy' as const };
  return {
    key, slug: key, name, shortDescription: desc, category, icon: pres.icon, route,
    status: 'live', realMoney: true, multiplayer, popularity, difficulty: pres.difficulty,
    mobileOptimized: true, minStake: 1, maxStake: 10000, supportedCurrencies: ['INR'],
    tags, featured, isNew, responsibleGamingEligible: true, engineKey, bridgeType, sortOrder,
  };
}

export interface CatalogResponse { games: CatalogGame[]; categories: string[]; currencies: string[] }

/** Fetch the server-authoritative catalog and merge presentation. Falls back to the static list on error. */
export async function getCatalog(): Promise<GameDefinition[]> {
  try {
    const res = await apiClient.get('/catalog');
    const data = res.data.data as CatalogResponse;
    if (Array.isArray(data?.games) && data.games.length > 0) {
      return data.games.map(toDefinition).sort((a, b) => a.sortOrder - b.sortOrder);
    }
  } catch {
    // fall through to static presentation list
  }
  return [...CANONICAL_GAMES].sort((a, b) => a.sortOrder - b.sortOrder);
}
