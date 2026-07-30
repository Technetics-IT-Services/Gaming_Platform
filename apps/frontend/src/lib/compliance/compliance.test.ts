import { describe, expect, it } from 'vitest';

import { Ledger, TransactionType, WalletService } from '@/lib/ledger';
import { TreasuryEngine, WithdrawalService } from '@/lib/treasury';

import { DecisionEngine } from './decision-engine';
import { DeviceTrustService, MockDeviceProvider } from './device';
import { FraudEngine } from './fraud';
import { GeoService, MockGeoProvider } from './geo';
import { AMLService, MockAMLProvider } from './aml';
import { KYCService, MockKYCProvider } from './kyc';
import { defaultPolicyRules, PolicyEngine } from './policy-engine';
import { ComplianceService } from './compliance-service';
import {
  DecisionAction,
  DeviceRisk,
  GeoStatus,
  OperationType,
  RiskFlag,
  RiskLevel,
  VelocityKind,
  VerificationStatus,
} from './types';
import { VelocityControls } from './velocity';

/**
 * Risk & Compliance platform (Phase 5D). Verifies the decision engine's severity
 * combine, the configurable policy engine, KYC/AML/device adapters, fraud scoring,
 * velocity windows, geofencing, audit coverage, and the Treasury integration —
 * where a non-approval provably stops money movement (no ledger posting occurs).
 */

let CLK = 1_700_000_000_000;
const clock = () => (CLK += 1_000);

