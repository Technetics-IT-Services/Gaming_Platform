/**
 * Game, engine, session and result contracts (Phase 2.1).
 *
 * A game is metadata (`IGameDescriptor`) + an engine plugin (`IGameEngine`). The
 * engine is a PURE function of input + RNG → result; it never touches the wallet,
 * history, or IO. Type-only.
 */
import type { IBetRequest, ISettlementResult } from './betting';
import type {
  CurrencyCode,
  GameId,
  PlayerId,
  RoundId,
  SessionId,
  SessionStatus,
  Timestamp,
} from './common';
import type { IStepResult, PlayerAction } from './interactive';
import type { IFairnessProof, IProvablyFairProvider } from './providers';

/** Capabilities a game declares — drives which runtime features + UI controls turn on. */
export interface IGameCapabilities {
  cashOut: boolean;
  autoBet: boolean;
  multiBet: boolean;
  provablyFair: boolean;
  realtime: boolean;
  /** Forward-compatible flags (not implemented in Phase 2.1). */
  multiplayer: boolean;
  liveDealer: boolean;
  tournament: boolean;
}

/**
 * Static description of a game. Adding a game = adding a descriptor + engine
 * preset (`config`) and registering the engine — no bespoke plumbing.
 */
export interface IGameDescriptor {
  gameId: GameId;
  name: string;
  /** Which engine plugin powers this title (e.g. `'card-engine'`). */
  engineKey: string;
  /** High-level family, e.g. `'crash' | 'dice' | 'roulette' | 'card' | 'lottery'`. */
  category: string;
  capabilities: IGameCapabilities;
  /** Engine preset — pure configuration, no code. */
  config: Record<string, unknown>;
}

/** A player's stateful session with a game. */
export interface IGameSession {
  sessionId: SessionId;
  gameId: GameId;
  playerId: PlayerId;
  currency: CurrencyCode;
  status: SessionStatus;
  createdAt: Timestamp;
  /** Provably-fair commit (published before the round). */
  serverSeedHash?: string;
  metadata?: Record<string, unknown>;
}

/**
 * The raw, fairness-relevant engine outcome — produced BEFORE any wallet or
 * settlement step. `state` is the engine-specific final state (dice values,
 * dealt cards, crash point, wheel index, …).
 */
export interface IGameResult<TState = unknown> {
  roundId: RoundId;
  gameId: GameId;
  state: TState;
  /** Total-return multiplier the engine computed for the winning selection(s). */
  multiplier: number;
  win: boolean;
  fairness?: IFairnessProof;
  computedAt: Timestamp;
  /**
   * Optional, engine-supplied presentation for history/stats surfaces. Games
   * whose history label/value is not a plain multiplier (a dice roll, a roulette
   * pocket, a card total) provide it here; the runtime forwards it verbatim and
   * falls back to the multiplier when absent. Purely presentational — never
   * affects settlement or payout.
   */
  display?: { label?: string; value?: number };
  /**
   * Optional flexible settlement (Phase 2.3C). When present, the settlement
   * provider uses it verbatim (payout/refund/bonus/type) instead of the default
   * `stake × multiplier`. Absent → the multiplicative default (crash/dice/… are
   * unchanged).
   */
  settlement?: ISettlementResult;
}

/**
 * A pure, deterministic game engine. It performs NO wallet, history, or network
 * IO — the Runtime does that around it.
 *
 * Two shapes, both optional so an engine implements exactly one:
 *  - Single-shot: `createRound` returns the outcome in one call (crash, dice, …).
 *  - Interactive (Phase 2.3C): `start` opens a round and `step` applies a generic
 *    `PlayerAction`, each returning an `IStepResult` (state + opaque game state).
 *    The engine validates transitions; the Runtime owns the state machine and
 *    knows nothing about the game's rules.
 */
export interface IGameEngine<TConfig = unknown, TPick = unknown, TState = unknown, TGameState = unknown> {
  readonly engineKey: string;
  createRound?(input: {
    session: IGameSession;
    bet: IBetRequest<TPick>;
    config: TConfig;
    rng: IProvablyFairProvider;
  }): Promise<IGameResult<TState>> | IGameResult<TState>;
  /** Open an interactive round → initial machine state. */
  start?(input: {
    session: IGameSession;
    bet: IBetRequest<TPick>;
    config: TConfig;
    rng: IProvablyFairProvider;
  }): IStepResult<TGameState>;
  /** Apply a player/system action → next machine state. */
  step?(input: {
    session: IGameSession;
    bet: IBetRequest<TPick>;
    config: TConfig;
    rng: IProvablyFairProvider;
    gameState: TGameState;
    action: PlayerAction;
  }): IStepResult<TGameState>;
}
