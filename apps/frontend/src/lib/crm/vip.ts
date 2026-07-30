/**
 * VIP program (Phase 6B, STEP 4).
 *
 * Configurable VIP levels + benefits with automatic upgrade/downgrade driven by
 * lifetime loyalty points, manual promotions/demotions, and full VIP history. Reads
 * loyalty state; owns no money. Benefits are descriptive — any monetary effect is
 * applied elsewhere (Operations/Treasury), never here.
 */
import { type LoyaltyEngine } from './loyalty';
import { type VipBenefit, type VipHistoryEntry, type VipLevelDef, type VipStatus } from './types';

const DEFAULT_VIP_LEVELS: VipLevelDef[] = [
  { level: 0, name: 'Standard', minPoints: 0, benefits: [] },
  { level: 1, name: 'Bronze', minPoints: 500, benefits: [{ code: 'cashback', description: '2% cashback', value: 200 }] },
  { level: 2, name: 'Silver', minPoints: 2_500, benefits: [{ code: 'cashback', description: '5% cashback', value: 500 }, { code: 'priority_withdrawal', description: 'Priority withdrawals' }] },
  { level: 3, name: 'Gold', minPoints: 10_000, benefits: [{ code: 'cashback', description: '8% cashback', value: 800 }, { code: 'host', description: 'Dedicated host' }] },
  { level: 4, name: 'Platinum', minPoints: 50_000, benefits: [{ code: 'cashback', description: '12% cashback', value: 1_200 }, { code: 'host', description: 'Dedicated host' }] },
];

export class VipService {
  private readonly levels: VipLevelDef[];
  private readonly current = new Map<string, number>();
  private readonly history = new Map<string, VipHistoryEntry[]>();

  constructor(
    private readonly loyalty: LoyaltyEngine,
    levels: VipLevelDef[] = DEFAULT_VIP_LEVELS,
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.levels = [...levels].sort((a, b) => a.level - b.level);
  }

  private def(level: number): VipLevelDef {
    return this.levels.find((l) => l.level === level) ?? this.levels[0]!;
  }
  private levelForPoints(points: number): number {
    let level = 0;
    for (const l of this.levels) if (points >= l.minPoints) level = l.level;
    return level;
  }
  private record(playerId: string, from: number, to: number, reason: string, manual: boolean, actor?: string): void {
    const list = this.history.get(playerId) ?? [];
    list.push({ from, to, at: this.clock(), reason, manual, actor });
    this.history.set(playerId, list);
    this.current.set(playerId, to);
  }

  level(playerId: string): number {
    return this.current.get(playerId) ?? 0;
  }

  /** Re-evaluate a player's tier from lifetime points (auto up/downgrade). */
  evaluate(playerId: string): number {
    const points = this.loyalty.account(playerId).lifetimePoints;
    const target = this.levelForPoints(points);
    const cur = this.level(playerId);
    if (target > cur) this.record(playerId, cur, target, `auto-upgrade @ ${points} pts`, false);
    else if (target < cur) this.record(playerId, cur, target, `auto-downgrade @ ${points} pts`, false);
    return this.level(playerId);
  }

  /** Manual promotion/demotion (audited, flagged manual). */
  setLevel(playerId: string, level: number, actor: string, reason: string): number {
    const cur = this.level(playerId);
    if (level !== cur) this.record(playerId, cur, level, reason, true, actor);
    return level;
  }

  benefits(playerId: string): VipBenefit[] {
    return this.def(this.level(playerId)).benefits;
  }

  status(playerId: string): VipStatus {
    const level = this.level(playerId);
    const def = this.def(level);
    return { playerId, level, name: def.name, benefits: def.benefits, history: [...(this.history.get(playerId) ?? [])] };
  }
}
