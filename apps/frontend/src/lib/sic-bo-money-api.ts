import { apiClient } from './api-client';

/**
 * Real-money Sic Bo API client (Phase 2C.3). Talks to the authenticated backend money bridge
 * (`/games/sic-bo/*`). The dice, winning bets, payout and wallet balance are ALWAYS the
 * authoritative server values — never computed locally. One board = one roll = one reservation +
 * one settlement. This path does not use the demo wallet.
 */

export interface SicBoBetOption {
  key: string;
  label: string;
  category: string;
  payout: number;
}

export interface SicBoConfig {
  variant: string;
  name: string;
  limits: { min: number; max: number; tableMax: number };
  diceCount: number;
  faces: number;
  bets: SicBoBetOption[];
}

export interface WalletBalance {
  available: string;
  total: string;
  currencyId: string;
}

export interface SicBoBet {
  type: string;
  amount: string;
}

export interface SicBoBetSettlement {
  type: string;
  amount: string;
  outcome: 'won' | 'lost';
  payout: number;
  returned: string;
}

export interface SicBoResult {
  roundId: string;
  game: 'sic-bo';
  variant: string;
  stake: string;
  currency: string;
  status: string;
  dice: number[];
  total: number;
  isTriple: boolean;
  winningBets: string[];
  bets: SicBoBet[];
  settlement: { bets: SicBoBetSettlement[]; totalBet: string; totalWin: string; net: string };
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
  replayed: boolean;
}

export interface PlaySicBoRequest {
  variant: string;
  bets: SicBoBet[];
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
 * Build the roll request. The client may ONLY submit its bets/currency (+ optional seed) — never
 * payout, dice, result, balance, walletId or userId. A fresh idempotency key guards duplicate taps.
 */
export function buildRollRequest(input: { variant: string; bets: SicBoBet[]; currency: string; clientSeed?: string }): PlaySicBoRequest {
  return {
    variant: input.variant,
    bets: input.bets,
    currency: input.currency,
    clientSeed: input.clientSeed,
    idempotencyKey: newIdempotencyKey(),
  };
}

/** Total stake across placed bets (display only; the server re-derives it authoritatively). */
export function totalStake(bets: SicBoBet[]): number {
  return bets.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
}

export async function getSicBoConfig(): Promise<SicBoConfig> {
  const res = await apiClient.get('/games/sic-bo/config');
  return res.data.data as SicBoConfig;
}

export async function getMainWallet(): Promise<WalletBalance | null> {
  const res = await apiClient.get('/wallet');
  const wallets = (res.data.data ?? []) as Array<{ type: string; available: string; total: string; currencyId: string }>;
  const main = wallets.find((w) => w.type === 'MAIN') ?? wallets[0];
  return main ? { available: main.available, total: main.total, currencyId: main.currencyId } : null;
}

export async function playSicBo(req: PlaySicBoRequest): Promise<SicBoResult> {
  const res = await apiClient.post('/games/sic-bo/play', req);
  return res.data.data as SicBoResult;
}
