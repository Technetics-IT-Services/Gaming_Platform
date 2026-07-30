import { describe, expect, it } from 'vitest';

import { Ledger, TransactionType, WalletService } from '@/lib/ledger';
import { TreasuryEngine, WithdrawalService } from '@/lib/treasury';
import { ComplianceService } from '@/lib/compliance';
import { OperationsService, Role } from '@/lib/operations';

import { BonusEngine } from './bonus';
import { CRMService } from './crm-service';
import { LoyaltyEngine } from './loyalty';
import { MockNotificationProvider, NotificationService } from './notifications';
import { operationsInsightPort } from './ports';
import { PromotionEngine } from './promotions';
import { ReferralProgram } from './referral';
import { CrmAccessDeniedError, CrmRBAC, CrmPermission, maskContact } from './security';
import { SegmentationEngine } from './segmentation';
import { BonusStatus, BonusType, Channel, CodeKind, LoyaltyEventType, ReferralStatus, Segment } from './types';
import { VipService } from './vip';

/**
 * CRM, Loyalty & Marketing platform (Phase 6B). Verifies segmentation, loyalty
 * (points/levels/expiry), VIP progression, the LOGICAL bonus engine (no ledger),
 * promotions, notifications, referrals, the unified timeline and RBAC — all read-
 * only over the frozen services (no money moves anywhere in these tests).
 */

let CLK = 1_700_000_000_000;
const clock = () => (CLK += 1_000);

const SUPER: { actor: string; roles: Role[] } = { actor: 'root', roles: [Role.SuperAdmin] };

describe('security', () => {
  it('CRM RBAC integrates operations roles + denies by default', () => {
    const rbac = new CrmRBAC();
    expect(rbac.can([Role.SuperAdmin], CrmPermission.BonusGrant)).toBe(true);
    expect(rbac.can([Role.Support], CrmPermission.BonusGrant)).toBe(false);
    expect(rbac.can([Role.Support], CrmPermission.ProfileView)).toBe(true);
    expect(rbac.can([], CrmPermission.ProfileView)).toBe(false);
  });
  it('masks contact PII', () => {
    expect(maskContact('alice@example.com')).toBe('al***@example.com');
    expect(maskContact('+91 98765 43210')).toMatch(/\*+3210$/);
  });
});

describe('segmentation', () => {
  it('classifies configurable segments', () => {
    const seg = new SegmentationEngine(undefined, clock);
    const base = { playerId: 'p', withdrawalTotal: 0, balance: 0, vipLevel: 0, loyaltyPoints: 0, accountStatus: 'active', riskFlags: [] as string[] };
    expect(seg.evaluate({ ...base, depositTotal: 600_000 }, CLK)).toContain(Segment.HighValue);
    expect(seg.evaluate({ ...base, depositTotal: 0, riskFlags: ['FRAUD_HIGH'] }, CLK)).toContain(Segment.AtRisk);
    expect(seg.evaluate({ ...base, depositTotal: 0, accountStatus: 'self_excluded' }, CLK)).toEqual(expect.arrayContaining([Segment.SelfExcluded, Segment.ResponsibleGaming]));
    expect(seg.evaluate({ ...base, depositTotal: 0, vipLevel: 2 }, CLK)).toContain(Segment.VIP);
  });
});

describe('loyalty engine', () => {
  it('earns points, accrues XP, levels up and keeps history', () => {
    const l = new LoyaltyEngine(undefined, clock);
    l.earn('p', 100, 'signup');
    l.earn('p', 450, 'play');
    const a = l.account('p');
    expect(a.points).toBe(550);
    expect(a.level).toBeGreaterThanOrEqual(2); // 550 xp ≥ 500 threshold
    expect(a.levelHistory.length).toBeGreaterThan(0);
    expect(l.history('p')[0]!.type).toBe(LoyaltyEventType.Earn);
  });
  it('redeems, manually adjusts, and expires points', () => {
    let t = 1_000;
    const l = new LoyaltyEngine(undefined, () => t);
    l.earn('p', 1_000, 'x', { expiresAt: 5_000 });
    l.redeem('p', 200, 'reward');
    expect(l.account('p').points).toBe(800);
    l.adjust('p', -100, 'correction', 'admin');
    expect(l.account('p').points).toBe(700);
    t = 6_000;
    const expired = l.expire('p');
    expect(expired).toBeGreaterThan(0);
  });
});

