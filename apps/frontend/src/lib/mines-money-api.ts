import { apiClient } from './api-client';

/**
 * Real-money Mines API client (Phase 2C.6). Talks to the authenticated backend money bridge
 * (`/games/mines/*`). The mine board, multiplier, payout and wallet balance are ALWAYS the
 * authoritative server values — the board is hidden until the round ends. This path does not use the
 * demo wallet.
 */

export interface MinesConfig {
  tiles: number;
  minMines: number;
  maxMines: number;
  limits: { min: number; max: number };
  progressions: Record<string, number[]>;
}

export interface WalletBalance {
  available: string;
  total: string;
  currencyId: string;
}

export interface MinesRound {
  roundId: string;
  game: 'mines';
  currency: string;
  status: string;
  active: boolean;
  stake: string;
  tiles: number;
  mines: number;
  revealed: number[];
  multiplier: number;
  potentialPayout: string;
  board: number[] | null;
  hit: number | null;
  won: boolean | null;
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
}

export interface StartMinesRequest {
  stake: string;
  mines: number;
  currency: string;
  clientSeed?: string;
  idempotencyKey: string;
}

/** A cryptographically-random idempotency key (falls back if crypto is unavailable). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Build the start request — the client may ONLY choose stake/mines/currency (+ optional seed). */
export function buildStartRequest(input: { stake: string; mines: number; currency: string; clientSeed?: string }): StartMinesRequest {
  return { stake: input.stake, mines: input.mines, currency: input.currency, clientSeed: input.clientSeed, idempotencyKey: newIdempotencyKey() };
}

export async function getMinesConfig(): Promise<MinesConfig> {
  const res = await apiClient.get('/games/mines/config');
  return res.data.data as MinesConfig;
}

export async function getMainWallet(): Promise<WalletBalance | null> {
  const res = await apiClient.get('/wallet');
  const wallets = (res.data.data ?? []) as Array<{ type: string; available: string; total: string; currencyId: string }>;
  const main = wallets.find((w) => w.type === 'MAIN') ?? wallets[0];
  return main ? { available: main.available, total: main.total, currencyId: main.currencyId } : null;
}

export async function startMines(req: StartMinesRequest): Promise<MinesRound> {
  const res = await apiClient.post('/games/mines/start', req);
  return res.data.data as MinesRound;
}

export async function revealMine(roundId: string, index: number): Promise<MinesRound> {
  const res = await apiClient.post(`/games/mines/${roundId}/reveal`, { index });
  return res.data.data as MinesRound;
}

export async function cashoutMines(roundId: string): Promise<MinesRound> {
  const res = await apiClient.post(`/games/mines/${roundId}/cashout`, {});
  return res.data.data as MinesRound;
}
