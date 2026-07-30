/**
 * CRM service (Phase 6B, STEP 1 & 9) — the RBAC-enforced engagement facade.
 *
 * Owns player profiles, tags, preferences, lifecycle and communication history, and
 * composes the engagement engines (segmentation, loyalty, VIP, bonus, promotions,
 * notifications, referral). Every public call carries an Operations `AuthContext`, is
 * permission-checked BEFORE work and audited. It CONSUMES existing services read-only
 * (via `PlayerInsightPort`) and NEVER owns or moves money.
 */
import { type AuthContext } from '@/lib/operations';

import { BonusEngine } from './bonus';
import { LoyaltyEngine } from './loyalty';
import { NotificationService } from './notifications';
import { type PlayerInsightPort } from './ports';
import { PromotionEngine } from './promotions';
import { ReferralProgram, type ReferralRewardRule } from './referral';
import { CrmAccessDeniedError, CrmAudit, CrmPermission, CrmRBAC, maskContact } from './security';
import { SegmentationEngine } from './segmentation';
import {
  type Bonus,
  type BonusType,
  type Campaign,
  type Challenge,
  type CommunicationRecord,
  type CrmTimelineEvent,
  LifecycleStage,
  type LoyaltyAccount,
  type NotificationTemplate,
  type PlayerProfile,
  type PlayerPreferences,
  type PlayerSnapshot,
  type PromoCode,
  type Segment,
  type VipStatus,
} from './types';
import { VipService } from './vip';

export interface CRMServiceDeps {
  insight: PlayerInsightPort;
  rbac?: CrmRBAC;
  clock?: () => number;
  referralRule?: ReferralRewardRule;
  notifications?: NotificationService;
  /** Operations-sourced timeline (deposits/withdrawals/support/compliance). */
  operationsTimeline?: (playerId: string) => { at: number; source: string; type: string; detail: string; correlationId?: string }[];
}

const DEFAULT_PREFS: PlayerPreferences = { email: true, sms: true, push: true, inApp: true };

export class CRMService {
  readonly rbac: CrmRBAC;
  readonly audit = new CrmAudit();
  readonly segmentation: SegmentationEngine;
  readonly loyalty: LoyaltyEngine;
  readonly vip: VipService;
  readonly bonuses: BonusEngine;
  readonly promotions: PromotionEngine;
  readonly notifications: NotificationService;
  readonly referrals: ReferralProgram;

  private readonly profiles = new Map<string, PlayerProfile>();
  private readonly lastActivity = new Map<string, number>();
  private readonly campaignEvents = new Map<string, CrmTimelineEvent[]>();
  private readonly clock: () => number;
  private readonly insight: PlayerInsightPort;
  private readonly operationsTimeline?: CRMServiceDeps['operationsTimeline'];

  constructor(deps: CRMServiceDeps) {
    this.clock = deps.clock ?? (() => Date.now());
    this.rbac = deps.rbac ?? new CrmRBAC();
    this.insight = deps.insight;
    this.operationsTimeline = deps.operationsTimeline;
    this.segmentation = new SegmentationEngine(undefined, this.clock);
    this.loyalty = new LoyaltyEngine(undefined, this.clock);
    this.vip = new VipService(this.loyalty, undefined, this.clock);
    this.bonuses = new BonusEngine({}, this.clock);
    this.promotions = new PromotionEngine(this.clock);
    this.notifications = deps.notifications ?? new NotificationService([], { clock: this.clock });
    this.referrals = new ReferralProgram(deps.referralRule ?? { referrerReward: 500, refereeReward: 250 }, undefined, this.clock);
  }

  /* ------------------------------ enforcement ----------------------------- */

  private enforce<T>(auth: AuthContext, permission: CrmPermission, action: string, target: string | undefined, fn: () => T, detail?: string): T {
    try {
      this.rbac.assert(auth.actor, auth.roles, permission);
    } catch (e) {
      if (e instanceof CrmAccessDeniedError) this.audit.record({ at: this.clock(), actor: auth.actor, action, target, allowed: false, detail: `denied: ${permission}` });
      throw e;
    }
    const result = fn();
    this.audit.record({ at: this.clock(), actor: auth.actor, action, target, allowed: true, detail });
    return result;
  }