describe('VIP program', () => {
  it('auto-upgrades from loyalty points and supports manual promotion + history', () => {
    const l = new LoyaltyEngine(undefined, clock);
    const vip = new VipService(l, undefined, clock);
    l.earn('p', 3_000, 'play');
    expect(vip.evaluate('p')).toBe(2); // ≥ 2500 → Silver
    expect(vip.benefits('p').some((b) => b.code === 'priority_withdrawal')).toBe(true);
    vip.setLevel('p', 4, 'host', 'manual VIP');
    expect(vip.level('p')).toBe(4);
    expect(vip.status('p').history.some((h) => h.manual)).toBe(true);
  });
});

describe('bonus engine (logical only — no ledger)', () => {
  it('grants a bonus, tracks wagering to completion with audit', () => {
    const b = new BonusEngine({}, clock);
    const bonus = b.grant({ playerId: 'p', type: BonusType.Deposit, amount: 1_000 });
    expect(bonus.status).toBe(BonusStatus.Active);
    expect(bonus.wageringRequired).toBe(25_000); // 25×
    b.recordWager(bonus.id, 10_000);
    expect(b.get(bonus.id).status).toBe(BonusStatus.Wagering);
    b.recordWager(bonus.id, 20_000);
    expect(b.get(bonus.id).status).toBe(BonusStatus.Completed);
    expect(b.auditTrail('p').some((r) => r.action === 'complete')).toBe(true);
    expect(b.logicalBalance('p')).toBe(0); // completed no longer counts as live
  });
  it('expires and forfeits bonuses; rejects illegal transitions', () => {
    let t = 1_000;
    const b = new BonusEngine({}, () => t);
    const bonus = b.grant({ playerId: 'p', type: BonusType.Welcome, amount: 500, expiresAt: 2_000 });
    t = 3_000;
    expect(b.expire()).toBe(1);
    expect(b.get(bonus.id).status).toBe(BonusStatus.Expired);
    expect(() => b.recordWager(bonus.id, 100)).toThrow();
  });
});

describe('promotion engine', () => {
  it('gates campaigns by segment + schedule and redeems codes with limits', () => {
    const t = 1_000;
    const promo = new PromotionEngine(() => t);
    promo.createCampaign({ id: 'c1', name: 'VIP week', schedule: {}, enabled: true, segments: [Segment.VIP] });
    expect(promo.eligibleCampaigns([Segment.VIP])).toHaveLength(1);
    expect(promo.eligibleCampaigns([Segment.NewPlayer])).toHaveLength(0);

    promo.createCode({ code: 'WELCOME', kind: CodeKind.Promo, reward: { kind: 'bonus', value: 100 }, maxRedemptions: 1, redemptions: 0, schedule: {}, enabled: true });
    expect(promo.redeemCode('welcome', 'p1').ok).toBe(true);
    expect(promo.redeemCode('welcome', 'p2').ok).toBe(false); // exhausted
  });
  it('advances challenges to completion', () => {
    const promo = new PromotionEngine(() => 1_000);
    promo.createChallenge({ id: 'ch', name: 'Play 3', target: 3, reward: { kind: 'points', value: 50 }, schedule: {}, daily: true });
    promo.advanceChallenge('ch', 'p', 2);
    const done = promo.advanceChallenge('ch', 'p', 1);
    expect(done.completed).toBe(true);
    expect(done.reward?.value).toBe(50);
  });
});

describe('notification framework', () => {
  it('renders templates, respects opt-out, and records history', async () => {
    const email = new MockNotificationProvider(Channel.Email);
    const svc = new NotificationService([email], {
      contacts: () => 'user@x.com',
      preferences: (p) => (p === 'optout' ? { email: false, sms: true, push: true, inApp: true } : { email: true, sms: true, push: true, inApp: true }),
      clock,
    });
    svc.registerTemplate({ id: 'welcome', channel: Channel.Email, subject: 'Hi', body: 'Hello {{name}}!' });
    const sent = await svc.send('p', 'welcome', { name: 'Alice' });
    expect(sent.status).toBe('sent');
    expect(email.sent[0]!.body).toBe('Hello Alice!');
    const suppressed = await svc.send('optout', 'welcome');
    expect(suppressed.status).toBe('suppressed');
  });
  it('dispatches scheduled jobs when due', async () => {
    let t = 0;
    const svc = new NotificationService([new MockNotificationProvider(Channel.Push)], { contacts: () => 'dev', clock: () => t });
    svc.registerTemplate({ id: 'ping', channel: Channel.Push, body: 'ping' });
    svc.schedule('p', 'ping', 100);
    t = 50;
    expect(await svc.runDue()).toHaveLength(0);
    t = 150;
    expect(await svc.runDue()).toHaveLength(1);
  });
});

