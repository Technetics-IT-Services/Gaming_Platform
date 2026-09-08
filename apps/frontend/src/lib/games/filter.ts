import type { GameDefinition } from './catalog';

/** Lobby category chips. 'all'/'popular'/'new'/'india' are derived filters over tags/flags. */
export type LobbyFilter = 'all' | 'popular' | 'instant' | 'table' | 'card' | 'india' | 'new';

export const LOBBY_FILTERS: { key: LobbyFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'popular', label: 'Popular' },
  { key: 'instant', label: 'Instant' },
  { key: 'table', label: 'Table' },
  { key: 'card', label: 'Card' },
  { key: 'india', label: 'India' },
  { key: 'new', label: 'New' },
];

/** True when a game matches the active category filter. */
export function matchesFilter(game: GameDefinition, filter: LobbyFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'popular': return game.popularity >= 90 || game.tags.includes('popular');
    case 'new': return game.isNew || game.tags.includes('new');
    case 'india': return game.tags.includes('india');
    case 'instant': return game.category === 'instant';
    case 'table': return game.category === 'table' || game.category === 'dice' || game.category === 'crash';
    case 'card': return game.category === 'card';
    default: return true;
  }
}

/** True when a game matches a free-text query (name / description / tags). */
export function matchesSearch(game: GameDefinition, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    game.name.toLowerCase().includes(q) ||
    game.shortDescription.toLowerCase().includes(q) ||
    game.tags.some((t) => t.toLowerCase().includes(q))
  );
}

/** Apply category + search + real-money filters and return a sorted list. */
export function filterGames(games: GameDefinition[], opts: { filter?: LobbyFilter; query?: string; realMoneyOnly?: boolean } = {}): GameDefinition[] {
  const { filter = 'all', query = '', realMoneyOnly = false } = opts;
  return games
    .filter((g) => (realMoneyOnly ? g.realMoney : true))
    .filter((g) => matchesFilter(g, filter))
    .filter((g) => matchesSearch(g, query))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Featured games for the hero rail (server-flagged featured, most popular first). */
export function featuredGames(games: GameDefinition[]): GameDefinition[] {
  return games.filter((g) => g.featured && g.status === 'live').sort((a, b) => b.popularity - a.popularity);
}
