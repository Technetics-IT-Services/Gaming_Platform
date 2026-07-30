/**
 * Velocity controls (Phase 5D, STEP 8).
 *
 * Configurable rolling-window counters per player + kind (deposits, withdrawals,
 * failed attempts, logins, device/IP changes). Records are timestamped via an
 * injectable clock and pruned to the widest window, so memory stays bounded. Pure
 * counting — no money movement.
 */
import { type VelocityKind, type VelocityLimit, type VelocityResult } from './types';

interface Event {
  kind: VelocityKind;
  at: number;
}

export class VelocityControls {
  private readonly events = new Map<string, Event[]>();
  private readonly limits = new Map<VelocityKind, VelocityLimit>();
  private readonly maxWindowMs: number;

  constructor(
    limits: VelocityLimit[],
    private readonly clock: () => number = () => Date.now(),
  ) {
    for (const l of limits) this.limits.set(l.kind, l);
    this.maxWindowMs = limits.reduce((m, l) => Math.max(m, l.windowMs), 0);
  }

  /** Record an event for a player (prunes stale events past the widest window). */
  record(playerId: string, kind: VelocityKind, at: number = this.clock()): void {
    const list = this.events.get(playerId) ?? [];
    list.push({ kind, at });
    const cutoff = at - this.maxWindowMs;
    this.events.set(
      playerId,
      list.filter((e) => e.at >= cutoff),
    );
  }

  /** Count events of a kind inside its window as of `now`. */
  count(playerId: string, kind: VelocityKind, now: number = this.clock()): number {
    const limit = this.limits.get(kind);
    if (!limit) return 0;
    const cutoff = now - limit.windowMs;
    return (this.events.get(playerId) ?? []).filter((e) => e.kind === kind && e.at >= cutoff).length;
  }

  /** Evaluate one kind against its configured limit. */
  check(playerId: string, kind: VelocityKind, now: number = this.clock()): VelocityResult | null {
    const limit = this.limits.get(kind);
    if (!limit) return null;
    const count = this.count(playerId, kind, now);
    return { kind, count, limit: limit.max, windowMs: limit.windowMs, exceeded: count > limit.max };
  }

  /** Evaluate every configured kind for a player. */
  evaluate(playerId: string, now: number = this.clock()): VelocityResult[] {
    const out: VelocityResult[] = [];
    for (const kind of this.limits.keys()) {
      const r = this.check(playerId, kind, now);
      if (r) out.push(r);
    }
    return out;
  }
}