describe('referral program', () => {
  it('mints codes, attributes signups, builds a tree, rewards qualified referrals', () => {
    const ref = new ReferralProgram({ referrerReward: 500, refereeReward: 250 }, undefined, clock);
    const code = ref.codeFor('alice');
    expect(ref.linkFor('alice')).toContain(code);
    const r = ref.signUp(code, 'bob');
    expect(r.status).toBe(ReferralStatus.Signed);
    expect(() => ref.signUp(code, 'alice')).toThrow(/self-referral/);
    ref.qualify(r.id);
    const reward = ref.reward(r.id);
    expect(reward.referrerReward).toBe(500);
    expect(ref.status(r.id)).toBe(ReferralStatus.Rewarded);
    expect(ref.tree('alice').referrals[0]!.playerId).toBe('bob');
  });
});

/* --------------------- facade + operations integration -------------------- */

function fullStack() {
  const ledger = new Ledger();
  const wallet = new WalletService(ledger, 'INR');
  const treasury = new TreasuryEngine(ledger);
  const compliance = ComplianceService.create({ clock });
  const withdrawals = new WithdrawalService(wallet, treasury, { async payout() { return { ok: true }; } }, { limits: { min: 1, perTransaction: 1e9, dailyMax: 1e9 }, clock });
  const ops = new OperationsService({ wallet, withdrawals, compliance, clock });
  wallet.credit('p1', 600_000, { type: TransactionType.Deposit });
  ops.registerPlayer({ playerId: 'p1', username: 'alice', registeredAt: CLK });
  const crm = new CRMService({ insight: operationsInsightPort(ops), clock, operationsTimeline: (id) => ops.players.timeline(id) });
  return { wallet, ops, crm };
}

describe('CRMService facade', () => {
  it('consumes operations data for segmentation (read-only)', () => {
    const { crm, wallet } = fullStack();
    const before = wallet.getBalance('p1').total;
    const segments = crm.getSegments(SUPER, 'p1');
    expect(segments).toContain(Segment.HighValue); // 600k deposit
    expect(wallet.getBalance('p1').total).toBe(before); // CRM moved no money
  });

  it('enforces RBAC and audits allow + deny', () => {
    const { crm } = fullStack();
    const support = { actor: 'sup', roles: [Role.Support] };
    expect(() => crm.grantBonus(support, { playerId: 'p1', type: BonusType.Manual, amount: 100 })).toThrow(CrmAccessDeniedError);
    crm.getProfile(support, 'p1'); // allowed for Support
    expect(crm.audit.query({ actor: 'sup' }).some((r) => !r.allowed)).toBe(true);
    expect(crm.audit.query({ actor: 'sup' }).some((r) => r.allowed)).toBe(true);
  });

  it('grants a logical bonus without touching the wallet/ledger', () => {
    const { crm, wallet } = fullStack();
    const before = wallet.getBalance('p1');
    const bonus = crm.grantBonus(SUPER, { playerId: 'p1', type: BonusType.Welcome, amount: 5_000 });
    expect(bonus.status).toBe(BonusStatus.Active);
    expect(crm.listBonuses(SUPER, 'p1')).toHaveLength(1);
    expect(wallet.getBalance('p1')).toEqual(before); // ZERO ledger impact
  });

  it('awards loyalty points which drive VIP progression', () => {
    const { crm } = fullStack();
    crm.awardPoints(SUPER, 'p1', 3_000, 'promo');
    expect(crm.getVip(SUPER, 'p1').level).toBe(2);
  });

  it('builds a unified timeline across sources', () => {
    const { crm, ops } = fullStack();
    ops.suspendPlayer(SUPER, 'p1', 'review'); // operations-sourced account event
    crm.grantBonus(SUPER, { playerId: 'p1', type: BonusType.Manual, amount: 100 });
    const tl = crm.getTimeline(SUPER, 'p1');
    const sources = new Set(tl.map((e) => e.source));
    expect(sources.has('bonus')).toBe(true);
    expect(sources.has('account')).toBe(true);
    expect(tl[0]!.at).toBeGreaterThanOrEqual(tl[tl.length - 1]!.at); // newest first
  });
});
