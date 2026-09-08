import { apiClient } from './api-client';

/**
 * Real-money card-games API client (Phase 2C.7 — Dragon Tiger · Andar Bahar · Teen Patti). Talks to
 * the authenticated backend money bridge (`/games/<variant>/*`) over the authoritative card-engine.
 * The dealt hands, winner, winning bets, payout and wallet balance are ALWAYS the authoritative server
 * values — never computed locally. The bet menu (keys + payouts) comes from the config API. This path
 * does not use the demo wallet.
 */

export type CardVariant = 'dragon-tiger' | 'andar-bahar' | 'teen-patti';

export interface CardBetDef {
  key: string;
  label: string;
  payout: number;
}
export interface CardConfig {
  variant: string;
  name: string;
  limits: { min: number; max: number };
  sides: string[];
  tieRule: string;
  bets: CardBetDef[];
}

export interface WalletBalance {
  available: string;
  total: string;
  currencyId: string;
}

export interface CardResult {
  roundId: string;
  game: string;
  variant: string;
  stake: string;
  currency: string;
  status: string;
  hands: Record<string, string[]>;
  winners: string[];
  winningBets: string[];
  isTie: boolean;
  bets: Array<{ type: string; amount: string }>;
  settlement: { bets: Array<{ key: string; stake: string; win: string; net: string }>; totalBet: string; totalWin: string; net: string };
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
  replayed: boolean;
}

export interface PlacedBet {
  type: string;
  amount: string;
}

/** A cryptographically-random idempotency key (falls back if crypto is unavailable). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Build the play request — the client sends ONLY its bets + currency (+ optional seed). */
export function buildCardRequest(bets: PlacedBet[], currency: string, clientSeed?: string) {
  return { bets, currency, clientSeed, idempotencyKey: newIdempotencyKey() };
}

export async function getCardConfig(variant: CardVariant): Promise<CardConfig> {
  const res = await apiClient.get(`/games/${variant}/config`);
  return res.data.data as CardConfig;
}

export async function getMainWallet(): Promise<WalletBalance | null> {
  const res = await apiClient.get('/wallet');
  const wallets = (res.data.data ?? []) as Array<{ type: string; available: string; total: string; currencyId: string }>;
  const main = wallets.find((w) => w.type === 'MAIN') ?? wallets[0];
  return main ? { available: main.available, total: main.total, currencyId: main.currencyId } : null;
}

export async function playCard(variant: CardVariant, body: Record<string, unknown>): Promise<CardResult> {
  const res = await apiClient.post(`/games/${variant}/play`, body);
  return res.data.data as CardResult;
}
