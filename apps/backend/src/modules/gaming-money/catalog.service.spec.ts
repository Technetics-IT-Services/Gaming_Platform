import { CatalogService } from './catalog.service';

/**
 * Phase 2C.8 — real-money catalog integrity + safety. Uses mocked variant services (limits are resolved
 * live from them; here we stub deterministic values) to prove: exactly the 15 production games are
 * listed, no duplicate keys/routes, all are real-money and route to a `-money` page, server-controlled
 * disable is honored, and the payload carries no secrets.
 */

const EXPECTED = [
  'dice', 'crash', 'roulette', 'sic-bo', 'lottery', 'baccarat', 'blackjack', 'plinko', 'mines',
  'limbo', 'coin-flip', 'wheel', 'dragon-tiger', 'andar-bahar', 'teen-patti',
];

function makeService(disabled = '') {
  const diceVariants = { resolve: jest.fn().mockResolvedValue({ limits: { min: 1, max: 5000 } }) };
  const crashVariants = { resolve: jest.fn().mockResolvedValue({ limits: { min: 1, max: 5000 } }) };
  const rouletteVariants = { resolve: jest.fn().mockResolvedValue({ limits: { min: 1, max: 5000 } }) };
  const cardVariants = { resolve: jest.fn().mockResolvedValue({ betLimits: { min: 1, max: 5000 } }) };
  const lottery = { config: { ticketPrice: '20' } };
  const prev = process.env.CATALOG_DISABLED_GAMES;
  process.env.CATALOG_DISABLED_GAMES = disabled;
  const svc = new CatalogService(diceVariants as never, crashVariants as never, rouletteVariants as never, cardVariants as never, lottery as never);
  return { svc, restore: () => { if (prev === undefined) delete process.env.CATALOG_DISABLED_GAMES; else process.env.CATALOG_DISABLED_GAMES = prev; } };
}

describe('CatalogService', () => {
  it('lists exactly the 15 production real-money games, sorted', async () => {
    const { svc, restore } = makeService();
    const { games } = await svc.list();
    expect(games.map((g) => g.key)).toEqual(EXPECTED);
    expect(games.every((g) => g.realMoney === true)).toBe(true);
    restore();
  });

  it('has no duplicate keys or routes and every route is a `-money` page', async () => {
    const { svc, restore } = makeService();
    const { games } = await svc.list();
    expect(new Set(games.map((g) => g.key)).size).toBe(games.length);
    expect(new Set(games.map((g) => g.route)).size).toBe(games.length);
    expect(games.every((g) => g.route.endsWith('-money') && g.route.startsWith('/'))).toBe(true);
    restore();
  });

  it('resolves live limits and marks the Indian card games with the india tag', async () => {
    const { svc, restore } = makeService();
    const { games } = await svc.list();
    const dt = games.find((g) => g.key === 'dragon-tiger')!;
    expect(dt.limits).toEqual({ min: 1, max: 5000 });
    for (const k of ['dragon-tiger', 'andar-bahar', 'teen-patti']) {
      expect(games.find((g) => g.key === k)!.tags).toContain('india');
    }
    restore();
  });

  it('honors the server-controlled disable set (client cannot override)', async () => {
    const { svc, restore } = makeService('mines,wheel');
    const { games } = await svc.list();
    expect(games.find((g) => g.key === 'mines')!.enabled).toBe(false);
    expect(games.find((g) => g.key === 'mines')!.maintenance).toBe(true);
    expect(games.find((g) => g.key === 'wheel')!.enabled).toBe(false);
    expect(games.find((g) => g.key === 'dice')!.enabled).toBe(true);
    restore();
  });

  it('exposes only safe metadata (no seeds/secrets)', async () => {
    const { svc, restore } = makeService();
    const { games } = await svc.list();
    const blob = JSON.stringify(games).toLowerCase();
    for (const forbidden of ['serverseed', 'secret', 'password', 'token', 'privatekey', 'walletid', 'ledger']) {
      expect(blob).not.toContain(forbidden);
    }
    restore();
  });

  it('findByKey returns one game or null', async () => {
    const { svc, restore } = makeService();
    expect((await svc.findByKey('plinko'))?.key).toBe('plinko');
    expect(await svc.findByKey('nope')).toBeNull();
    restore();
  });
});
