/**
 * Compliance service (Phase 5D) — the Risk & Compliance Platform facade.
 *
 * Wires the sub-engines (KYC, AML, fraud, device, geo, velocity, policy, decision,
 * audit) into a single entry point. `decide(ctx)` is SYNCHRONOUS and pure over
 * cached provider snapshots + the sync engines, so the Withdrawal Service can gate
 * an operation inline without changing its signature. `evaluate(ctx)` is the async
 * full path that refreshes providers first. It **decides; it never moves money.**
 */
import { ComplianceAudit } from './audit';
import { DecisionEngine } from './decision-engine';
import { DeviceTrustService, MockDeviceProvider } from './device';
import { FraudEngine, type FraudFeatures } from './fraud';
import { GeoService, type GeoPolicy, MockGeoProvider } from './geo';
import { KYCService, MockKYCProvider } from './kyc';
import { AMLService, MockAMLProvider } from './aml';
import { defaultPolicyRules, PolicyEngine } from './policy-engine';
import {
  type DecisionContext,
  type DecisionResult,
  type DecisionSignals,
  DeviceRisk,
  type DeviceFingerprint,
  type DeviceReputation,
  type DeviceResult,
  OperationType,
  type VelocityKind,
} from './types';
import { VelocityControls } from './velocity';

export interface ComplianceServiceDeps {
  kyc: KYCService;
  aml: AMLService;
  fraud: FraudEngine;
  device: DeviceTrustService;
  geo: GeoService;
  velocity: VelocityControls;
  policy: PolicyEngine;
  decision: DecisionEngine;
  audit: ComplianceAudit;
  clock?: () => number;
}

export class ComplianceService {
  private readonly clock: () => number;
  private readonly deviceCache = new Map<string, DeviceResult>();

  constructor(private readonly deps: ComplianceServiceDeps) {
    this.clock = deps.clock ?? (() => Date.now());
  }

  /* ------------------------------ accessors ------------------------------- */
  get audit(): ComplianceAudit {
    return this.deps.audit;
  }
  get policy(): PolicyEngine {
    return this.deps.policy;
  }
  get velocity(): VelocityControls {
    return this.deps.velocity;
  }
  get kyc(): KYCService {
    return this.deps.kyc;
  }
  get aml(): AMLService {
    return this.deps.aml;
  }

  /** Record a velocity event (deposit/withdrawal/login/…) as it happens. */
  recordEvent(playerId: string, kind: VelocityKind, at?: number): void {
    this.deps.velocity.record(playerId, kind, at);
  }

  /** Refresh async provider snapshots for a player so `decide` can run inline. */
  async refresh(playerId: string, input?: { country?: string; amount?: number; documentRef?: string }): Promise<void> {
    await Promise.all([this.deps.kyc.refresh(playerId, { documentRef: input?.documentRef }), this.deps.aml.refresh(playerId, { country: input?.country, amount: input?.amount })]);
  }

  /** Assess + cache a device fingerprint (async provider call). */
  async assessDevice(fp: DeviceFingerprint): Promise<DeviceResult> {
    const result = await this.deps.device.assess(fp);
    this.deviceCache.set(fp.id, result);
    return result;
  }

  private cachedDevice(fp?: DeviceFingerprint): DeviceResult | undefined {
    if (!fp) return undefined;
    const cached = this.deviceCache.get(fp.id);
    if (cached) return cached;
    // Unknown, benign default — the async path (`assessDevice`) refines it.
    const reputation: DeviceReputation = { vpn: false, tor: false, ipReputation: 60 };
    return { risk: DeviceRisk.Unknown, reputation, trusted: false, fingerprintId: fp.id };
  }

  /* ------------------------------ resolution ------------------------------ */

  private resolveSignals(ctx: DecisionContext, now: number): DecisionSignals {
    const kyc = this.deps.kyc.get(ctx.playerId);
    const aml = this.deps.aml.get(ctx.playerId);
    const velocity = this.deps.velocity.evaluate(ctx.playerId, now);
    const device = this.cachedDevice(ctx.device);
    const geo = ctx.geo ? this.deps.geo.classify(ctx.geo) : undefined;

    const features: FraudFeatures = {
      velocity,
      device,
      linkedAccounts: typeof ctx.metadata?.linkedAccounts === 'number' ? ctx.metadata.linkedAccounts : undefined,
      recentCountries: Array.isArray(ctx.metadata?.recentCountries) ? (ctx.metadata.recentCountries as string[]) : undefined,
      betAnomaly: typeof ctx.metadata?.betAnomaly === 'number' ? ctx.metadata.betAnomaly : undefined,
    };
    const fraud = this.deps.fraud.score(ctx, features);

    return { kyc, aml, fraud, device, geo, velocity };
  }

