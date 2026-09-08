import { apiClient } from './api-client';

/**
 * Real-money Dice API client (Phase 2B). Talks to the authenticated backend money bridge
 * (`/games/dice/*`). The wallet balance is ALWAYS taken from the authoritative server
 * response — never computed locally. This path does not use the demo wallet.
 */

export interface DiceBetOption {
  key: string;
  label: string;
  payout: number;
}

export interface DiceConfig {
  variant: string;
  name: string;
  limits: { min: number; max: number; tableMax?: number };
  bets: DiceBetOption[];
}

export interface WalletBalance {
  available: string;
  total: string;
  currencyId: string;
}

export interface DicePlayResult {
  roundId: string;
  game: 'dice';
  variant: string;
  betType: string;
  stake: string;
  currency: string;
  status: string;
  result: { values: number[]; total: number; isTriple: boolean; won: boolean; winningBets: string[] };
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
  replayed: boolean;
}

export interface PlayDiceRequest {
  variant: string;
  betType: string;
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

/**
 * Build the play request. The client may ONLY choose variant/bet/stake/currency (+ an
 * optional seed) — never payout, balance, result, walletId or userId. A fresh idempotency
 * key guards against duplicate submission on repeated taps / retries.
 */
export function buildPlayRequest(input: { variant: string; betType: string; stake: string; currency: string; clientSeed?: string }): PlayDiceRequest {
  return {
    variant: input.variant,
    betType: input.betType,
    stake: input.stake,
    currency: input.currency,
    clientSeed: input.clientSeed,
    idempotencyKey: newIdempotencyKey(),
  };
}

export async function getDiceConfig(): Promise<DiceConfig> {
  const res = await apiClient.get('/games/dice/config');
  return res.data.data as DiceConfig;
}

export async function getMainWallet(): Promise<WalletBalance | null> {
  const res = await apiClient.get('/wallet');
  const wallets = (res.data.data ?? []) as Array<{ type: string; available: string; total: string; currencyId: string }>;
  const main = wallets.find((w) => w.type === 'MAIN') ?? wallets[0];
  return main ? { available: main.available, total: main.total, currencyId: main.currencyId } : null;
}

export async function playDice(req: PlayDiceRequest): Promise<DicePlayResult> {
  const res = await apiClient.post('/games/dice/play', req);
  return res.data.data as DicePlayResult;
}
