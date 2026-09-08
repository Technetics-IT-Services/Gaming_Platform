import { apiClient } from './api-client';

/**
 * Real-money Crash API client (Phase 2C.2). Talks to the authenticated backend money bridge
 * (`/games/crash/*`). The wallet balance, crash point, multiplier and payout are ALWAYS taken
 * from the authoritative server response — never computed locally for money. The rising
 * multiplier is animated client-side only for display; settlement is server-authoritative.
 * This path does not use the demo wallet.
 */

export interface CrashConfig {
  variant: string;
  name: string;
  limits: { min: number; max: number; tableMax: number };
  minMultiplier: number;
  maxMultiplier: number;
  growthRatePerSecond: number;
}

export interface WalletBalance {
  available: string;
  total: string;
  currencyId: string;
}

export interface CrashRound {
  roundId: string;
  game: 'crash';
  variant: string;
  stake: string;
  currency: string;
  status: string;
  running: boolean;
  startedAtMs: number;
  serverSeedHash: string;
  clientSeed: string;
  autoCashout: number | null;
  growthRatePerSecond: number;
  maxMultiplier: number;
  crashPoint: number | null;
  cashoutMultiplier: number | null;
  won: boolean | null;
  payout: string;
  balance: { available: string; total: string };
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
  replayed: boolean;
}

export interface PlayCrashRequest {
  variant: string;
  stake: string;
  currency: string;
  autoCashout?: number;
  clientSeed?: string;
  idempotencyKey: string;
}

/** A cryptographically-random idempotency key (falls back if crypto is unavailable). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * Build the play request. The client may ONLY choose variant/stake/currency (+ optional auto
 * cash-out and seed) — never payout, balance, crashPoint, walletId or userId.
 */
export function buildCrashPlayRequest(input: { variant: string; stake: string; currency: string; autoCashout?: number; clientSeed?: string }): PlayCrashRequest {
  return {
    variant: input.variant,
    stake: input.stake,
    currency: input.currency,
    autoCashout: input.autoCashout,
    clientSeed: input.clientSeed,
    idempotencyKey: newIdempotencyKey(),
  };
}

/** Multiplier value at an elapsed time — MUST mirror the server curve (display only). */
export function multiplierAt(elapsedMs: number, growthRatePerSecond: number, minMultiplier = 1, maxMultiplier = Infinity): number {
  const raw = Math.exp(growthRatePerSecond * (Math.max(0, elapsedMs) / 1000));
  const floored = Math.floor(raw * 100) / 100;
  return Math.min(maxMultiplier, Math.max(minMultiplier, floored));
}

export async function getCrashConfig(): Promise<CrashConfig> {
  const res = await apiClient.get('/games/crash/config');
  return res.data.data as CrashConfig;
}

export async function getMainWallet(): Promise<WalletBalance | null> {
  const res = await apiClient.get('/wallet');
  const wallets = (res.data.data ?? []) as Array<{ type: string; available: string; total: string; currencyId: string }>;
  const main = wallets.find((w) => w.type === 'MAIN') ?? wallets[0];
  return main ? { available: main.available, total: main.total, currencyId: main.currencyId } : null;
}

export async function getCrashState(): Promise<CrashRound | null> {
  const res = await apiClient.get('/games/crash/state');
  return (res.data.data ?? null) as CrashRound | null;
}

export async function playCrash(req: PlayCrashRequest): Promise<CrashRound> {
  const res = await apiClient.post('/games/crash/play', req);
  return res.data.data as CrashRound;
}

export async function cashoutCrash(roundId: string): Promise<CrashRound> {
  const res = await apiClient.post('/games/crash/cashout', { roundId, idempotencyKey: newIdempotencyKey() });
  return res.data.data as CrashRound;
}
