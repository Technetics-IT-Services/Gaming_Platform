import { apiClient } from './api-client';

/**
 * Real-money instant-games API client (Phase 2C.7 — Limbo · Coin Flip · Wheel). Talks to the
 * authenticated backend money bridge (`/games/<game>/*`). The outcome, multiplier, payout and wallet
 * balance are ALWAYS the authoritative server values — never computed locally. This path does not use
 * the demo wallet.
 */

export type InstantGame = 'limbo' | 'coin-flip' | 'wheel';
export type CoinSide = 'heads' | 'tails';
export type WheelRisk = 'low' | 'medium' | 'high';

export interface WalletBalance {
  available: string;
  total: string;
  currencyId: string;
}

export interface LimboConfig {
  game: 'limbo';
  limits: { min: number; max: number };
  minTarget: number;
  maxMultiplier: number;
  houseEdgePct: number;
}
export interface CoinFlipConfig {
  game: 'coin-flip';
  limits: { min: number; max: number };
  sides: CoinSide[];
  payout: number;
}
export interface WheelConfig {
  game: 'wheel';
  limits: { min: number; max: number };
  risks: WheelRisk[];
  segments: Record<WheelRisk, number[]>;
}
export type InstantConfig = LimboConfig | CoinFlipConfig | WheelConfig;

export interface InstantResult {
  roundId: string;
  game: InstantGame;
  betType: string;
  multiplier: number;
  win: boolean;
  result: Record<string, unknown>;
  stake: string;
  currency: string;
  status: string;
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
  replayed: boolean;
}

/** The player's choice for each game — the ONLY game-specific field the client may send. */
export type InstantSelection =
  | { game: 'limbo'; target: number }
  | { game: 'coin-flip'; side: CoinSide }
  | { game: 'wheel'; risk: WheelRisk };

/** A cryptographically-random idempotency key (falls back if crypto is unavailable). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Build the play request body — the client sends ONLY its selection + stake/currency (+ optional seed). */
export function buildInstantRequest(selection: InstantSelection, stake: string, currency: string, clientSeed?: string) {
  const base = { stake, currency, clientSeed, idempotencyKey: newIdempotencyKey() };
  if (selection.game === 'limbo') return { ...base, target: selection.target };
  if (selection.game === 'coin-flip') return { ...base, side: selection.side };
  return { ...base, risk: selection.risk };
}

export async function getInstantConfig(game: InstantGame): Promise<InstantConfig> {
  const res = await apiClient.get(`/games/${game}/config`);
  return res.data.data as InstantConfig;
}

export async function getMainWallet(): Promise<WalletBalance | null> {
  const res = await apiClient.get('/wallet');
  const wallets = (res.data.data ?? []) as Array<{ type: string; available: string; total: string; currencyId: string }>;
  const main = wallets.find((w) => w.type === 'MAIN') ?? wallets[0];
  return main ? { available: main.available, total: main.total, currencyId: main.currencyId } : null;
}

export async function playInstant(game: InstantGame, body: Record<string, unknown>): Promise<InstantResult> {
  const res = await apiClient.post(`/games/${game}/play`, body);
  return res.data.data as InstantResult;
}
