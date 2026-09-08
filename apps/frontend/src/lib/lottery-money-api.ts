import { apiClient } from './api-client';

/**
 * Real-money Number-Lottery API client (Phase 2C.3). Talks to the authenticated backend money
 * bridge (`/games/lottery/*`). The shared draw, winning numbers, prize and wallet balance are
 * ALWAYS the authoritative server values — never computed locally. Ticket purchase RESERVES the
 * price; settlement happens when the shared draw resolves. This path does not use the demo wallet.
 */

export interface LotteryConfig {
  pool: number;
  pick: number;
  ticketPrice: string;
  currency: string;
  prizeTiers: Record<string, number>;
}

export interface LotteryDrawInfo {
  drawId: string;
  drawNumber: number;
  status: string;
  poolSize: number;
  pick: number;
  ticketPrice: string;
  drawAt: string;
  serverSeedHash: string;
  prizeTiers: Record<string, number>;
}

export interface WalletBalance {
  available: string;
  total: string;
  currencyId: string;
}

export interface LotteryTicket {
  ticketId: string;
  game: 'number-lottery';
  drawId: string;
  drawNumber: number;
  drawStatus: string;
  drawAt: string;
  picks: number[];
  ticketPrice: string;
  currency: string;
  status: string;
  settled: boolean;
  matches: number | null;
  tier: string | null;
  winningNumbers: number[];
  payout: string;
  won: boolean | null;
  reference: string;
  provablyFair: { serverSeed: string; serverSeedHash: string; clientSeed: string; nonce: number };
}

export interface LotteryTicketSummary {
  ticketId: string;
  drawNumber: number | null;
  drawStatus: string | null;
  drawAt: string | null;
  picks: number[];
  ticketPrice: string;
  status: string;
  settled: boolean;
  matches: number | null;
  tier: string | null;
  winningNumbers: number[];
  payout: string;
  won: boolean | null;
}

export interface BuyTicketRequest {
  picks: number[];
  currency: string;
  drawId?: string;
  idempotencyKey: string;
}

/** A cryptographically-random idempotency key (falls back if crypto is unavailable). */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Generate `pick` distinct quick-pick numbers in 1..pool (client convenience; the pick is the player's). */
export function quickPick(pool: number, pick: number): number[] {
  const set = new Set<number>();
  while (set.size < pick) set.add(1 + Math.floor(Math.random() * pool));
  return [...set].sort((a, b) => a - b);
}

/**
 * Build the ticket-purchase request. The client may ONLY submit its picked numbers, currency and
 * a target draw — never payout, winning numbers, prize, balance, walletId or userId.
 */
export function buildBuyRequest(input: { picks: number[]; currency: string; drawId?: string }): BuyTicketRequest {
  return { picks: input.picks, currency: input.currency, drawId: input.drawId, idempotencyKey: newIdempotencyKey() };
}

export async function getLotteryConfig(): Promise<LotteryConfig> {
  const res = await apiClient.get('/games/lottery/config');
  return res.data.data as LotteryConfig;
}

export async function getCurrentDraw(): Promise<LotteryDrawInfo> {
  const res = await apiClient.get('/games/lottery/draw');
  return res.data.data as LotteryDrawInfo;
}

export async function getMyTickets(): Promise<LotteryTicketSummary[]> {
  const res = await apiClient.get('/games/lottery/tickets');
  return (res.data.data ?? []) as LotteryTicketSummary[];
}

export async function getMainWallet(): Promise<WalletBalance | null> {
  const res = await apiClient.get('/wallet');
  const wallets = (res.data.data ?? []) as Array<{ type: string; available: string; total: string; currencyId: string }>;
  const main = wallets.find((w) => w.type === 'MAIN') ?? wallets[0];
  return main ? { available: main.available, total: main.total, currencyId: main.currencyId } : null;
}

export async function buyTicket(req: BuyTicketRequest): Promise<LotteryTicket> {
  const res = await apiClient.post('/games/lottery/buy', req);
  return res.data.data as LotteryTicket;
}
