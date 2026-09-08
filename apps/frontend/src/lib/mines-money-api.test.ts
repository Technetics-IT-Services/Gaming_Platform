import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

import { apiClient } from './api-client';
import { buildStartRequest, cashoutMines, getMainWallet, getMinesConfig, newIdempotencyKey, revealMine, startMines } from './mines-money-api';
import { normalizeError } from '@/components/games/mines-money/use-mines-money';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.clearAllMocks());

/**
 * Phase 2C.6 — real-money Mines client. Verifies the request contract (server owns board/multiplier/
 * payout/balance and hides the board while active), authoritative-balance parsing, error
 * normalization, and that this path has NO demo-wallet dependency.
 */

describe('buildStartRequest', () => {
  it('sends only client-choosable fields + a fresh idempotency key', () => {
    const req = buildStartRequest({ stake: '10', mines: 3, currency: 'INR' });
    expect(req).toMatchObject({ stake: '10', mines: 3, currency: 'INR' });
    expect(req.idempotencyKey).toBeTruthy();
    for (const forbidden of ['payout', 'balance', 'board', 'multiplier', 'result', 'walletId', 'userId', 'serverSeed']) {
      expect(req).not.toHaveProperty(forbidden);
    }
  });
  it('generates a unique idempotency key per start', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('api calls', () => {
  it('startMines posts to the money bridge and returns an active round with a hidden board', async () => {
    const payload = { roundId: 'm1', game: 'mines', status: 'RESERVED', active: true, stake: '10', tiles: 25, mines: 3, revealed: [], multiplier: 1, potentialPayout: '10', board: null, hit: null, won: null, payout: '0', balance: { available: '90', total: '90' } };
    mockPost.mockResolvedValue({ data: { data: payload } });
    const res = await startMines(buildStartRequest({ stake: '10', mines: 3, currency: 'INR' }));
    expect(mockPost).toHaveBeenCalledWith('/games/mines/start', expect.objectContaining({ stake: '10', mines: 3 }));
    expect(res.active).toBe(true);
    expect(res.board).toBeNull();
    expect(res.balance.available).toBe('90');
  });

  it('revealMine posts the tile index to the round', async () => {
    const payload = { roundId: 'm1', active: true, revealed: [7], multiplier: 1.08, potentialPayout: '10.8', board: null };
    mockPost.mockResolvedValue({ data: { data: payload } });
    const res = await revealMine('m1', 7);
    expect(mockPost).toHaveBeenCalledWith('/games/mines/m1/reveal', { index: 7 });
    expect(res.revealed).toContain(7);
  });

  it('cashoutMines posts to the round and returns the authoritative settled result with the board', async () => {
    const payload = { roundId: 'm1', active: false, won: true, multiplier: 1.08, payout: '10.8', board: [2, 9, 15], hit: null, balance: { available: '100.8', total: '100.8' } };
    mockPost.mockResolvedValue({ data: { data: payload } });
    const res = await cashoutMines('m1');
    expect(mockPost).toHaveBeenCalledWith('/games/mines/m1/cashout', {});
    expect(res.won).toBe(true);
    expect(res.board).toEqual([2, 9, 15]);
    expect(res.balance.available).toBe('100.8');
  });

  it('getMainWallet extracts the MAIN wallet balance', async () => {
    mockGet.mockResolvedValue({ data: { data: [{ type: 'BONUS', available: '5', total: '5', currencyId: 'c' }, { type: 'MAIN', available: '900', total: '900', currencyId: 'inr' }] } });
    expect(await getMainWallet()).toEqual({ available: '900', total: '900', currencyId: 'inr' });
  });

  it('getMinesConfig returns tiles/min/max/limits', async () => {
    mockGet.mockResolvedValue({ data: { data: { tiles: 25, minMines: 1, maxMines: 24, limits: { min: 1, max: 10000 }, progressions: {} } } });
    const cfg = await getMinesConfig();
    expect(cfg.tiles).toBe(25);
    expect(cfg.maxMines).toBe(24);
  });
});

describe('normalizeError', () => {
  it('maps common failures to actionable messages', () => {
    expect(normalizeError({ response: { status: 401 } })).toMatch(/log in/i);
    expect(normalizeError({ response: { status: 404 } })).toMatch(/not found/i);
    expect(normalizeError({ response: { status: 400, data: { message: 'Insufficient balance' } } })).toMatch(/insufficient/i);
  });
});

describe('no demo-wallet dependency', () => {
  it('the money-mines path does not import the demo wallet', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      resolve(here, 'mines-money-api.ts'),
      resolve(here, '../components/games/mines-money/use-mines-money.ts'),
      resolve(here, '../components/games/mines-money/MinesMoneyBoard.tsx'),
    ];
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/demo-wallet|useDemoWallet/);
  });
});