  /* ------------------------------- decisions ------------------------------ */

  /** Synchronous decision over cached snapshots + sync engines. Writes the audit. */
  decide(ctx: DecisionContext): DecisionResult {
    const at = ctx.at ?? this.clock();
    const correlationId = ctx.correlationId ?? this.secureId('corr');
    const signals = this.resolveSignals({ ...ctx, at }, at);
    const result = this.deps.decision.evaluate({ ...ctx, at }, signals, at, correlationId);

    this.deps.audit.record({
      at,
      correlationId,
      operation: ctx.operation,
      playerId: ctx.playerId,
      actor: ctx.actor,
      action: result.action,
      reasons: result.reasons,
      riskScore: result.riskScore,
      kycStatus: signals.kyc?.status,
      amlStatus: signals.aml?.riskLevel,
      fraudScore: signals.fraud?.score,
      deviceStatus: signals.device?.risk,
      geoStatus: signals.geo?.status,
    });
    return result;
  }

  /** Full async path: refresh providers (incl. device) then decide. */
  async evaluate(ctx: DecisionContext): Promise<DecisionResult> {
    await this.refresh(ctx.playerId, { country: ctx.geo?.country, amount: ctx.amount });
    if (ctx.device) await this.assessDevice(ctx.device);
    return this.decide(ctx);
  }

  /**
   * Treasury integration adapter (STEP 10). The Withdrawal Service calls this before
   * execution; only `allowed === true` lets Treasury proceed. Structurally matches
   * the treasury's local `WithdrawalDecisionGate` — no import coupling either way.
   */
  decideWithdrawal(input: { playerId: string; amount: number; currency: string; correlationId?: string; device?: DeviceFingerprint; geo?: DecisionContext['geo']; actor?: string }): DecisionResult {
    return this.decide({
      operation: OperationType.Withdrawal,
      playerId: input.playerId,
      amount: input.amount,
      currency: input.currency,
      correlationId: input.correlationId,
      device: input.device,
      geo: input.geo,
      actor: input.actor,
    });
  }

  private secureId(prefix: string): string {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  /* -------------------------------- factory ------------------------------- */

  /**
   * Build a fully-wired platform with mock providers + default policy. A deployment
   * swaps the providers for real adapters and tunes the config — no code change.
   */
  static create(config?: {
    clock?: () => number;
    policy?: Parameters<typeof defaultPolicyRules>[0];
    geo?: GeoPolicy;
    velocityLimits?: ConstructorParameters<typeof VelocityControls>[0];
    kycSeed?: ConstructorParameters<typeof MockKYCProvider>[0];
    amlSeed?: ConstructorParameters<typeof MockAMLProvider>[0];
    deviceSeed?: ConstructorParameters<typeof MockDeviceProvider>[0];
    geoSeed?: ConstructorParameters<typeof MockGeoProvider>[0];
  }): ComplianceService {
    const clock = config?.clock ?? (() => Date.now());
    const kyc = new KYCService(new MockKYCProvider(config?.kycSeed, clock), clock);
    const aml = new AMLService(new MockAMLProvider(config?.amlSeed, clock), clock);
    const device = new DeviceTrustService(new MockDeviceProvider(config?.deviceSeed), clock);
    const geo = new GeoService(config?.geo ?? {}, config?.geoSeed ? new MockGeoProvider(config.geoSeed) : undefined);
    const velocity = new VelocityControls(config?.velocityLimits ?? [], clock);
    const fraud = new FraudEngine();
    const policy = new PolicyEngine(defaultPolicyRules(config?.policy));
    const decision = new DecisionEngine(policy);
    const audit = new ComplianceAudit();
    return new ComplianceService({ kyc, aml, fraud, device, geo, velocity, policy, decision, audit, clock });
  }
}
