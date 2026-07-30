/**
 * Referral program (Phase 6B, STEP 8).
 *
 * Referral codes + links, invites, a referral tree, configurable reward rules, status
 * lifecycle and history, with future affiliate hooks. Grants rewards through the CRM's
 * own engines (the caller wires loyalty/bonus) — it never moves money itself.
 */
import { type Referral, type ReferralNode, ReferralStatus } from './types';

export interface ReferralRewardRule {
  /** Logical reward granted to the referrer when a referee qualifies. */
  referrerReward: number;
  /** Logical reward granted to the referee. */
  refereeReward: number;
  /** Optional expiry for an outstanding invite (ms). */
  inviteTtlMs?: number;
}

export class ReferralProgram {
  private readonly codes = new Map<string, string>(); // code → referrerId
  private readonly playerCode = new Map<string, string>(); // referrerId → code
  private readonly referrals = new Map<string, Referral>(); // id → referral
  private readonly byReferrer = new Map<string, string[]>(); // referrerId → referral ids
  private readonly refereeOf = new Map<string, string>(); // refereeId → referrerId
  private seq = 0;

  constructor(
    private readonly rule: ReferralRewardRule,
    private readonly baseUrl = 'https://play.example.com/r',
    private readonly clock: () => number = () => Date.now(),
  ) {}

  private id(prefix: string): string {
    this.seq += 1;
    const bytes = new Uint8Array(5);
    crypto.getRandomValues(bytes);
    return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  /** Get or mint a referrer's stable referral code. */
  codeFor(referrerId: string): string {
    let code = this.playerCode.get(referrerId);
    if (!code) {
      code = this.id('ref').toUpperCase();
      this.playerCode.set(referrerId, code);
      this.codes.set(code, referrerId);
    }
    return code;
  }
  linkFor(referrerId: string): string {
    return `${this.baseUrl}/${this.codeFor(referrerId)}`;
  }

  /** Record an invite against a referrer's code (referee not yet signed up). */
  invite(code: string, opts?: { refereeHint?: string }): Referral {
    const referrerId = this.codes.get(code.toUpperCase());
    if (!referrerId) throw new Error('unknown referral code');
    const now = this.clock();
    const ref: Referral = { id: this.id('inv'), code: code.toUpperCase(), referrerId, status: ReferralStatus.Invited, createdAt: now, updatedAt: now };
    this.referrals.set(ref.id, ref);
    this.byReferrer.set(referrerId, [...(this.byReferrer.get(referrerId) ?? []), ref.id]);
    if (opts?.refereeHint) ref.refereeId = opts.refereeHint;
    return ref;
  }

  /** A referee signs up under a code (prevents self-referral and double-linking). */
  signUp(code: string, refereeId: string): Referral {
    const referrerId = this.codes.get(code.toUpperCase());
    if (!referrerId) throw new Error('unknown referral code');
    if (referrerId === refereeId) throw new Error('self-referral not allowed');
    if (this.refereeOf.has(refereeId)) throw new Error('referee already attributed');
    const now = this.clock();
    const ref: Referral = { id: this.id('rf'), code: code.toUpperCase(), referrerId, refereeId, status: ReferralStatus.Signed, createdAt: now, updatedAt: now };
    this.referrals.set(ref.id, ref);
    this.byReferrer.set(referrerId, [...(this.byReferrer.get(referrerId) ?? []), ref.id]);
    this.refereeOf.set(refereeId, referrerId);
    return ref;
  }

  /** Mark a referee qualified (e.g. first deposit) → eligible for reward. */
  qualify(referralId: string): Referral {
    const ref = this.referrals.get(referralId);
    if (!ref) throw new Error('no such referral');
    if (ref.status !== ReferralStatus.Signed) throw new Error(`cannot qualify from ${ref.status}`);
    ref.status = ReferralStatus.Qualified;
    ref.updatedAt = this.clock();
    return ref;
  }

  /**
   * Mark a qualified referral rewarded and return the (logical) reward amounts the
   * caller should grant via loyalty/bonus. This engine never grants money itself.
   */
  reward(referralId: string): { referral: Referral; referrerReward: number; refereeReward: number } {
    const ref = this.referrals.get(referralId);
    if (!ref) throw new Error('no such referral');
    if (ref.status !== ReferralStatus.Qualified) throw new Error(`cannot reward from ${ref.status}`);
    ref.status = ReferralStatus.Rewarded;
    ref.rewardGranted = this.rule.referrerReward;
    ref.updatedAt = this.clock();
    return { referral: ref, referrerReward: this.rule.referrerReward, refereeReward: this.rule.refereeReward };
  }

  history(referrerId: string): Referral[] {
    return (this.byReferrer.get(referrerId) ?? []).map((id) => this.referrals.get(id)!).filter(Boolean);
  }

  /** Build the referral tree rooted at a player (depth-bounded to avoid cycles). */
  tree(referrerId: string, maxDepth = 5): ReferralNode {
    const build = (playerId: string, depth: number): ReferralNode => {
      if (depth >= maxDepth) return { playerId, referrals: [] };
      const children = this.history(playerId)
        .filter((r) => r.refereeId && (r.status === ReferralStatus.Signed || r.status === ReferralStatus.Qualified || r.status === ReferralStatus.Rewarded))
        .map((r) => build(r.refereeId!, depth + 1));
      return { playerId, referrals: children };
    };
    return build(referrerId, 0);
  }

  status(referralId: string): ReferralStatus {
    return this.referrals.get(referralId)?.status ?? ReferralStatus.Expired;
  }
}
