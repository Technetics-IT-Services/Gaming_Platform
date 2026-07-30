/**
 * Bonus engine (Phase 6B, STEP 5).
 *
 * A LOGICAL bonus wallet: welcome / deposit / cashback / free-spins / loss / manual
 * bonuses with wagering requirements, status lifecycle, expiration and a full audit
 * trail. **No ledger changes** — bonus amounts are logical engagement units, never
 * posted to the wallet/ledger. Converting a completed bonus to real cash is an
 * Operations/Treasury concern and is out of scope here (the engine only tracks it).
 */
import { BonusStatus, BonusType, type Bonus, type BonusAuditRecord } from './types';

const BONUS_TRANSITIONS: Record<BonusStatus, BonusStatus[]> = {
  [BonusStatus.Pending]: [BonusStatus.Active, BonusStatus.Cancelled, BonusStatus.Expired],
  [BonusStatus.Active]: [BonusStatus.Wagering, BonusStatus.Completed, BonusStatus.Cancelled, BonusStatus.Expired, BonusStatus.Forfeited],
  [BonusStatus.Wagering]: [BonusStatus.Completed, BonusStatus.Expired, BonusStatus.Forfeited, BonusStatus.Cancelled],
  [BonusStatus.Completed]: [],
  [BonusStatus.Expired]: [],
  [BonusStatus.Cancelled]: [],
  [BonusStatus.Forfeited]: [],
};

/** Default wagering multiple per bonus type (× amount). Configurable. */
const DEFAULT_WAGERING: Record<BonusType, number> = {
  [BonusType.Welcome]: 30,
  [BonusType.Deposit]: 25,
  [BonusType.Cashback]: 1,
  [BonusType.FreeSpins]: 20,
  [BonusType.Loss]: 10,
  [BonusType.Manual]: 1,
};

export class BonusEngine {
  private readonly bonuses = new Map<string, Bonus>();
  private readonly audit: BonusAuditRecord[] = [];

  constructor(
    private readonly wageringMultiples: Partial<Record<BonusType, number>> = {},
    private readonly clock: () => number = () => Date.now(),
  ) {}

  private id(): string {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return `bns_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  private log(b: Bonus, action: string, detail?: string, actor?: string): void {
    this.audit.push({ at: this.clock(), bonusId: b.id, playerId: b.playerId, action, status: b.status, detail, actor });
  }
  private transition(b: Bonus, to: BonusStatus): void {
    if (!BONUS_TRANSITIONS[b.status].includes(to)) throw new Error(`illegal bonus transition ${b.status} → ${to}`);
    b.status = to;
    b.updatedAt = this.clock();
  }

  /** Grant a logical bonus with a wagering requirement. Status begins Active. */
  grant(input: { playerId: string; type: BonusType; amount: number; expiresAt?: number; reason?: string; actor?: string; wageringMultiple?: number }): Bonus {
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error('bonus amount must be a positive integer');
    const multiple = input.wageringMultiple ?? this.wageringMultiples[input.type] ?? DEFAULT_WAGERING[input.type];
    const now = this.clock();
    const bonus: Bonus = {
      id: this.id(),
      playerId: input.playerId,
      type: input.type,
      amount: input.amount,
      status: BonusStatus.Active,
      wageringRequired: input.amount * multiple,
      wageringProgress: 0,
      grantedAt: now,
      expiresAt: input.expiresAt,
      updatedAt: now,
      reason: input.reason,
      actor: input.actor,
    };
    this.bonuses.set(bonus.id, bonus);
    this.log(bonus, 'grant', `${input.type} ${input.amount} (wr ${bonus.wageringRequired})`, input.actor);
    return bonus;
  }

  get(bonusId: string): Bonus {
    const b = this.bonuses.get(bonusId);
    if (!b) throw new Error('no such bonus');
    return b;
  }
  forPlayer(playerId: string): Bonus[] {
    return [...this.bonuses.values()].filter((b) => b.playerId === playerId);
  }

  /** Record wagering contribution; auto-completes when the requirement is met. */
  recordWager(bonusId: string, amount: number): Bonus {
    const b = this.get(bonusId);
    if (b.status === BonusStatus.Active) this.transition(b, BonusStatus.Wagering);
    if (b.status !== BonusStatus.Wagering) throw new Error(`bonus not wagering (${b.status})`);
    b.wageringProgress = Math.min(b.wageringRequired, b.wageringProgress + Math.max(0, amount));
    b.updatedAt = this.clock();
    this.log(b, 'wager', `${b.wageringProgress}/${b.wageringRequired}`);
    if (b.wageringProgress >= b.wageringRequired) {
      this.transition(b, BonusStatus.Completed);
      this.log(b, 'complete', 'wagering met');
    }
    return b;
  }

  cancel(bonusId: string, actor: string, reason: string): Bonus {
    const b = this.get(bonusId);
    this.transition(b, BonusStatus.Cancelled);
    b.reason = reason;
    this.log(b, 'cancel', reason, actor);
    return b;
  }
  forfeit(bonusId: string, actor: string, reason: string): Bonus {
    const b = this.get(bonusId);
    this.transition(b, BonusStatus.Forfeited);
    b.reason = reason;
    this.log(b, 'forfeit', reason, actor);
    return b;
  }

  /** Expire active bonuses past their `expiresAt` (sweep). */
  expire(now: number = this.clock()): number {
    let n = 0;
    for (const b of this.bonuses.values()) {
      if (b.expiresAt !== undefined && now >= b.expiresAt && BONUS_TRANSITIONS[b.status].includes(BonusStatus.Expired)) {
        this.transition(b, BonusStatus.Expired);
        this.log(b, 'expire', 'past expiry');
        n += 1;
      }
    }
    return n;
  }

  /** Total logical bonus balance for a player (active/wagering only). */
  logicalBalance(playerId: string): number {
    return this.forPlayer(playerId)
      .filter((b) => b.status === BonusStatus.Active || b.status === BonusStatus.Wagering)
      .reduce((s, b) => s + b.amount, 0);
  }

  auditTrail(playerId?: string): BonusAuditRecord[] {
    return this.audit.filter((r) => !playerId || r.playerId === playerId);
  }
}
