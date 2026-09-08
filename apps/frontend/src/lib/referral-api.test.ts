import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  unwrap: async (p: Promise<{ data: { data: unknown } }>) => (await p).data.data,
}));

import { apiClient } from './api-client';
import { referralApi } from './referral-api';

/**
 * P-17 referral client contract, plus structural proof that the player screen shows attribution
 * only — no earnings figure, no reward balance, and no client-supplied identity.
 */

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>;
const post = apiClient.post as unknown as ReturnType<typeof vi.fn>;
const ok = (data: unknown) => Promise.resolve({ data: { data } });

beforeEach(() => { get.mockReset(); post.mockReset(); });
afterEach(() => vi.clearAllMocks());

describe('referralApi — contract', () => {
  it('reads the caller’s own summary with NO user id in the path or query', async () => {
    get.mockReturnValueOnce(ok({ code: 'ABC123', totalReferred: 0, referrals: [], referredBy: null, unavailable: [] }));
    await referralApi.me();
    // The server scopes to the authenticated principal. A client-supplied id would be an IDOR.
    expect(get.mock.calls[0][0]).toBe('/referral');
  });

  it('sends ONLY the code when claiming — never an id, status or reward', async () => {
    post.mockReturnValueOnce(ok({ referredBy: 'alice', status: 'PENDING', alreadyClaimed: false }));
    await referralApi.claim('ABC123');
    const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/referral/claim');
    expect(Object.keys(body)).toEqual(['code']);
    for (const forbidden of ['userId', 'referrerId', 'status', 'reward', 'amount', 'bonus']) {
      expect(Object.keys(body)).not.toContain(forbidden);
    }
  });

  it('returns the server’s summary unchanged, including its unavailable reasons', async () => {
    get.mockReturnValueOnce(ok({
      code: 'ABC123',
      totalReferred: 2,
      referrals: [{ id: 'r1', referredUsername: 'bob', status: 'PENDING', createdAt: '2026-09-01T00:00:00.000Z', qualifiedAt: null, rewardedAt: null }],
      referredBy: { username: 'alice', since: '2026-08-01T00:00:00.000Z' },
      unavailable: [{ metric: 'referralReward', reason: 'NOT AVAILABLE — BUSINESS DEFINITION MISSING' }],
    }));
    const s = await referralApi.me();
    expect(s.totalReferred).toBe(2);
    expect(s.referredBy?.username).toBe('alice');
    expect(s.unavailable[0]?.metric).toBe('referralReward');
  });

  it('surfaces a rejected claim as an error rather than a silent success', async () => {
    post.mockReturnValueOnce(Promise.reject(new Error('BAD_CODE')));
    await expect(referralApi.claim('NOPE')).rejects.toThrow();
  });
});

describe('the referral client carries no monetary surface', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

  it('declares no earnings, balance or reward amount field', () => {
    // Comments are stripped first: the doc comment legitimately EXPLAINS that these fields are
    // absent, and naming them there is the point. What must not exist is a declared field.
    const src = read('lib/referral-api.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['earnings', 'balance', 'rewardAmount', 'commission', 'payout', 'totalEarned']) {
      expect(src).not.toContain(forbidden);
    }
  });
});

describe('the referral screen shows attribution, not money', () => {
  const SRC = join(process.cwd(), 'src');
  const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const PAGE = 'app/(dashboard)/referral/page.tsx';

  it('renders from the API, never from demo state', () => {
    const src = strip(read(PAGE));
    expect(src).toContain('referralApi.me');
    expect(src).toContain('referralApi.claim');
    expect(src).not.toContain('demo-wallet');
    expect(src).not.toContain('useDemoWallet');
  });

  it('shows NO currency amount anywhere', () => {
    const src = strip(read(PAGE));
    // A zero rendered as money would imply a reward was calculated and found to be nothing.
    expect(src).not.toContain('₹');
    expect(src).not.toContain('toFixed');
    expect(src).not.toMatch(/\bformatCurrency\b/);
  });

  it('states the reason rewards are unavailable, from the server', () => {
    const src = read(PAGE);
    expect(src).toContain('referral-unavailable');
    expect(src).toContain('d.unavailable.map');
    expect(src).toContain('Rewards are not available yet');
  });

  it('never derives referral state from a client-held identity', () => {
    const src = strip(read(PAGE));
    expect(src).not.toContain('userId');
  });

  it('has loading, error, empty and refusal states', () => {
    const src = read(PAGE);
    expect(src).toContain('referral-loading');
    expect(src).toContain('referral-error');
    expect(src).toContain('referral-empty');
    expect(src).toContain('referral-claim-error');
    expect(src).toContain('Nothing was saved');
  });

  it('is mobile-safe: >=44px targets and no forced width', () => {
    const src = read(PAGE);
    expect(src).toContain('minHeight: 44');
    expect(src).toContain('minWidth: 0');
    expect(src).toContain("overflowWrap: 'anywhere'");
  });
});
