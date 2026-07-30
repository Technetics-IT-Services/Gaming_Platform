/**
 * Interactive game contracts (Phase 2.3C).
 *
 * A generic interaction model so multi-step games (a card game's hit/stand, a
 * higher/lower reveal, a tower climb…) run on the shared runtime WITHOUT the
 * runtime knowing any game's rules. The runtime owns the state machine and stores
 * opaque game state; the engine validates transitions; the UI renders state.
 * Type-only.
 */
import type { ISettlementResult } from './betting';

/**
 * The canonical lifecycle states an interactive round moves through. Reusable by
 * every game — no game-specific terminology.
 */
export enum RuntimeState {
  /** Created, not yet started. */
  Waiting = 'waiting',
  /** Engine is progressing without player input. */
  Running = 'running',
  /** Blocked on a player action (hit/stand/pick/…). */
  AwaitingPlayer = 'awaiting_player',
  /** Blocked on a system step (deal, reveal, timer…). */
  AwaitingSystem = 'awaiting_system',
  /** Terminal — resolved and settled. */
  Completed = 'completed',
  /** Terminal — cancelled/voided (stake refunded). */
  Cancelled = 'cancelled',
  /** Terminal — timed out past the session idle window. */
  Expired = 'expired',
}

/**
 * A generic player (or system) action routed to the engine. `type` is an
 * engine-defined verb the runtime never interprets; `payload` is opaque.
 */
export interface PlayerAction<TPayload = unknown> {
  type: string;
  payload?: TPayload;
}

/**
 * The result of `start` or `step`: the new machine state plus the opaque game
 * state the UI renders. When `state === Completed`, `settlement` MUST be present
 * so the runtime can settle generically.
 */
export interface IStepResult<TGameState = unknown> {
  state: RuntimeState;
  /** Engine-specific state — opaque to the runtime, rendered by the UI. */
  gameState: TGameState;
  /** Legal action `type`s from here (optional hint for the UI). */
  availableActions?: string[];
  /** Required when `state === Completed`; drives flexible settlement. */
  settlement?: ISettlementResult;
  /** Presentation hint for history/stats. */
  display?: { label?: string; value?: number };
}