describe('decision engine — severity combine', () => {
  it('takes the most severe action and approves when nothing fires', () => {
    const policy = new PolicyEngine([]);
    const engine = new DecisionEngine(policy);
    const approve = engine.evaluate({ operation: OperationType.Deposit, playerId: 'p' }, {}, 1, 'c1');
    expect(approve.action).toBe(DecisionAction.Approve);
    expect(approve.allowed).toBe(true);

    expect(DecisionEngine.combine([
      { code: 'A', message: '', severity: DecisionAction.ManualReview, source: 'x' },
      { code: 'B', message: '', severity: DecisionAction.Reject, source: 'y' },
      { code: 'C', message: '', severity: DecisionAction.Hold, source: 'z' },
    ])).toBe(DecisionAction.Reject);
  });

  it('blends a risk score dominated by the worst signal', () => {
    const score = DecisionEngine.riskScore({
      fraud: { score: 80, level: RiskLevel.Critical, signals: [] },
      aml: { playerId: 'p', sanctions: { hit: false, lists: [] }, pep: { hit: false }, watchlist: { hit: false, sources: [] }, flags: [], riskLevel: RiskLevel.Low, provider: 'm', checkedAt: 0 },
    });
    expect(score).toBeGreaterThanOrEqual(60);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('policy engine — configurable rules', () => {
  it('holds a withdrawal when KYC is not verified', () => {
    const policy = new PolicyEngine(defaultPolicyRules());
    const engine = new DecisionEngine(policy);
    const r = engine.evaluate(
      { operation: OperationType.Withdrawal, playerId: 'p', amount: 1000 },
      { kyc: { playerId: 'p', status: VerificationStatus.Unverified, document: 'missing' as never, identity: 'unknown' as never, level: 0, provider: 'm', checkedAt: 0 } },
      1,
      'c',
    );
    expect(r.action).toBe(DecisionAction.Hold);
    expect(r.reasons.map((x) => x.code)).toContain('KYC_REQUIRED');
  });

  it('supports runtime add / toggle / remove of rules', () => {
    const policy = new PolicyEngine();
    policy.set({ id: 'block-all', description: 'test', enabled: true, evaluate: () => ({ code: 'X', message: 'no', severity: DecisionAction.Reject, source: 'policy' }) });
    const engine = new DecisionEngine(policy);
    expect(engine.evaluate({ operation: OperationType.Deposit, playerId: 'p' }, {}, 1, 'c').action).toBe(DecisionAction.Reject);
    policy.toggle('block-all', false);
    expect(engine.evaluate({ operation: OperationType.Deposit, playerId: 'p' }, {}, 1, 'c').action).toBe(DecisionAction.Approve);
    policy.remove('block-all');
    expect(policy.list()).toHaveLength(0);
  });

  it('exempts VIPs from high-value manual review', () => {
    const policy = new PolicyEngine(defaultPolicyRules({ highValueAmount: 100 }));
    const engine = new DecisionEngine(policy);
    const normal = engine.evaluate({ operation: OperationType.Withdrawal, playerId: 'p', amount: 200, attributes: { vip: false } }, { kyc: verifiedKyc('p') }, 1, 'c');
    expect(normal.action).toBe(DecisionAction.ManualReview);
    const vip = engine.evaluate({ operation: OperationType.Withdrawal, playerId: 'p', amount: 200, attributes: { vip: true } }, { kyc: verifiedKyc('p') }, 1, 'c');
    expect(vip.action).toBe(DecisionAction.Approve);
  });
});

function verifiedKyc(playerId: string) {
  return { playerId, status: VerificationStatus.Verified, document: 'approved' as never, identity: 'matched' as never, level: 2, provider: 'm', checkedAt: 0 };
}

describe('KYC framework', () => {
  it('caches provider results and defaults to Unverified', async () => {
    const svc = new KYCService(new MockKYCProvider({ p2: { status: VerificationStatus.Rejected } }, clock), clock);
    expect(svc.get('p1').status).toBe(VerificationStatus.Unverified); // no data yet
    await svc.refresh('p1');
    expect(svc.isVerified('p1')).toBe(true);
    await svc.refresh('p2');
    expect(svc.get('p2').status).toBe(VerificationStatus.Rejected);
  });
});

describe('AML framework', () => {
  it('flags sanctions/PEP/watchlist and high-risk jurisdictions', async () => {
    const svc = new AMLService(new MockAMLProvider({ sanctioned: ['bad'], pep: ['vip'], watchlisted: ['wl'] }, clock), clock);
    expect((await svc.refresh('bad')).flags).toContain(RiskFlag.Sanctions);
    expect((await svc.refresh('bad')).riskLevel).toBe(RiskLevel.Critical);
    expect((await svc.refresh('vip')).flags).toContain(RiskFlag.PEP);
    expect((await svc.refresh('wl')).riskLevel).toBe(RiskLevel.High);
    expect((await svc.refresh('clean', { country: 'IR' })).flags).toContain(RiskFlag.HighRiskJurisdiction);
    expect(svc.get('clean').provider).toBe('mock-aml');
  });
});

describe('fraud engine', () => {
  it('scores velocity, duplicate accounts, bad devices and impossible travel', () => {
    const engine = new FraudEngine();
    const score = engine.score(
      { operation: OperationType.Withdrawal, playerId: 'p' },
      {
        velocity: [{ kind: VelocityKind.Withdrawal, count: 6, limit: 3, windowMs: 1000, exceeded: true }],
        device: { risk: DeviceRisk.Suspicious, reputation: { vpn: true, tor: false, ipReputation: 20 }, trusted: false },
        linkedAccounts: 3,
        recentCountries: ['IN', 'RU'],
      },
    );
    expect(score.score).toBeGreaterThan(50);
    expect(score.level === RiskLevel.High || score.level === RiskLevel.Critical).toBe(true);
    expect(score.signals.map((s) => s.code)).toEqual(expect.arrayContaining(['RAPID_WITHDRAWAL', 'DUPLICATE_ACCOUNT', 'BAD_DEVICE_REPUTATION', 'IMPOSSIBLE_TRAVEL']));
  });

  it('a clean context scores Low', () => {
    const engine = new FraudEngine();
    expect(engine.score({ operation: OperationType.Deposit, playerId: 'p' }, { velocity: [] }).level).toBe(RiskLevel.Low);
  });

  it('exposes an ML integration point', () => {
    const engine = new FraudEngine({}, { name: 'ml', score: () => [{ code: 'ML_ANOMALY', weight: 90 }] });
    expect(engine.score({ operation: OperationType.Bet, playerId: 'p' }, { velocity: [] }).level).toBe(RiskLevel.Critical);
  });
});

describe('device trust', () => {
  it('derives risk bands (Tor blocked, VPN suspicious, clean trusted)', async () => {
    const svc = new DeviceTrustService(new MockDeviceProvider({ vpnIps: ['1.1.1.1'], torIps: ['9.9.9.9'] }), clock);
    expect((await svc.assess({ id: 'd1', ip: '9.9.9.9' })).risk).toBe(DeviceRisk.Blocked);
    expect((await svc.assess({ id: 'd2', ip: '1.1.1.1' })).risk).toBe(DeviceRisk.Suspicious);
    expect((await svc.assess({ id: 'd3', ip: '2.2.2.2' })).risk).toBe(DeviceRisk.Trusted); // clean rep 90
    svc.trust('p', 'd4');
    expect((await svc.assess({ id: 'd4', ip: '2.2.2.2', playerId: 'p' })).trusted).toBe(true);
  });
});

describe('geofencing', () => {
  it('blocks/restricts/allows by country and state', () => {
    const geo = new GeoService({ blockedCountries: ['KP'], restrictedStates: { US: ['NJ'] } });
    expect(geo.classify({ country: 'KP' }).status).toBe(GeoStatus.Blocked);
    expect(geo.classify({ country: 'US', state: 'NY' }).status).toBe(GeoStatus.Restricted);
    expect(geo.classify({ country: 'US', state: 'NJ' }).status).toBe(GeoStatus.Allowed);
    expect(geo.classify({ country: 'IN' }).status).toBe(GeoStatus.Allowed);
    expect(geo.classify({}).status).toBe(GeoStatus.Unknown);
  });

  it('enforces an allow-list and a timezone-consistency hook', async () => {
    const geo = new GeoService({ allowedCountries: ['IN'] }, new MockGeoProvider({ '5.5.5.5': { country: 'DE', ip: '5.5.5.5' } }));
    expect(geo.classify(await geo.locate('5.5.5.5')).status).toBe(GeoStatus.Blocked);
    expect(geo.timezoneConsistent({ country: 'IN', timezone: 'Asia/Kolkata' }, { IN: 'Asia/' })).toBe(true);
    expect(geo.timezoneConsistent({ country: 'IN', timezone: 'Europe/Berlin' }, { IN: 'Asia/' })).toBe(false);
  });
});

describe('velocity controls', () => {
  it('counts within a rolling window and flags exceeded limits', () => {
    let t = 0;
    const v = new VelocityControls([{ kind: VelocityKind.Deposit, max: 2, windowMs: 100 }], () => t);
    v.record('p', VelocityKind.Deposit, (t = 0));
    v.record('p', VelocityKind.Deposit, (t = 10));
    expect(v.check('p', VelocityKind.Deposit, 10)!.exceeded).toBe(false);
    v.record('p', VelocityKind.Deposit, (t = 20));
    expect(v.check('p', VelocityKind.Deposit, 20)!.exceeded).toBe(true);
    // window slides — old events fall out
    expect(v.check('p', VelocityKind.Deposit, 200)!.count).toBe(0);
  });
});

describe('compliance audit', () => {
  it('records every decision with full context and is queryable', () => {
    const svc = ComplianceService.create({ clock });
    svc.decide({ operation: OperationType.Deposit, playerId: 'p1', amount: 100 });
    svc.decide({ operation: OperationType.Withdrawal, playerId: 'p2', amount: 100 });
    expect(svc.audit.count()).toBe(2);
    expect(svc.audit.query({ playerId: 'p1' })).toHaveLength(1);
    const rec = svc.audit.query({ playerId: 'p1' })[0]!;
    expect(rec).toMatchObject({ operation: OperationType.Deposit, action: expect.any(String), kycStatus: expect.any(String) });
    expect(typeof rec.riskScore).toBe('number');
  });
});

describe('compliance service — end-to-end evaluate', () => {
  it('rejects a sanctioned player and audits it (async full path)', async () => {
    const svc = ComplianceService.create({ clock, amlSeed: { sanctioned: ['sanctioned-1'] } });
    const result = await svc.evaluate({ operation: OperationType.Withdrawal, playerId: 'sanctioned-1', amount: 1000 });
    expect(result.action).toBe(DecisionAction.Reject);
    expect(result.allowed).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain('AML_SANCTIONS');
  });

  it('approves a clean, verified player', async () => {
    const svc = ComplianceService.create({ clock });
    const result = await svc.evaluate({ operation: OperationType.Withdrawal, playerId: 'good', amount: 1000 });
    expect(result.allowed).toBe(true);
    expect(result.action).toBe(DecisionAction.Approve);
  });
});

describe('treasury integration (STEP 10) — risk evaluates, treasury executes', () => {
  function wire(gateSeed?: { amlSeed?: { sanctioned?: string[] }; kycSeed?: Record<string, { status: VerificationStatus }> }) {
    const ledger = new Ledger();
    const wallet = new WalletService(ledger, 'INR');
    const treasury = new TreasuryEngine(ledger);
    const compliance = ComplianceService.create({ clock, ...gateSeed });
    const svc = new WithdrawalService(wallet, treasury, { async payout() { return { ok: true, reference: 'x' }; } }, {
      limits: { min: 100, perTransaction: 1_000_000, dailyMax: 5_000_000 },
      decisionGate: compliance,
    });
    const fund = (p: string, a: number) => wallet.credit(p, a, { type: TransactionType.Deposit });
    return { ledger, wallet, treasury, compliance, svc, fund };
  }

  it('APPROVE → Treasury reserves funds and creates the withdrawal', async () => {
    const { wallet, svc, fund, compliance } = wire();
    fund('good', 50_000);
    await compliance.refresh('good');
    const w = svc.createRequest({ playerId: 'good', amount: 10_000, currency: 'INR' });
    expect(w.status).toBe('requested');
    expect(wallet.getBalance('good').locked).toBe(10_000); // money moved only after approval
  });

  it('REJECT → Treasury never moves money (no reservation, throws)', async () => {
    const { wallet, svc, fund, compliance } = wire({ amlSeed: { sanctioned: ['blocked'] } });
    fund('blocked', 50_000);
    await compliance.refresh('blocked');
    expect(() => svc.createRequest({ playerId: 'blocked', amount: 10_000, currency: 'INR' })).toThrow(/compliance/i);
    // wallet untouched — the ledger never posted a reserve
    expect(wallet.getBalance('blocked')).toMatchObject({ available: 50_000, locked: 0 });
  });

  it('HOLD (unverified KYC) → Treasury stops; no money moves', async () => {
    const { wallet, svc, fund } = wire();
    fund('unknown-player', 50_000);
    // no refresh → KYC defaults to Unverified → policy holds the withdrawal
    let code = '';
    try {
      svc.createRequest({ playerId: 'unknown-player', amount: 10_000, currency: 'INR' });
    } catch (e) {
      code = (e as { code: string }).code;
    }
    expect(code).toBe('COMPLIANCE_BLOCKED');
    expect(wallet.getBalance('unknown-player').locked).toBe(0);
  });
});
