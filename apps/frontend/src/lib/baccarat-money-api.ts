import { apiClient } from './api-client';

/**
 * Real-money Baccarat API client (Phase 2C.4). Talks to the authenticated backend money bridge
 * (`/games/baccarat/*`). The cards, winning side, payout and wallet balance are ALWAYS the
 * authoritative server values — never computed locally. One round = one reservation + one
 * settlement. This path does not use the demo wallet.
 */

export interface BaccaratBetOption {
  key: string;
  label: string;
  payout: number;
}

export interface BaccaratConfig {
  variant: string;
  name: string;
  limits: { min: number; max: number };
  bets: BaccaratBetOption[];
}

export interface WalletBalance {
  available: string;
  total: string;
  currencyId: string;
}

export interface BaccaratBet {
  type: string;
  amount: string;
}

export interface BaccaratResult {
  roundId: string;
  game: 'baccarat';
  variant: string;
  stake: string;
  currency: string;
  status: string;
  hands: Record<string, string[]>;
  winners: string[];
  winningBets: string[];
  isTie: boolean;
  bets: BaccaratBet[];
  settlement: { bets: Array<{ key: string; amount: string; outcome: string; payout: number; returned: string }>; totalBet: string; totalWin: string; net: string };
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
  replayed: boolean;
}

export interface PlayBaccaratRequest {
  bets: BaccaratBet[];
  currency: string;
  clientSeed?: string;
  idempotencyKey: string;
}

/** A cryptographically-random idempotency key (falls back if crypto is unavailable). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Build the deal request — the client may ONLY submit bets/currency (+ optional seed). */
export function buildBaccaratRequest(input: { bets: BaccaratBet[]; currency: string; clientSeed?: string }): PlayBaccaratRequest {
  return { bets: input.bets, currency: input.currency, clientSeed: input.clientSeed, idempotencyKey: newIdempotencyKey() };
}

/** Total stake across all placed bets (display only; the server re-derives it authoritatively). */
export function totalStake(bets: BaccaratBet[]): number {
  return bets.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
}

export async function getBaccaratConfig(): Promise<BaccaratConfig> {
  const res = await apiClient.get('/games/baccarat/config');
  return res.data.data as BaccaratConfig;
}

export async function getMainWallet(): Promise<WalletBalance | null> {
  const res = await apiClient.get('/wallet');
  const wallets = (res.data.data ?? []) as Array<{ type: string; available: string; total: string; currencyId: string }>;
  const main = wallets.find((w) => w.type === 'MAIN') ?? wallets[0];
  return main ? { available: main.available, total: main.total, currencyId: main.currencyId } : null;
}

export async function playBaccarat(req: PlayBaccaratRequest): Promise<BaccaratResult> {
  const res = await apiClient.post('/games/baccarat/play', req);
  return res.data.data as BaccaratResult;
}
