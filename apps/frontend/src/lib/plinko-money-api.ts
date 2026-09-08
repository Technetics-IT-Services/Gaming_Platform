import { apiClient } from './api-client';

/**
 * Real-money Plinko API client (Phase 2C.6). Talks to the authenticated backend money bridge
 * (`/games/plinko/*`). The landing bin, multiplier, payout and wallet balance are ALWAYS the
 * authoritative server values — never computed locally. The multiplier tables come from the config
 * endpoint (never hardcoded in the UI). This path does not use the demo wallet.
 */

export type PlinkoRisk = 'low' | 'medium' | 'high';

export interface PlinkoBoard {
  rows: number;
  risk: PlinkoRisk;
  multipliers: number[];
}

export interface PlinkoConfig {
  rows: number[];
  risks: PlinkoRisk[];
  limits: { min: number; max: number };
  boards: PlinkoBoard[];
}

export interface WalletBalance {
  available: string;
  total: string;
  currencyId: string;
}

export interface PlinkoResult {
  roundId: string;
  game: 'plinko';
  variant: string;
  rows: number;
  risk: PlinkoRisk;
  bin: number;
  multiplier: number;
  dirs: number[];
  table: number[];
  stake: string;
  currency: string;
  status: string;
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
  replayed: boolean;
}

export interface PlayPlinkoRequest {
  rows: number;
  risk: PlinkoRisk;
  stake: string;
  currency: string;
  clientSeed?: string;
  idempotencyKey: string;
}

/** A cryptographically-random idempotency key (falls back if crypto is unavailable). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Build the drop request — the client may ONLY choose rows/risk/stake/currency (+ optional seed). */
export function buildPlinkoRequest(input: { rows: number; risk: PlinkoRisk; stake: string; currency: string; clientSeed?: string }): PlayPlinkoRequest {
  return { rows: input.rows, risk: input.risk, stake: input.stake, currency: input.currency, clientSeed: input.clientSeed, idempotencyKey: newIdempotencyKey() };
}

export async function getPlinkoConfig(): Promise<PlinkoConfig> {
  const res = await apiClient.get('/games/plinko/config');
  return res.data.data as PlinkoConfig;
}

export async function getMainWallet(): Promise<WalletBalance | null> {
  const res = await apiClient.get('/wallet');
  const wallets = (res.data.data ?? []) as Array<{ type: string; available: string; total: string; currencyId: string }>;
  const main = wallets.find((w) => w.type === 'MAIN') ?? wallets[0];
  return main ? { available: main.available, total: main.total, currencyId: main.currencyId } : null;
}

export async function playPlinko(req: PlayPlinkoRequest): Promise<PlinkoResult> {
  const res = await apiClient.post('/games/plinko/play', req);
  return res.data.data as PlinkoResult;
}
