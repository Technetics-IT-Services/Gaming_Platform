/**
 * Provider contracts (Phase 2.1).
 *
 * The pluggable dependencies the Runtime orchestrates. Each has (at least) two
 * implementations across the platform's life: a demo/client implementation for
 * local play and a real backend implementation (ledger, Prisma, etc.). Games and
 * UI depend on these INTERFACES, never on a concrete implementation. Type-only.
 */
import type { IBetRequest, IBetResult } from './betting';
import type { CurrencyCode, GameId, Money, PlayerId } from './common';
import type { IGameResult, IGameSession } from './game';

/**
 * The ONLY abstraction the runtime uses to move money. Implementations: the
 * backend double-entry wallet-engine (production) or the client demo wallet
 * (local play). Games must never touch a wallet store directly.
 */
export interface IWalletProvider {
  getBalance(playerId: PlayerId, currency: CurrencyCode): Promise<Money>;
  debit(input: {
    playerId: PlayerId;
    currency: CurrencyCode;
    amount: Money;
    reference: string;
    idempotencyKey: string;
  }): Promise<{ balanceAfter: Money }>;
  credit(input: {
    playerId: PlayerId;
    currency: CurrencyCode;
    amount: Money;
    reference: string;
    idempotencyKey: string;
  }): Promise<{ balanceAfter: Money }>;
  /** Optional reserve/commit (holds) for staged bets; backed by `LockedFunds`. */
  hold?(input: {
    playerId: PlayerId;
    currency: CurrencyCode;
    amount: Money;
    reference: string;
  }): Promise<{ holdId: string }>;
  release?(holdId: string): Promise<void>;
}

/** Turns a raw engine `IGameResult` into a settled `IBetResult`, moving money via the wallet. */
export interface ISettlementProvider {
  settle(input: {
    session: IGameSession;
    result: IGameResult;
    bet: IBetRequest;
    wallet: IWalletProvider;
  }): Promise<IBetResult>;
}

/** Persists and reads bet history. Demo: client ledger. Real: backend transactions. */
export interface IGameHistoryProvider {
  record(entry: IBetResult & { playerId: PlayerId; gameId: GameId }): Promise<void>;
  list(input: {
    playerId: PlayerId;
    gameId?: GameId;
    limit?: number;
    cursor?: string;
  }): Promise<{ items: IBetResult[]; nextCursor?: string }>;
}

/** Provably-fair proof carried on a result so a player can independently verify it. */
export interface IFairnessProof {
  serverSeed?: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

/** Deterministic RNG with a commit/verify cycle (HMAC-SHA256 in the backend engines). */
export interface IProvablyFairProvider {
  /** Produce a server seed + its published hash for the next round(s). */
  commit(): { serverSeed: string; serverSeedHash: string };
  /** Derive a float in `[0, 1)` from the seeds + nonce. */
  nextFloat(input: { serverSeed: string; clientSeed: string; nonce: number }): number;
  /** Recompute and confirm a proof matches an observed outcome value. */
  verify(proof: IFairnessProof, expected: number): boolean;
}

export interface INotificationProvider {
  notify(input: {
    playerId: PlayerId;
    type: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
}

export interface IAnalyticsProvider {
  track(input: {
    event: string;
    playerId?: PlayerId;
    props?: Record<string, unknown>;
  }): Promise<void> | void;
}

export interface ILeaderboardProvider {
  submit(input: {
    playerId: PlayerId;
    gameId?: GameId;
    metric: string;
    value: number;
  }): Promise<void>;
  top(input: {
    gameId?: GameId;
    metric: string;
    limit?: number;
  }): Promise<Array<{ playerId: PlayerId; value: number; rank: number }>>;
}
