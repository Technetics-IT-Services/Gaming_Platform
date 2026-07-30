/**
 * Runtime contracts (Phase 2.1).
 *
 * The Runtime is the ONLY orchestrator between the UI and the platform services.
 * A game never calls the wallet, settlement, history, analytics or notification
 * layers directly — it goes through `IGameRuntime`, which drives the canonical
 * lifecycle (see `GameLifecyclePhase`). Type-only.
 */
import type {
  IBetRequest,
  IBetResult,
  ICashOutRequest,
  ICashOutResult,
} from './betting';
import type { CurrencyCode, GameId, PlayerId, RoundId, SessionId, Timestamp } from './common';
import type { IGameResult, IGameSession } from './game';

/** Lifecycle events the runtime emits so the UI (and observers) can react. */
export enum RuntimeEventType {
  SessionCreated = 'session.created',
  RoundStarted = 'round.started',
  BetPlaced = 'bet.placed',
  WalletDebited = 'wallet.debited',
  EngineExecuted = 'engine.executed',
  ResultCalculated = 'result.calculated',
  Settled = 'settled',
  WalletCredited = 'wallet.credited',
  HistorySaved = 'history.saved',
  CashOut = 'cashout',
  Error = 'error',
}

export interface IRuntimeEvent<TPayload = unknown> {
  type: RuntimeEventType;
  sessionId: SessionId;
  roundId?: RoundId;
  at: Timestamp;
  payload: TPayload;
}

/**
 * The single communication point between UI and backend. Both a real
 * (backend-ledger-backed) runtime and a demo (client-store-backed) runtime
 * implement this interface, so the UI is written once against the contract.
 */
export interface IGameRuntime {
  createSession(input: {
    gameId: GameId;
    playerId: PlayerId;
    currency: CurrencyCode;
  }): Promise<IGameSession>;

  getSession(sessionId: SessionId): Promise<IGameSession | null>;

  /**
   * Place a bet and run the full canonical lifecycle
   * (validate → debit → execute → settle → credit → history → stats → notify → analytics).
   */
  placeBet<TPick = unknown>(bet: IBetRequest<TPick>): Promise<IBetResult>;

  /** Convenience for non-interactive games that resolve in a single call. */
  playRound?<TPick = unknown>(
    bet: IBetRequest<TPick>,
  ): Promise<{ result: IGameResult; bet: IBetResult }>;

  /** For cashable rounds (crash-style). Only present when the game declares `cashOut`. */
  cashOut?(req: ICashOutRequest): Promise<ICashOutResult>;

  /** Subscribe to runtime events for a session; returns an unsubscribe fn. */
  subscribe(sessionId: SessionId, handler: (event: IRuntimeEvent) => void): () => void;
}
