import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

import { apiClient } from '../api-client';
import { CANONICAL_GAMES, getCatalog, toDefinition, type CatalogGame } from './catalog';
import { featuredGames, filterGames, matchesFilter, matchesSearch } from './filter';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
afterEach(() => vi.clearAllMocks());

const EXPECTED_KEYS = [
  'dice', 'crash', 'roulette', 'sic-bo', 'lottery', 'baccarat', 'blackjack', 'plinko', 'mines',
  'limbo', 'coin-flip', 'wheel', 'dragon-tiger', 'andar-bahar', 'teen-patti',
];

/**
 * Phase 2C.8 — canonical catalog + filtering integrity. All 15 production real-money games present,
 * no duplicates, correct real-money flags/routes, demo games not present, and no demo-wallet import.
 */

describe('canonical catalog integrity', () => {
  it('contains exactly the 15 production real-money games', () => {
    expect(CANONICAL_GAMES.map((g) => g.key).sort()).toEqual([...EXPECTED_KEYS].sort());
    expect(CANONICAL_GAMES.every((g) => g.realMoney === true)).toBe(true);
  });
  it('has no duplicate keys, slugs, routes, or sortOrders', () => {
    for (const field of ['key', 'slug', 'route', 'sortOrder'] as const) {
      const values = CANONICAL_GAMES.map((g) => g[field]);
      expect(new Set(values).size).toBe(CANONICAL_GAMES.length);
    }
  });
  it('every game routes to a `-money` page and has presentation metadata', () => {
    for (const g of CANONICAL_GAMES) {
      expect(g.route).toMatch(/^\/[a-z-]+-money$/);
      expect(g.icon.length).toBeGreaterThan(0);
      expect(['instant', 'table', 'card', 'crash', 'dice']).toContain(g.category);
      expect(g.supportedCurrencies).toContain('INR');
    }
  });
  it('the Indian card games are tagged india + new', () => {
    for (const k of ['dragon-tiger', 'andar-bahar', 'teen-patti']) {
      const g = CANONICAL_GAMES.find((x) => x.key === k)!;
      expect(g.tags).toContain('india');
      expect(g.isNew).toBe(true);
    }
  });
  it('does not contain fictional demo titles', () => {
    const names = CANONICAL_GAMES.map((g) => g.name.toLowerCase());
    for (const demo of ['neon rush', 'golden pharaoh', 'cosmic fortune', 'teen patti gold']) {
      expect(names).not.toContain(demo);
    }
  });
});

describe('toDefinition (server row → definition)', () => {
  const row: CatalogGame = {
    key: 'mines', name: 'Mines', shortDescription: 'x', category: 'instant', tags: ['popular'], route: '/mines-money',
    realMoney: true, multiplayer: false, engineKey: 'mines', bridgeType: 'mines', currencies: ['INR'], popularity: 93,
    isNew: false, featured: true, responsibleGamingEligible: true, sortOrder: 90, enabled: true, maintenance: false, limits: { min: 5, max: 2500 },
  };
  it('maps enabled→live and limits→min/maxStake', () => {
    const d = toDefinition(row);
    expect(d.status).toBe('live');
    expect(d.minStake).toBe(5);
    expect(d.maxStake).toBe(2500);
    expect(d.icon.length).toBeGreaterThan(0);
  });
  it('maps a disabled row to maintenance status', () => {
    expect(toDefinition({ ...row, enabled: false, maintenance: true }).status).toBe('maintenance');
  });
});

describe('getCatalog', () => {
  it('uses the server-authoritative catalog when present', async () => {
    mockGet.mockResolvedValue({ data: { data: { games: [{ key: 'dice', name: 'Dice', shortDescription: 'x', category: 'dice', tags: [], route: '/dice-money', realMoney: true, multiplayer: false, engineKey: 'dice', bridgeType: 'dice', currencies: ['INR'], popularity: 95, isNew: false, featured: true, responsibleGamingEligible: true, sortOrder: 10, enabled: false, maintenance: true, limits: { min: 1, max: 100 } }], categories: [], currencies: ['INR'] } } });
    const games = await getCatalog();
    expect(mockGet).toHaveBeenCalledWith('/catalog');
    expect(games).toHaveLength(1);
    expect(games[0]!.status).toBe('maintenance'); // server authority honored
  });
  it('falls back to the static canonical list on error', async () => {
    mockGet.mockRejectedValue(new Error('network'));
    const games = await getCatalog();
    expect(games).toHaveLength(15);
  });
});

describe('filtering', () => {
  it('category filter', () => {
    expect(filterGames(CANONICAL_GAMES, { filter: 'india' }).every((g) => g.tags.includes('india'))).toBe(true);
    expect(filterGames(CANONICAL_GAMES, { filter: 'instant' }).every((g) => g.category === 'instant')).toBe(true);
    expect(filterGames(CANONICAL_GAMES, { filter: 'card' }).every((g) => g.category === 'card')).toBe(true);
  });
  it('name search (case-insensitive) + real-money filter', () => {
    expect(filterGames(CANONICAL_GAMES, { query: 'plink' }).map((g) => g.key)).toEqual(['plinko']);
    expect(filterGames(CANONICAL_GAMES, { query: 'DRAGON' }).map((g) => g.key)).toEqual(['dragon-tiger']);
    expect(filterGames(CANONICAL_GAMES, { realMoneyOnly: true })).toHaveLength(15);
  });
  it('featured rail is server-featured, live only', () => {
    const feat = featuredGames(CANONICAL_GAMES);
    expect(feat.length).toBeGreaterThan(0);
    expect(feat.every((g) => g.featured && g.status === 'live')).toBe(true);
  });
  it('matchesFilter/matchesSearch primitives', () => {
    const plinko = CANONICAL_GAMES.find((g) => g.key === 'plinko')!;
    expect(matchesFilter(plinko, 'popular')).toBe(true);
    expect(matchesSearch(plinko, 'ball')).toBe(true); // description
    expect(matchesSearch(plinko, 'zzz')).toBe(false);
  });
});

describe('no demo-wallet dependency', () => {
  it('the lobby/catalog code does not import the demo wallet', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      resolve(here, 'catalog.ts'),
      resolve(here, 'filter.ts'),
      resolve(here, '../../components/games/lobby/use-lobby.ts'),
      resolve(here, '../../components/games/lobby/GameLobby.tsx'),
      resolve(here, '../../components/games/lobby/LobbyGameCard.tsx'),
    ];
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/demo-wallet|useDemoWallet|demo-games|prototype-games/);
  });
});
