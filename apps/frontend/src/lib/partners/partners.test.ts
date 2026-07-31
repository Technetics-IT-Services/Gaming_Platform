import { describe, expect, it } from 'vitest';

import { Ledger, TransactionType, WalletService } from '@/lib/ledger';
import { TreasuryEngine, WithdrawalService } from '@/lib/treasury';
import { ComplianceService } from '@/lib/compliance';
import { OperationsService } from '@/lib/operations';

import { AffiliateService } from './affiliate-service';
import { CommissionEngine } from './commission-engine';
import { AgentHierarchy, HierarchyError } from './hierarchy';
import { operationsFinancialPort, type PlayerFinancialPort } from './ports';
import { PartnerPlatform } from './partner-platform';
import { PartnerReporting } from './reporting';
import { PartnerAccessDeniedError, PartnerRBAC, PartnerRole, PartnerPermission, type PartnerAuthContext } from './security';
import { WhiteLabelPlatform } from './white-label';
import {
  AttributionModel,
  CommissionModel,
  CommissionStatus,
  ConversionStatus,
  PartnerStatus,
  PartnerType,
} from './types';

/**
 * Partner, Affiliate & Multi-Tenant platform (Phase 6C). Verifies partner lifecycle,
 * agent hierarchy (depth + cycle detection), the LOGICAL commission engine (CPA/
 * rev-share/hybrid/tiered — no ledger), affiliate attribution, white-label tenant
 * resolution, reporting, RBAC and tenant isolation. No money moves anywhere.
 */

let CLK = 1_700_000_000_000;
const clock = () => (CLK += 1_000);

const OWNER = (tenantId: string, partnerId = 'root'): PartnerAuthContext => ({ actor: 'owner', roles: [PartnerRole.PartnerOwner], tenantId, partnerId });

const stubFin = (data: Record<string, { depositTotal: number; withdrawalTotal: number }> = {}): PlayerFinancialPort => ({
  financials: (playerId) => {
    const d = data[playerId] ?? { depositTotal: 0, withdrawalTotal: 0 };
    return { ...d, ngr: Math.max(0, d.depositTotal - d.withdrawalTotal) };
  },
});

describe('partner RBAC + tenant isolation', () => {
  it('grants by role and denies by default', () => {
    const rbac = new PartnerRBAC();
    expect(rbac.can([PartnerRole.PartnerOwner], PartnerPermission.CommissionAdjust)).toBe(true);
    expect(rbac.can([PartnerRole.Affiliate], PartnerPermission.CommissionAdjust)).toBe(false);
    expect(rbac.can([PartnerRole.Affiliate], PartnerPermission.AffiliateManage)).toBe(true);
    expect(rbac.can([PartnerRole.ReadOnly], PartnerPermission.PartnerManage)).toBe(false);
    expect(rbac.can([], PartnerPermission.PartnerView)).toBe(false);
  });

  it('isolates tenants — a partner cannot read another tenant\'s resource', () => {
    const platform = new PartnerPlatform({ financials: stubFin(), clock });
    const a = platform.createPartner(OWNER('tenant-A'), { type: PartnerType.Affiliate, name: 'A-aff' });
    const authB: PartnerAuthContext = { actor: 'b', roles: [PartnerRole.PartnerOwner], tenantId: 'tenant-B', partnerId: 'rootB' };
    expect(() => platform.getPartner(authB, a.id)).toThrow(PartnerAccessDeniedError);
    expect(platform.audit.query({ actor: 'b' }).some((r) => !r.allowed)).toBe(true);
  });
});

describe('partner lifecycle', () => {
  it('creates a partner and validates status transitions', () => {
    const platform = new PartnerPlatform({ financials: stubFin(), clock });
    const auth = OWNER('t1');
    const p = platform.createPartner(auth, { type: PartnerType.MasterAgent, name: 'Master' });
    expect(p.status).toBe(PartnerStatus.Pending);
    expect(platform.setPartnerStatus(auth, p.id, PartnerStatus.Active).status).toBe(PartnerStatus.Active);
    platform.setPartnerStatus(auth, p.id, PartnerStatus.Terminated);
    expect(() => platform.setPartnerStatus(auth, p.id, PartnerStatus.Active)).toThrow(); // terminal
  });
});