  /* -------------------------------- profiles ------------------------------ */

  private ensureProfile(playerId: string): PlayerProfile {
    let p = this.profiles.get(playerId);
    if (!p) {
      const now = this.clock();
      p = { playerId, tags: [], lifecycle: LifecycleStage.New, preferences: { ...DEFAULT_PREFS }, createdAt: now, updatedAt: now };
      this.profiles.set(playerId, p);
    }
    return p;
  }

  getProfile(auth: AuthContext, playerId: string): PlayerProfile {
    return this.enforce(auth, CrmPermission.ProfileView, 'profile.view', playerId, () => ({ ...this.ensureProfile(playerId) }));
  }

  updateProfile(auth: AuthContext, playerId: string, patch: { displayName?: string; email?: string; phone?: string; lifecycle?: LifecycleStage; metadata?: Record<string, unknown> }): PlayerProfile {
    return this.enforce(auth, CrmPermission.ProfileEdit, 'profile.edit', playerId, () => {
      const p = this.ensureProfile(playerId);
      if (patch.displayName !== undefined) p.displayName = patch.displayName;
      if (patch.email !== undefined) p.emailMasked = maskContact(patch.email); // never store raw PII
      if (patch.phone !== undefined) p.phoneMasked = maskContact(patch.phone);
      if (patch.lifecycle !== undefined) p.lifecycle = patch.lifecycle;
      if (patch.metadata !== undefined) p.metadata = { ...p.metadata, ...patch.metadata };
      p.updatedAt = this.clock();
      return { ...p };
    });
  }

  setPreferences(auth: AuthContext, playerId: string, prefs: Partial<PlayerPreferences>): PlayerProfile {
    return this.enforce(auth, CrmPermission.ProfileEdit, 'profile.preferences', playerId, () => {
      const p = this.ensureProfile(playerId);
      p.preferences = { ...p.preferences, ...prefs };
      p.updatedAt = this.clock();
      return { ...p };
    });
  }

  addTag(auth: AuthContext, playerId: string, tag: string): PlayerProfile {
    return this.enforce(auth, CrmPermission.TagManage, 'profile.tag.add', playerId, () => {
      const p = this.ensureProfile(playerId);
      if (!p.tags.includes(tag)) p.tags.push(tag);
      p.updatedAt = this.clock();
      return { ...p };
    }, tag);
  }
  removeTag(auth: AuthContext, playerId: string, tag: string): PlayerProfile {
    return this.enforce(auth, CrmPermission.TagManage, 'profile.tag.remove', playerId, () => {
      const p = this.ensureProfile(playerId);
      p.tags = p.tags.filter((t) => t !== tag);
      p.updatedAt = this.clock();
      return { ...p };
    }, tag);
  }

  /** Feed player activity (used by lifecycle + dormant/active segmentation). */
  recordActivity(playerId: string, at: number = this.clock()): void {
    this.lastActivity.set(playerId, at);
    const p = this.ensureProfile(playerId);
    if (p.lifecycle === LifecycleStage.Dormant || p.lifecycle === LifecycleStage.Churned) p.lifecycle = LifecycleStage.Reactivated;
    else if (p.lifecycle === LifecycleStage.New) p.lifecycle = LifecycleStage.Active;
  }

  /* ------------------------------- snapshots ------------------------------ */

  /** Compose a full snapshot from existing services + CRM engagement state. */
  snapshot(playerId: string): PlayerSnapshot {
    const base = this.insight.snapshot(playerId);
    return {
      playerId,
      depositTotal: base.depositTotal,
      withdrawalTotal: base.withdrawalTotal,
      balance: base.balance,
      vipLevel: this.vip.level(playerId),
      loyaltyPoints: this.loyalty.account(playerId).points,
      registeredAt: base.registeredAt,
      lastActivityAt: this.lastActivity.get(playerId),
      accountStatus: base.accountStatus,
      riskFlags: base.riskFlags,
    };
  }

