/**
 * Player segmentation (Phase 6B, STEP 2).
 *
 * A registry of configurable `SegmentDefinition`s evaluated against a read-only
 * `PlayerSnapshot`. Segments are pure predicates — add/toggle/replace at runtime, no
 * code change to tune thresholds. Pure classification; owns no money.
 */
import { Segment, type SegmentDefinition, type PlayerSnapshot } from './types';

export interface SegmentConfig {
  highValueDeposit?: number;
  newPlayerWindowMs?: number;
  dormantAfterMs?: number;
  activeWithinMs?: number;
  vipMinLevel?: number;
}

const DAY = 24 * 60 * 60_000;

/** Production-representative default segments; every threshold is configurable. */
export function defaultSegments(config: SegmentConfig = {}): SegmentDefinition[] {
  const highValue = config.highValueDeposit ?? 500_000;
  const newWindow = config.newPlayerWindowMs ?? 7 * DAY;
  const dormantAfter = config.dormantAfterMs ?? 30 * DAY;
  const activeWithin = config.activeWithinMs ?? 7 * DAY;
  const vipMin = config.vipMinLevel ?? 1;

  return [
    { segment: Segment.VIP, description: 'VIP level at/above threshold', enabled: true, matches: (s) => s.vipLevel >= vipMin },
    { segment: Segment.HighValue, description: 'Lifetime deposits at/above threshold', enabled: true, matches: (s) => s.depositTotal >= highValue },
    { segment: Segment.NewPlayer, description: 'Registered within the new-player window', enabled: true, matches: (s, now) => s.registeredAt !== undefined && now - s.registeredAt <= newWindow },
    { segment: Segment.Dormant, description: 'No activity for the dormant window', enabled: true, matches: (s, now) => s.lastActivityAt !== undefined && now - s.lastActivityAt >= dormantAfter },
    { segment: Segment.Active, description: 'Active within the recent window', enabled: true, matches: (s, now) => s.lastActivityAt !== undefined && now - s.lastActivityAt <= activeWithin },
    { segment: Segment.AtRisk, description: 'Carries risk flags', enabled: true, matches: (s) => s.riskFlags.length > 0 },
    { segment: Segment.SelfExcluded, description: 'Account is self-excluded', enabled: true, matches: (s) => s.accountStatus === 'self_excluded' },
    { segment: Segment.ResponsibleGaming, description: 'Under a responsible-gaming measure', enabled: true, matches: (s) => s.accountStatus === 'self_excluded' || s.riskFlags.includes('RG_LIMIT') },
  ];
}

export class SegmentationEngine {
  private readonly defs = new Map<Segment, SegmentDefinition>();
  constructor(defs: SegmentDefinition[] = defaultSegments(), private readonly clock: () => number = () => Date.now()) {
    for (const d of defs) this.defs.set(d.segment, d);
  }

  set(def: SegmentDefinition): this {
    this.defs.set(def.segment, def);
    return this;
  }
  toggle(segment: Segment, enabled: boolean): this {
    const d = this.defs.get(segment);
    if (d) d.enabled = enabled;
    return this;
  }
  list(): SegmentDefinition[] {
    return [...this.defs.values()];
  }

  /** All segments a snapshot currently belongs to. */
  evaluate(snapshot: PlayerSnapshot, now: number = this.clock()): Segment[] {
    const out: Segment[] = [];
    for (const d of this.defs.values()) {
      if (d.enabled && d.matches(snapshot, now)) out.push(d.segment);
    }
    return out;
  }

  inSegment(snapshot: PlayerSnapshot, segment: Segment, now: number = this.clock()): boolean {
    const d = this.defs.get(segment);
    return !!d && d.enabled && d.matches(snapshot, now);
  }
}
