/**
 * CRM, Loyalty & Marketing platform contracts (Phase 6B).
 *
 * An enterprise player-engagement layer: `Player → CRM → Marketing → Operations
 * APIs → Platform Services`. It **consumes** existing services read-only and **never
 * owns money** — the bonus "wallet" is a LOGICAL construct (status + wagering
 * tracking), never the ledger. No financial/gameplay system is modified.
 * Framework-agnostic (no React). All amounts are integer minor/logical units.
 */

/* ------------------------------- CRM core --------------------------------- */

export enum LifecycleStage {
  Lead = 'lead',
  New = 'new',
  Active = 'active',
  Dormant = 'dormant',
  Churned = 'churned',
  Reactivated = 'reactivated',
}

export interface PlayerPreferences {
  /** Per-channel marketing opt-in. */
  email: boolean;
  sms: boolean;
  push: boolean;
  inApp: boolean;
  locale?: string;
  timezone?: string;
}

export interface PlayerProfile {
  playerId: string;
  displayName?: string;
  /** Masked contact fields (never raw PII). */
  emailMasked?: string;
  phoneMasked?: string;
  tags: string[];
  lifecycle: LifecycleStage;
  preferences: PlayerPreferences;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

/* ----------------------------- segmentation ------------------------------- */

export enum Segment {
  VIP = 'vip',
  HighValue = 'high_value',
  NewPlayer = 'new_player',
  Dormant = 'dormant',
  Active = 'active',
  AtRisk = 'at_risk',
  SelfExcluded = 'self_excluded',
  ResponsibleGaming = 'responsible_gaming',
}

/** A read-only snapshot of a player, assembled from existing services. */
export interface PlayerSnapshot {
  playerId: string;
  depositTotal: number;
  withdrawalTotal: number;
  balance: number;
  vipLevel: number;
  loyaltyPoints: number;
  registeredAt?: number;
  lastActivityAt?: number;
  accountStatus: string;
  riskFlags: string[];
}

export interface SegmentDefinition {
  segment: Segment;
  description: string;
  enabled: boolean;
  /** Pure predicate over a snapshot + clock. Configurable — no code change to tune. */
  matches: (snapshot: PlayerSnapshot, now: number) => boolean;
}

/* ------------------------------- loyalty ---------------------------------- */

export enum LoyaltyEventType {
  Earn = 'earn',
  Redeem = 'redeem',
  Adjust = 'adjust',
  Expire = 'expire',
}
export interface PointEntry {
  id: string;
  type: LoyaltyEventType;
  points: number;
  reason: string;
  at: number;
  expiresAt?: number;
  actor?: string;
}
export interface LevelChange {
  from: number;
  to: number;
  at: number;
  reason: string;
}
export interface LoyaltyAccount {
  playerId: string;
  points: number;
  lifetimePoints: number;
  level: number;
  xp: number;
  history: PointEntry[];
  levelHistory: LevelChange[];
}
export interface LoyaltyReward {
  id: string;
  name: string;
  cost: number;
  kind: string;
}

/* --------------------------------- VIP ------------------------------------ */

export interface VipBenefit {
  code: string;
  description: string;
  /** e.g. cashback bps, withdrawal-priority, dedicated host — opaque value. */
  value?: number;
}
export interface VipLevelDef {
  level: number;
  name: string;
  /** Minimum lifetime loyalty points to hold this level. */
  minPoints: number;
  benefits: VipBenefit[];
}
export interface VipHistoryEntry {
  from: number;
  to: number;
  at: number;
  reason: string;
  actor?: string;
  manual: boolean;
}
export interface VipStatus {
  playerId: string;
  level: number;
  name: string;
  benefits: VipBenefit[];
  history: VipHistoryEntry[];
}

/* -------------------------------- bonus ----------------------------------- */

export enum BonusType {
  Welcome = 'welcome',
  Deposit = 'deposit',
  Cashback = 'cashback',
  FreeSpins = 'free_spins',
  Loss = 'loss',
  Manual = 'manual',
}
export enum BonusStatus {
  Pending = 'pending',
  Active = 'active',
  Wagering = 'wagering',
  Completed = 'completed',
  Expired = 'expired',
  Cancelled = 'cancelled',
  Forfeited = 'forfeited',
}
export interface Bonus {
  id: string;
  playerId: string;
  type: BonusType;
  /** LOGICAL bonus units — never posted to the ledger. */
  amount: number;
  status: BonusStatus;
  /** Total wagering required (e.g. 30× amount) and progress toward it. */
  wageringRequired: number;
  wageringProgress: number;
  grantedAt: number;
  expiresAt?: number;
  updatedAt: number;
  reason?: string;
  actor?: string;
}
export interface BonusAuditRecord {
  at: number;
  bonusId: string;
  playerId: string;
  action: string;
  status: BonusStatus;
  detail?: string;
  actor?: string;
}

/* ------------------------------ promotions -------------------------------- */

export interface Schedule {
  startsAt?: number;
  endsAt?: number;
}
export interface Campaign {
  id: string;
  name: string;
  schedule: Schedule;
  enabled: boolean;
  /** Segments eligible for this campaign (empty ⇒ all). */
  segments: Segment[];
  reward?: { kind: string; value: number };
  metadata?: Record<string, unknown>;
}
export enum CodeKind {
  Coupon = 'coupon',
  Promo = 'promo',
}
export interface PromoCode {
  code: string;
  kind: CodeKind;
  campaignId?: string;
  reward: { kind: string; value: number };
  maxRedemptions?: number;
  perPlayerLimit?: number;
  redemptions: number;
  schedule: Schedule;
  enabled: boolean;
}
export interface Challenge {
  id: string;
  name: string;
  /** Target progress to complete (e.g. play 10 rounds). */
  target: number;
  reward: { kind: string; value: number };
  schedule: Schedule;
  /** Daily missions reset each day; challenges persist. */
  daily: boolean;
}

/* ----------------------------- notifications ------------------------------ */

export enum Channel {
  Email = 'email',
  SMS = 'sms',
  Push = 'push',
  InApp = 'in_app',
}
export interface NotificationTemplate {
  id: string;
  channel: Channel;
  subject?: string;
  /** Body with `{{var}}` placeholders. */
  body: string;
}
export interface INotificationProvider {
  readonly channel: Channel;
  send(input: { to: string; subject?: string; body: string }): Promise<{ ok: boolean; providerRef?: string; reason?: string }>;
}
export enum NotificationStatus {
  Queued = 'queued',
  Sent = 'sent',
  Failed = 'failed',
  Suppressed = 'suppressed',
}
export interface CommunicationRecord {
  id: string;
  playerId: string;
  channel: Channel;
  templateId?: string;
  subject?: string;
  status: NotificationStatus;
  providerRef?: string;
  at: number;
  scheduledFor?: number;
  detail?: string;
}

/* ------------------------------- referral --------------------------------- */

export enum ReferralStatus {
  Invited = 'invited',
  Signed = 'signed_up',
  Qualified = 'qualified',
  Rewarded = 'rewarded',
  Expired = 'expired',
}
export interface Referral {
  id: string;
  code: string;
  referrerId: string;
  refereeId?: string;
  status: ReferralStatus;
  createdAt: number;
  updatedAt: number;
  rewardGranted?: number;
}
export interface ReferralNode {
  playerId: string;
  referrals: ReferralNode[];
}

/* -------------------------------- timeline -------------------------------- */

export interface CrmTimelineEvent {
  at: number;
  source: string;
  type: string;
  detail: string;
  correlationId?: string;
}