  getSegments(auth: AuthContext, playerId: string): Segment[] {
    return this.enforce(auth, CrmPermission.SegmentView, 'segment.view', playerId, () => this.segmentation.evaluate(this.snapshot(playerId)));
  }

  /* -------------------------------- loyalty ------------------------------- */

  getLoyalty(auth: AuthContext, playerId: string): LoyaltyAccount {
    return this.enforce(auth, CrmPermission.LoyaltyView, 'loyalty.view', playerId, () => this.loyalty.account(playerId));
  }
  awardPoints(auth: AuthContext, playerId: string, points: number, reason: string) {
    return this.enforce(auth, CrmPermission.LoyaltyAdjust, 'loyalty.award', playerId, () => {
      const entry = this.loyalty.earn(playerId, points, reason);
      this.vip.evaluate(playerId);
      return entry;
    }, `${points}`);
  }
  adjustPoints(auth: AuthContext, playerId: string, points: number, reason: string) {
    return this.enforce(auth, CrmPermission.LoyaltyAdjust, 'loyalty.adjust', playerId, () => {
      const entry = this.loyalty.adjust(playerId, points, reason, auth.actor);
      this.vip.evaluate(playerId);
      return entry;
    }, `${points}`);
  }

  /* ---------------------------------- VIP --------------------------------- */

  getVip(auth: AuthContext, playerId: string): VipStatus {
    return this.enforce(auth, CrmPermission.VipView, 'vip.view', playerId, () => {
      this.vip.evaluate(playerId);
      return this.vip.status(playerId);
    });
  }
  promoteVip(auth: AuthContext, playerId: string, level: number, reason: string): VipStatus {
    return this.enforce(auth, CrmPermission.VipManage, 'vip.promote', playerId, () => {
      this.vip.setLevel(playerId, level, auth.actor, reason);
      return this.vip.status(playerId);
    }, `level ${level}`);
  }

  /* -------------------------------- bonuses ------------------------------- */

  grantBonus(auth: AuthContext, input: { playerId: string; type: BonusType; amount: number; expiresAt?: number; reason?: string }): Bonus {
    return this.enforce(auth, CrmPermission.BonusGrant, 'bonus.grant', input.playerId, () => this.bonuses.grant({ ...input, actor: auth.actor }), `${input.type} ${input.amount}`);
  }
  listBonuses(auth: AuthContext, playerId: string): Bonus[] {
    return this.enforce(auth, CrmPermission.BonusView, 'bonus.view', playerId, () => this.bonuses.forPlayer(playerId));
  }
  cancelBonus(auth: AuthContext, bonusId: string, reason: string): Bonus {
    return this.enforce(auth, CrmPermission.BonusGrant, 'bonus.cancel', bonusId, () => this.bonuses.cancel(bonusId, auth.actor, reason));
  }

  /* ------------------------------ promotions ------------------------------ */

  createCampaign(auth: AuthContext, campaign: Campaign): Campaign {
    return this.enforce(auth, CrmPermission.PromotionManage, 'promotion.campaign.create', campaign.id, () => this.promotions.createCampaign(campaign));
  }
  createCode(auth: AuthContext, code: PromoCode): PromoCode {
    return this.enforce(auth, CrmPermission.PromotionManage, 'promotion.code.create', code.code, () => this.promotions.createCode(code));
  }
  createChallenge(auth: AuthContext, challenge: Challenge): Challenge {
    return this.enforce(auth, CrmPermission.PromotionManage, 'promotion.challenge.create', challenge.id, () => this.promotions.createChallenge(challenge));
  }
  eligibleCampaigns(auth: AuthContext, playerId: string): Campaign[] {
    return this.enforce(auth, CrmPermission.PromotionView, 'promotion.eligible', playerId, () => this.promotions.eligibleCampaigns(this.segmentation.evaluate(this.snapshot(playerId))));
  }
  redeemCode(auth: AuthContext, code: string, playerId: string): { ok: boolean; reason?: string; reward?: PromoCode['reward'] } {
    return this.enforce(auth, CrmPermission.PromotionView, 'promotion.redeem', playerId, () => {
      const result = this.promotions.redeemCode(code, playerId);
      if (result.ok) {
        const list = this.campaignEvents.get(playerId) ?? [];
        list.push({ at: this.clock(), source: 'promotion', type: 'code_redeemed', detail: `${code}` });
        this.campaignEvents.set(playerId, list);
      }
      return result;
    }, code);
  }

