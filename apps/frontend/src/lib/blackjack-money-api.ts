import { apiClient } from './api-client';

/**
 * Real-money Blackjack API client (Phase 2C.4). Talks to the authenticated backend money bridge
 * (`/games/blackjack/*`). The cards, dealer play, result, payout and wallet balance are ALWAYS the
 * authoritative server values — never computed locally. One hand = one reservation (a DOUBLE adds a
 * second reservation, settled together). This path does not use the demo wallet.
 */

export type BlackjackAction = 'HIT' | 'STAND' | 'DOUBLE';

export interface BlackjackConfig {
  variant: string;
  name: string;
  limits: { min: number; max: number };
  dealerStandValue: number;
  payout: number;
  actions: BlackjackAction[];
  unsupported: string[];
}

export interface WalletBalance {
  available: string;
  total: string;
  currencyId: string;
}

export interface BlackjackHand {
  roundId: string;
  game: 'blackjack';
  currency: string;
  status: string;
  active: boolean;
  stake: string;
  doubled: boolean;
  player: string[];
  playerValue: number;
  dealer: string[];
  dealerValue: number | null;
  dealerUpOnly: boolean;
  legalActions: BlackjackAction[];
  winner: string | null;
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
}

export interface StartBlackjackRequest {
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

/** Build the start request — the client may ONLY submit stake/currency (+ optional seed). */
export function buildStartRequest(input: { stake: string; currency: string; clientSeed?: string }): StartBlackjackRequest {
  return { stake: input.stake, currency: input.currency, clientSeed: input.clientSeed, idempotencyKey: newIdempotencyKey() };
}

export async function getBlackjackConfig(): Promise<BlackjackConfig> {
  const res = await apiClient.get('/games/blackjack/config');
  return res.data.data as BlackjackConfig;
}

export async function getMainWallet(): Promise<WalletBalance | null> {
  const res = await apiClient.get('/wallet');
  const wallets = (res.data.data ?? []) as Array<{ type: string; available: string; total: string; currencyId: string }>;
  const main = wallets.find((w) => w.type === 'MAIN') ?? wallets[0];
  return main ? { available: main.available, total: main.total, currencyId: main.currencyId } : null;
}

export async function startBlackjack(req: StartBlackjackRequest): Promise<BlackjackHand> {
  const res = await apiClient.post('/games/blackjack/start', req);
  return res.data.data as BlackjackHand;
}

export async function blackjackAction(roundId: string, action: BlackjackAction): Promise<BlackjackHand> {
  const res = await apiClient.post(`/games/blackjack/${roundId}/action`, { action });
  return res.data.data as BlackjackHand;
}

export async function getBlackjackState(roundId: string): Promise<BlackjackHand> {
  const res = await apiClient.get(`/games/blackjack/${roundId}`);
  return res.data.data as BlackjackHand;
}
