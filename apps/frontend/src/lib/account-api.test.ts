import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

import { apiClient } from './api-client';
import { getMainWallet, getVerification } from './account-api';

const mockGet = apiClient.get as unknown as ReturnType<typeof vi.fn>;
afterEach(() => vi.clearAllMocks());

/**
 * Phase 2C.10 — account/verification client contract + no demo-wallet/demo-auth on account surfaces.
 * Verification is REAL server state; the account center reads authoritative identity + balance.
 */

describe('getVerification', () => {
  it('reads /users/me/verification and returns the real state', async () => {
    mockGet.mockResolvedValue({ data: { data: { email: { verified: true }, phone: { hasPhone: false, verified: false }, identity: { available: false, status: 'NOT_STARTED', level: null } } } });
    const v = await getVerification();
    expect(mockGet).toHaveBeenCalledWith('/users/me/verification');
    expect(v.email.verified).toBe(true);
    expect(v.identity.available).toBe(false);
  });
});

describe('getMainWallet', () => {
  it('extracts the MAIN wallet balance (authoritative)', async () => {
    mockGet.mockResolvedValue({ data: { data: [{ type: 'BONUS', available: '5', total: '5', currencyId: 'c' }, { type: 'MAIN', available: '900', total: '900', currencyId: 'inr' }] } });
    expect(await getMainWallet()).toEqual({ available: '900', total: '900', currencyId: 'inr' });
  });
});

describe('no demo-wallet / demo-auth on account surfaces', () => {
  it('account center, verification, responsible-gaming, support do not import demo stores', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      resolve(here, 'account-api.ts'),
      resolve(here, '../components/account/AccountRow.tsx'),
      resolve(here, '../app/(dashboard)/profile/page.tsx'),
      resolve(here, '../app/(dashboard)/verification/page.tsx'),
      resolve(here, '../app/(dashboard)/responsible-gaming/page.tsx'),
      resolve(here, '../app/(dashboard)/support/page.tsx'),
    ];
    // Match actual dependencies (imports/hooks), not incidental prose in comments.
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toMatch(/useDemoWallet|stores\/demo-wallet|usePlayerProfile|stores\/player-profile|demo-session|demo-auth/);
  });
});
