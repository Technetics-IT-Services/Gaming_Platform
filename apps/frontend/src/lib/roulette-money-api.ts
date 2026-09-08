import { apiClient } from './api-client';

/**
 * Real-money Roulette API client (Phase 2C.2). Talks to the authenticated backend money bridge
 * (`/games/roulette/*`). The winning pocket, per-bet outcome, payout and wallet balance are
 * ALWAYS taken from the authoritative server response — never computed locally. One spin =
 * one reservation + one settlement. This path does not use the demo wallet.
 */

export interface RouletteBetType {
  key: string;
  label: string;
  category: 'inside' | 'outside';
  payout: number;
  selectionSize: number | null;
}

export interface RouletteConfig {
  variant: string;
  name: string;
  limits: { min: number; max: number; tableMax: number };
  maxNumber: number;
  greenPockets: number[];
  redNumbers: number[];
  betTypes: RouletteBetType[];
}

export interface WalletBalance {
  available: string;
  total: string;
  currencyId: string;
}

export interface RouletteBet {
  type: string;
  amount: string;
  selection?: number[];
}

export interface RouletteBetSettlement {
  type: string;
  amount: string;
  selection: number[];
  outcome: 'won' | 'lost' | 'push';
  payout: number;
  returned: string;
}

export interface RouletteResult {
  roundId: string;
  game: 'roulette';
  variant: string;
  stake: string;
  currency: string;
  status: string;
  pocket: number;
  pocketLabel: string;
  color: 'red' | 'black' | 'green';
  winningBets: string[];
  bets: RouletteBet[];
  settlement: { bets: RouletteBetSettlement[]; totalBet: string; totalWin: string; net: string };
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
  replayed: boolean;
}

export interface PlayRouletteRequest {
  variant: string;
  bets: RouletteBet[];
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
 * Build the spin request. The client may ONLY submit its bets/currency (+ optional seed) —
 * never payout, result, balance, walletId or userId. A fresh idempotency key guards against
 * duplicate submission on repeated taps / retries.
 */
export function buildSpinRequest(input: { variant: string; bets: RouletteBet[]; currency: string; clientSeed?: string }): PlayRouletteRequest {
  return {
    variant: input.variant,
    bets: input.bets,
    currency: input.currency,
    clientSeed: input.clientSeed,
    idempotencyKey: newIdempotencyKey(),
  };
}

/** Total stake across all placed bets (display only; the server re-derives it authoritatively). */
export function totalStake(bets: RouletteBet[]): number {
  return bets.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
}

export async function getRouletteConfig(): Promise<RouletteConfig> {
  const res = await apiClient.get('/games/roulette/config');
  return res.data.data as RouletteConfig;
}

export async function getMainWallet(): Promise<WalletBalance | null> {
  const res = await apiClient.get('/wallet');
  const wallets = (res.data.data ?? []) as Array<{ type: string; available: string; total: string; currencyId: string }>;
  const main = wallets.find((w) => w.type === 'MAIN') ?? wallets[0];
  return main ? { available: main.available, total: main.total, currencyId: main.currencyId } : null;
}

export async function playRoulette(req: PlayRouletteRequest): Promise<RouletteResult> {
  const res = await apiClient.post('/games/roulette/play', req);
  return res.data.data as RouletteResult;
}
