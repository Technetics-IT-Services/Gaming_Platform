/**
 * Runtime event system (Phase 2.2).
 *
 * Everything inside the Runtime communicates through events. This is a tiny,
 * synchronous, typed pub/sub — no external dep, tree-shakable, and leak-safe
 * (every `on` returns an unsubscribe; listeners are held in a Set).
 *
 * The event NAMES below are the canonical superset that supersedes the coarse
 * `RuntimeEventType` in `@gaming-platform/types` (which was illustrative). The
 * event ENVELOPE mirrors the contract's `IRuntimeEvent`.
 */

export enum RuntimeEventName {
  SESSION_CREATED = 'SESSION_CREATED',
  SESSION_STARTED = 'SESSION_STARTED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  BET_CREATED = 'BET_CREATED',
  BET_VALIDATED = 'BET_VALIDATED',
  BET_REJECTED = 'BET_REJECTED',
  ROUND_STARTED = 'ROUND_STARTED',
  ROUND_UPDATED = 'ROUND_UPDATED',
  ROUND_FINISHED = 'ROUND_FINISHED',
  ROUND_CANCELLED = 'ROUND_CANCELLED',
  WALLET_DEBITED = 'WALLET_DEBITED',
  WALLET_CREDITED = 'WALLET_CREDITED',
  SETTLEMENT_STARTED = 'SETTLEMENT_STARTED',
  SETTLEMENT_COMPLETED = 'SETTLEMENT_COMPLETED',
  SETTLEMENT_FAILED = 'SETTLEMENT_FAILED',
  HISTORY_UPDATED = 'HISTORY_UPDATED',
  STATISTICS_UPDATED = 'STATISTICS_UPDATED',
  NOTIFICATION_SENT = 'NOTIFICATION_SENT',
  PROVABLY_FAIR_GENERATED = 'PROVABLY_FAIR_GENERATED',
  // Interactive runtime (Phase 2.3C) — additive; existing names unchanged.
  STEP_STARTED = 'STEP_STARTED',
  STEP_COMPLETED = 'STEP_COMPLETED',
  PLAYER_ACTION = 'PLAYER_ACTION',
  STATE_CHANGED = 'STATE_CHANGED',
  SETTLEMENT_UPDATED = 'SETTLEMENT_UPDATED',
  ERROR = 'ERROR',
}

export interface RuntimeEvent<TPayload = unknown> {
  name: RuntimeEventName;
  sessionId?: string;
  roundId?: string;
  at: number;
  payload: TPayload;
}

export type RuntimeEventHandler = (event: RuntimeEvent) => void;

export class EventBus {
  /** Per-event-name listeners plus a wildcard set for observers of everything. */
  private readonly listeners = new Map<RuntimeEventName, Set<RuntimeEventHandler>>();
  private readonly wildcard = new Set<RuntimeEventHandler>();

  /** Subscribe to one event; returns an unsubscribe fn (no leaks). */
  on(name: RuntimeEventName, handler: RuntimeEventHandler): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  /** Subscribe to every event; returns an unsubscribe fn. */
  onAny(handler: RuntimeEventHandler): () => void {
    this.wildcard.add(handler);
    return () => this.wildcard.delete(handler);
  }

  emit<TPayload>(
    name: RuntimeEventName,
    payload: TPayload,
    meta?: { sessionId?: string; roundId?: string },
  ): void {
    const event: RuntimeEvent<TPayload> = {
      name,
      sessionId: meta?.sessionId,
      roundId: meta?.roundId,
      at: Date.now(),
      payload,
    };
    this.listeners.get(name)?.forEach((h) => h(event as RuntimeEvent));
    this.wildcard.forEach((h) => h(event as RuntimeEvent));
  }

  /** Drop all listeners (used on runtime teardown). */
  clear(): void {
    this.listeners.clear();
    this.wildcard.clear();
  }
}