describe('agent hierarchy', () => {
  it('links master → sub → dealer, rejects cycles and depth overflow', () => {
    const h = new AgentHierarchy(3);
    h.addPartner('master', PartnerType.MasterAgent);
    h.addPartner('sub', PartnerType.SubAgent);
    h.addPartner('dealer', PartnerType.Dealer);
    h.link('sub', 'master');
    h.link('dealer', 'sub');
    expect(h.ancestors('dealer')).toEqual(['sub', 'master']);
    expect(h.descendants('master').sort()).toEqual(['dealer', 'sub']);
    // cycle: master under dealer
    expect(() => h.link('master', 'dealer')).toThrow(HierarchyError);
    // depth: a 4th level exceeds maxDepth 3
    h.addPartner('deep', PartnerType.Dealer);
    expect(() => h.link('deep', 'dealer')).toThrow(/depth/i);
  });

  it('rejects self-parenting and double-parenting', () => {
    const h = new AgentHierarchy();
    h.addPartner('a', PartnerType.SubAgent);
    h.addPartner('b', PartnerType.SubAgent);
    h.addPartner('c', PartnerType.SubAgent);
    expect(() => h.link('a', 'a')).toThrow();
    h.link('a', 'b');
    expect(() => h.link('a', 'c')).toThrow(/already has a parent/);
  });
});

describe('commission engine (logical only)', () => {
  it('computes CPA / rev-share / hybrid / tiered', () => {
    expect(CommissionEngine.compute({ id: 'p', name: 'cpa', model: CommissionModel.CPA, cpaAmount: 5_000 }, { conversions: 3 })).toBe(15_000);
    expect(CommissionEngine.compute({ id: 'p', name: 'rs', model: CommissionModel.RevShare, bps: 2_500 }, { ngr: 100_000 })).toBe(25_000);
    expect(CommissionEngine.compute({ id: 'p', name: 'hy', model: CommissionModel.Hybrid, cpaAmount: 1_000, bps: 1_000 }, { conversions: 2, ngr: 50_000 })).toBe(2_000 + 5_000);
    const tiered = { id: 'p', name: 't', model: CommissionModel.Tiered, tiers: [{ threshold: 0, bps: 1_000 }, { threshold: 100_000, bps: 3_000 }] };
    expect(CommissionEngine.compute(tiered, { volume: 50_000 })).toBe(5_000); // 10%
    expect(CommissionEngine.compute(tiered, { volume: 200_000 })).toBe(60_000); // 30%
  });

  it('accrues, approves, adjusts and summarizes without touching money', () => {
    const eng = new CommissionEngine(clock);
    eng.createPlan({ id: 'rs', name: 'rev', model: CommissionModel.RevShare, bps: 2_000 });
    const entry = eng.accrue('aff', 'rs', { ngr: 100_000 });
    expect(entry.amount).toBe(20_000);
    expect(entry.status).toBe(CommissionStatus.Pending);
    eng.approve(entry.id, 'admin');
    eng.adjust('aff', -5_000, 'admin', 'clawback');
    const s = eng.summary('aff');
    expect(s.total).toBe(15_000); // 20k approved − 5k adjustment
    expect(s.paid).toBe(0);
    expect(s.balance).toBe(15_000);
  });

  it('rejects illegal status transitions', () => {
    const eng = new CommissionEngine(clock);
    eng.createPlan({ id: 'f', name: 'fix', model: CommissionModel.Fixed, fixedAmount: 100 });
    const e = eng.accrue('aff', 'f', {});
    eng.approve(e.id, 'a');
    eng.markPaid(e.id, 'a');
    expect(() => eng.approve(e.id, 'a')).toThrow(); // paid is terminal
  });
});

describe('affiliate attribution', () => {
  it('tracks clicks, attributes players (last-click) and computes funnel stats', () => {
    const aff = new AffiliateService(undefined, clock);
    aff.register('aff1', AttributionModel.LastClick);
    const code = aff.createCode('aff1', { campaign: 'summer' }).code;
    expect(aff.link(code).url).toContain('ref=');
    const conv = aff.click(code);
    aff.attribute(conv.id, 'player1');
    aff.qualify(conv.id);
    expect(aff.attributionOf('player1')).toBe('aff1');
    expect(aff.playersFor('aff1')).toEqual(['player1']);
    expect(aff.campaignStats('aff1', 'summer')).toMatchObject({ clicks: 1, registrations: 1, qualified: 1 });
  });

  it('honors first-click attribution (keeps the first)', () => {
    const aff = new AffiliateService(undefined, clock);
    aff.register('a1', AttributionModel.FirstClick);
    aff.register('a2', AttributionModel.FirstClick);
    const c1 = aff.click(aff.createCode('a1').code);
    aff.attribute(c1.id, 'p');
    const c2 = aff.click(aff.createCode('a2').code);
    const second = aff.attribute(c2.id, 'p');
    expect(second.status).toBe(ConversionStatus.Rejected);
    expect(aff.attributionOf('p')).toBe('a1');
  });
});