  /* ----------------------------- notifications ---------------------------- */

  registerTemplate(auth: AuthContext, template: NotificationTemplate): void {
    this.enforce(auth, CrmPermission.NotificationTemplateManage, 'notification.template', template.id, () => this.notifications.registerTemplate(template));
  }
  async sendNotification(auth: AuthContext, playerId: string, templateId: string, vars?: Record<string, string>): Promise<CommunicationRecord> {
    this.rbac.assert(auth.actor, auth.roles, CrmPermission.NotificationSend);
    const rec = await this.notifications.send(playerId, templateId, vars);
    this.audit.record({ at: this.clock(), actor: auth.actor, action: 'notification.send', target: playerId, allowed: true, detail: `${templateId}:${rec.status}` });
    return rec;
  }
  communicationHistory(auth: AuthContext, playerId: string): CommunicationRecord[] {
    return this.enforce(auth, CrmPermission.ProfileView, 'notification.history', playerId, () => this.notifications.communicationHistory(playerId));
  }

  /* ------------------------------- referral ------------------------------- */

  getReferralLink(auth: AuthContext, playerId: string): { code: string; link: string } {
    return this.enforce(auth, CrmPermission.ReferralView, 'referral.link', playerId, () => ({ code: this.referrals.codeFor(playerId), link: this.referrals.linkFor(playerId) }));
  }
  /** Attribute a signup and, if qualified, grant the configured logical rewards. */
  qualifyReferral(auth: AuthContext, referralId: string): { referrerReward: number; refereeReward: number } {
    return this.enforce(auth, CrmPermission.ReferralManage, 'referral.reward', referralId, () => {
      this.referrals.qualify(referralId);
      const { referral, referrerReward, refereeReward } = this.referrals.reward(referralId);
      // Rewards are logical: granted via loyalty/bonus, never via the ledger.
      this.loyalty.earn(referral.referrerId, referrerReward, 'referral reward');
      if (referral.refereeId) this.loyalty.earn(referral.refereeId, refereeReward, 'referral welcome');
      return { referrerReward, refereeReward };
    });
  }

  /* -------------------------------- timeline ------------------------------ */

  getTimeline(auth: AuthContext, playerId: string): CrmTimelineEvent[] {
    return this.enforce(auth, CrmPermission.TimelineView, 'timeline.view', playerId, () => this.buildTimeline(playerId));
  }

  private buildTimeline(playerId: string): CrmTimelineEvent[] {
    const events: CrmTimelineEvent[] = [];
    // Operations-sourced (deposits/withdrawals/support/compliance).
    for (const e of this.operationsTimeline?.(playerId) ?? []) events.push({ at: e.at, source: e.source, type: e.type, detail: e.detail, correlationId: e.correlationId });
    // Bonuses.
    for (const b of this.bonuses.auditTrail(playerId)) events.push({ at: b.at, source: 'bonus', type: b.action, detail: `${b.status}` });
    // VIP.
    for (const h of this.vip.status(playerId).history) events.push({ at: h.at, source: 'vip', type: h.manual ? 'manual' : 'auto', detail: `L${h.from}→L${h.to}` });
    // Campaigns.
    for (const e of this.campaignEvents.get(playerId) ?? []) events.push(e);
    // Notifications.
    for (const c of this.notifications.communicationHistory(playerId)) events.push({ at: c.at, source: 'notification', type: c.channel, detail: c.status });
    return events.sort((a, b) => b.at - a.at);
  }
}
