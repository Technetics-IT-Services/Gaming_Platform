import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

import { apiClient } from './api-client';
import { blackjackAction, buildStartRequest, getBlackjackConfig, getMainWallet, newIdempotencyKey, startBlackjack } from './blackjack-money-api';
import { normalizeError } from '@/components/games/blackjack-money/use-blackjack-money';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as unknown as ReturnType<typeof vi.fn>;

afterEach(() => vi.clearAllMocks());

/**
 * Phase 2C.4 — real-money Blackjack client. Verifies the start/action request contract (server owns
 * all money + cards), authoritative-balance parsing, hidden-hole handling, error normalization, and
 * that this path has NO demo-wallet dependency.
 */

describe('buildStartRequest', () => {
  it('sends only client-choosable fields + a fresh idempotency key', () => {
    const req = buildStartRequest({ stake: '10', currency: 'INR' });
    expect(req).toMatchObject({ stake: '10', currency: 'INR' });
    expect(req.idempotencyKey).toBeTruthy();
    for (const forbidden of ['payout', 'cards', 'dealerCards', 'result', 'balance', 'walletId', 'userId']) {
      expect(req).not.toHaveProperty(forbidden);
    }
  });
  it('generates a unique idempotency key per hand', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('api calls', () => {
  it('startBlackjack posts the stake and returns an active hand (hole hidden)', async () => {
    const payload = { roundId: 'h1', active: true, status: 'RESERVED', player: ['AS', '9D'], playerValue: 20, dealer: ['KH'], dealerUpOnly: true, legalActions: ['HIT', 'STAND', 'DOUBLE'], payout: '0', balance: { available: '90', total: '90' }, provablyFair: { serverSeed: '' } };
    mockPost.mockResolvedValue({ data: { data: payload } });
    const req = buildStartRequest({ stake: '10', currency: 'INR' });
    const res = await startBlackjack(req);
    expect(mockPost).toHaveBeenCalledWith('/games/blackjack/start', req);
    expect(res.active).toBe(true);
    expect(res.dealer.length).toBe(1); // only the up-card
    expect(res.provablyFair.serverSeed).toBe(''); // hidden while active
  });

  it('blackjackAction posts to the round action endpoint and returns the authoritative hand', async () => {
    const payload = { roundId: 'h1', active: false, status: 'SETTLED', winner: 'player', payout: '20', balance: { available: '110', total: '110' }, dealer: ['KH', '7C'], dealerValue: 17 };
    mockPost.mockResolvedValue({ data: { data: payload } });
    const res = await blackjackAction('h1', 'STAND');
    expect(mockPost).toHaveBeenCalledWith('/games/blackjack/h1/action', { action: 'STAND' });
    expect(res.status).toBe('SETTLED');
    expect(res.balance.available).toBe('110');
  });

  it('getMainWallet extracts the MAIN wallet balance', async () => {
    mockGet.mockResolvedValue({ data: { data: [{ type: 'MAIN', available: '900', total: '900', currencyId: 'inr' }] } });
    expect(await getMainWallet()).toEqual({ available: '900', total: '900', currencyId: 'inr' });
  });

  it('getBlackjackConfig returns limits + supported/unsupported actions', async () => {
    mockGet.mockResolvedValue({ data: { data: { variant: 'blackjack', name: 'Blackjack', limits: { min: 1, max: 100000 }, dealerStandValue: 17, payout: 2, actions: ['HIT', 'STAND', 'DOUBLE'], unsupported: ['SPLIT', 'INSURANCE'] } } });
    const cfg = await getBlackjackConfig();
    expect(cfg.dealerStandValue).toBe(17);
    expect(cfg.unsupported).toContain('SPLIT');
  });
});

describe('normalizeError', () => {
  it('maps common failures to actionable messages', () => {
    expect(normalizeError({ response: { status: 401 } })).toMatch(/log in/i);
    expect(normalizeError({ response: { status: 409 } })).toMatch(/in progress/i);
    expect(normalizeError({ response: { status: 400, data: { message: 'Insufficient balance' } } })).toMatch(/insufficient/i);
  });
});

describe('no demo-wallet dependency', () => {
  it('the money-blackjack path does not import the demo wallet', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      resolve(here, 'blackjack-money-api.ts'),
      resolve(here, '../components/games/blackjack-money/use-blackjack-money.ts'),
      resolve(here, '../components/games/blackjack-money/BlackjackMoneyBoard.tsx'),
    ];
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/demo-wallet|useDemoWallet/);
  });
});