describe('white-label platform', () => {
  it('creates tenants, maps domains, resolves by host and toggles flags', () => {
    const wl = new WhiteLabelPlatform(clock);
    const t = wl.createTenant({ partnerId: 'p1', brandName: 'BrandX', theme: { primaryColor: '#f00' }, localization: { defaultLocale: 'en', locales: ['en'], defaultCurrency: 'USD', currencies: ['USD'] }, domains: ['casino.brandx.com'] });
    expect(wl.resolveByHost('casino.brandx.com')!.id).toBe(t.id);
    expect(wl.resolveByHost('unknown.com')).toBeUndefined();
    wl.setFeatureFlag(t.id, 'live_casino', true);
    expect(wl.isFeatureEnabled(t.id, 'live_casino')).toBe(true);
    // a domain cannot be mapped to two tenants
    const t2 = wl.createTenant({ partnerId: 'p2', brandName: 'BrandY', theme: { primaryColor: '#0f0' }, localization: { defaultLocale: 'en', locales: ['en'], defaultCurrency: 'EUR', currencies: ['EUR'] } });
    expect(() => wl.mapDomain(t2.id, 'casino.brandx.com')).toThrow();
  });
});

/* ------------------------- full-stack integration ------------------------- */

function fullStack() {
  const ledger = new Ledger();
  const wallet = new WalletService(ledger, 'INR');
  const treasury = new TreasuryEngine(ledger);
  const compliance = ComplianceService.create({ clock });
  const withdrawals = new WithdrawalService(wallet, treasury, { async payout() { return { ok: true }; } }, { limits: { min: 1, perTransaction: 1e9, dailyMax: 1e9 }, clock });
  const ops = new OperationsService({ wallet, withdrawals, compliance, clock });
  wallet.credit('player1', 100_000, { type: TransactionType.Deposit });
  ops.registerPlayer({ playerId: 'player1' });
  const platform = new PartnerPlatform({ financials: operationsFinancialPort(ops), clock });
  return { wallet, ops, platform };
}

describe('reporting over operations data (read-only)', () => {
  it('computes revenue/LTV from operations financials without moving money', () => {
    const { platform, wallet } = fullStack();
    const auth = OWNER('t1');
    const aff = platform.createPartner(auth, { type: PartnerType.Affiliate, name: 'Aff' });
    platform.registerAffiliate(auth, aff.id);
    const conv = platform.recordConversion(auth, platform.createTrackingCode(auth, aff.id).code);
    platform.attributePlayer(auth, conv.id, 'player1');

    const before = wallet.getBalance('player1').total;
    const rev = platform.revenueReport(auth, aff.id);
    expect(rev.players).toBe(1);
    expect(rev.ngr).toBe(100_000); // deposits 100k, no withdrawals
    expect(rev.ltv).toBe(100_000);
    expect(wallet.getBalance('player1').total).toBe(before); // ZERO money impact
  });

  it('produces a partner dashboard + CSV export', () => {
    const { platform } = fullStack();
    const auth = OWNER('t1');
    const aff = platform.createPartner(auth, { type: PartnerType.Affiliate, name: 'Aff' });
    platform.createPlan(auth, { id: 'rs', name: 'rev', model: CommissionModel.RevShare, bps: 2_000 });
    platform.accrueCommission(auth, aff.id, 'rs', { ngr: 50_000 });
    const dash = platform.getDashboard(auth, aff.id);
    expect(dash.partner.name).toBe('Aff');
    expect(dash.commission.total).toBe(10_000);
    const csv = PartnerReporting.toCsv(platform.exportCommission(auth, aff.id));
    expect(csv.split('\n')[0]).toBe('at,model,amount,status,base,reason');
  });

  it('enforces RBAC on privileged partner actions', () => {
    const { platform } = fullStack();
    const auth = OWNER('t1');
    const aff = platform.createPartner(auth, { type: PartnerType.Affiliate, name: 'Aff' });
    const readOnly: PartnerAuthContext = { actor: 'ro', roles: [PartnerRole.ReadOnly], tenantId: 't1', partnerId: aff.id };
    expect(() => platform.adjustCommission(readOnly, aff.id, 100, 'x')).toThrow(PartnerAccessDeniedError);
    expect(() => platform.getDashboard(readOnly, aff.id)).not.toThrow(); // read allowed
  });
});
