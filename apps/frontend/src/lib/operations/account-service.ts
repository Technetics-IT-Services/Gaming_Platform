/**
 * Account operations (Phase 6A, STEP 4).
 *
 * Owns the operational account-state store (suspend / lock / self-exclude) with
 * reason tracking. This is operations-owned state — it never touches the wallet,
 * ledger or gameplay; the player platform may *consult* it, but nothing here moves
 * money or alters a frozen service. Every change carries a reason + actor for audit.
 */
import { AccountStatus, type AccountState } from './types';

export class AccountService {
  private readonly states = new Map<string, AccountState>();

  constructor(private readonly clock: () => number = () => Date.now()) {}

  get(playerId: string): AccountState {
    return this.states.get(playerId) ?? { playerId, status: AccountStatus.Active, updatedAt: 0 };
  }

  private set(playerId: string, status: AccountStatus, actor: string, reason?: string, until?: number): AccountState {
    const state: AccountState = { playerId, status, reason, until, updatedBy: actor, updatedAt: this.clock() };
    this.states.set(playerId, state);
    return state;
  }

  suspend(playerId: string, actor: string, reason: string): AccountState {
    return this.set(playerId, AccountStatus.Suspended, actor, reason);
  }
  unsuspend(playerId: string, actor: string, reason?: string): AccountState {
    return this.set(playerId, AccountStatus.Active, actor, reason);
  }
  /** Temporary lock with an optional expiry (epoch ms). */
  lock(playerId: string, actor: string, reason: string, until?: number): AccountState {
    return this.set(playerId, AccountStatus.Locked, actor, reason, until);
  }
  unlock(playerId: string, actor: string, reason?: string): AccountState {
    return this.set(playerId, AccountStatus.Active, actor, reason);
  }
  /** Responsible-gaming self-exclusion, optionally until a date. */
  exclude(playerId: string, actor: string, reason: string, until?: number): AccountState {
    return this.set(playerId, AccountStatus.SelfExcluded, actor, reason, until);
  }

  /** Effective status, auto-clearing expired temporary locks/exclusions. */
  effectiveStatus(playerId: string, now: number = this.clock()): AccountStatus {
    const s = this.get(playerId);
    if ((s.status === AccountStatus.Locked || s.status === AccountStatus.SelfExcluded) && s.until !== undefined && now >= s.until) {
      return AccountStatus.Active;
    }
    return s.status;
  }

  all(): AccountState[] {
    return [...this.states.values()];
  }
}
