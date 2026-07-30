/**
 * Risk & Compliance platform contracts (Phase 5D).
 *
 * A provider-agnostic compliance layer that sits between the Withdrawal Service and
 * the Treasury Engine: `Withdrawal Service → Risk & Compliance → Treasury Engine`.
 * It **evaluates and decides** — it NEVER moves money. Money movement stays with the
 * Treasury Engine + Ledger. Every provider (KYC/AML/device/geo) is an injected
 * adapter; only mocks ship here. Framework-agnostic (no React/store).
 */

export type CorrelationId = string;

/** The financial operations the platform can gate. */
export enum OperationType {
  Deposit = 'deposit',
  Withdrawal = 'withdrawal',
  Login = 'login',
  Bet = 'bet',
  Adjustment = 'adjustment',
}

/** A coarse risk band shared by the sub-engines. */
export enum RiskLevel {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Critical = 'critical',
}

/* ------------------------------ decision core ----------------------------- */

/**
 * What the platform decided. Ordered by severity — only `Approve` lets Treasury
 * execute; every other action stops (or defers) execution. Never moves money.
 */
export enum DecisionAction {
  Approve = 'approve',
  ManualReview = 'manual_review',
  Hold = 'hold',
  Escalate = 'escalate',
  Reject = 'reject',
}

/** Severity ranking used to combine many reasons into one action (higher wins). */
export const DECISION_SEVERITY: Record<DecisionAction, number> = {
  [DecisionAction.Approve]: 0,
  [DecisionAction.ManualReview]: 1,
  [DecisionAction.Hold]: 2,
  [DecisionAction.Escalate]: 3,
  [DecisionAction.Reject]: 4,
};

export interface DecisionReason {
  /** Stable machine code, e.g. `KYC_UNVERIFIED`, `AML_SANCTIONS_HIT`. */
  code: string;
  message: string;
  /** The action this single reason argues for. */
  severity: DecisionAction;
  /** Which engine raised it: policy | kyc | aml | fraud | device | geo | velocity. */
  source: string;
}

/** The input to a decision. Signals may be supplied or looked up from caches. */
export interface DecisionContext {
  operation: OperationType;
  playerId: string;
  amount?: number;
  currency?: string;
  correlationId?: CorrelationId;
  actor?: string;
  device?: DeviceFingerprint;
  geo?: GeoSignal;
  /** VIP / responsible-gaming / business context for policy rules. */
  attributes?: Record<string, unknown>;
  at?: number;
  metadata?: Record<string, unknown>;
}

/** The resolved signals a decision was made from (snapshotted into the audit). */
export interface DecisionSignals {
  kyc?: KYCResult;
  aml?: AMLResult;
  fraud?: FraudScore;
  device?: DeviceResult;
  geo?: GeoResult;
  velocity?: VelocityResult[];
}

export interface DecisionResult {
  action: DecisionAction;
  /** True only when `action === Approve` — the single gate Treasury checks. */
  allowed: boolean;
  reasons: DecisionReason[];
  /** Aggregate 0–100 risk score across engines. */
  riskScore: number;
  signals: DecisionSignals;
  correlationId: CorrelationId;
  at: number;
}

/** A configurable policy rule (STEP 2) — pure, side-effect-free, no money movement. */
export interface DecisionRule {
  id: string;
  description: string;
  enabled: boolean;
  /** Return a reason to raise it, or null to pass. Must be deterministic. */
  evaluate: (ctx: DecisionContext, signals: DecisionSignals) => DecisionReason | null;
}

/* ---------------------------------- KYC ----------------------------------- */

export enum VerificationStatus {
  Unverified = 'unverified',
  Pending = 'pending',
  Verified = 'verified',
  Rejected = 'rejected',
  Expired = 'expired',
}
export enum DocumentStatus {
  Missing = 'missing',
  Submitted = 'submitted',
  Approved = 'approved',
  Rejected = 'rejected',
}
export enum IdentityStatus {
  Unknown = 'unknown',
  Matched = 'matched',
  Mismatch = 'mismatch',
}

export interface KYCResult {
  playerId: string;
  status: VerificationStatus;
  document: DocumentStatus;
  identity: IdentityStatus;
  /** Assurance level 0 (none) … 3 (enhanced). */
  level: number;
  provider: string;
  checkedAt: number;
}

export interface IKYCProvider {
  readonly name: string;
  verify(input: { playerId: string; documentRef?: string; metadata?: Record<string, unknown> }): Promise<KYCResult>;
}

/* ---------------------------------- AML ----------------------------------- */

export interface SanctionsCheck {
  hit: boolean;
  lists: string[];
}
export interface PEPCheck {
  hit: boolean;
  category?: string;
}
export interface WatchlistCheck {
  hit: boolean;
  sources: string[];
}
export enum RiskFlag {
  Sanctions = 'sanctions',
  PEP = 'pep',
  Watchlist = 'watchlist',
  HighRiskJurisdiction = 'high_risk_jurisdiction',
  StructuringSuspected = 'structuring_suspected',
}

export interface AMLResult {
  playerId: string;
  sanctions: SanctionsCheck;
  pep: PEPCheck;
  watchlist: WatchlistCheck;
  flags: RiskFlag[];
  riskLevel: RiskLevel;
  provider: string;
  checkedAt: number;
}

export interface IAMLProvider {
  readonly name: string;
  screen(input: { playerId: string; country?: string; amount?: number }): Promise<AMLResult>;
}

/* --------------------------------- fraud ---------------------------------- */

export interface FraudSignal {
  code: string;
  /** Contribution to the score (0–100 before clamping). */
  weight: number;
  detail?: string;
}
export interface FraudScore {
  score: number;
  level: RiskLevel;
  signals: FraudSignal[];
}

/* --------------------------------- device --------------------------------- */

export interface DeviceFingerprint {
  id: string;
  playerId?: string;
  userAgent?: string;
  ip?: string;
  /** Opaque hash of assorted browser signals (canvas/webgl/fonts…) — hook only. */
  fingerprintHash?: string;
}
export interface DeviceReputation {
  vpn: boolean;
  tor: boolean;
  /** IP reputation 0 (bad) … 100 (clean). */
  ipReputation: number;
  proxy?: boolean;
}
export enum DeviceRisk {
  Trusted = 'trusted',
  Unknown = 'unknown',
  Suspicious = 'suspicious',
  Blocked = 'blocked',
}
export interface TrustedDevice {
  fingerprintId: string;
  playerId: string;
  trustedAt: number;
}
export interface DeviceResult {
  risk: DeviceRisk;
  reputation: DeviceReputation;
  trusted: boolean;
  fingerprintId?: string;
}
export interface IDeviceTrustProvider {
  readonly name: string;
  assess(fp: DeviceFingerprint): Promise<DeviceReputation>;
}

/* ----------------------------------- geo ---------------------------------- */

export interface GeoSignal {
  country?: string;
  state?: string;
  ip?: string;
  /** IANA timezone, e.g. `Asia/Kolkata`. */
  timezone?: string;
}
export enum GeoStatus {
  Allowed = 'allowed',
  Restricted = 'restricted',
  Blocked = 'blocked',
  Unknown = 'unknown',
}
export interface GeoResult {
  status: GeoStatus;
  country?: string;
  state?: string;
  reason?: string;
}
export interface IGeoProvider {
  readonly name: string;
  locate(ip: string): Promise<GeoSignal>;
}

/* -------------------------------- velocity -------------------------------- */

export enum VelocityKind {
  Deposit = 'deposit',
  Withdrawal = 'withdrawal',
  FailedAttempt = 'failed_attempt',
  Login = 'login',
  DeviceChange = 'device_change',
  IPChange = 'ip_change',
}
export interface VelocityLimit {
  kind: VelocityKind;
  max: number;
  windowMs: number;
}
export interface VelocityResult {
  kind: VelocityKind;
  count: number;
  limit: number;
  windowMs: number;
  exceeded: boolean;
}

/* ---------------------------------- audit --------------------------------- */

export interface ComplianceAuditRecord {
  at: number;
  correlationId: CorrelationId;
  operation: OperationType;
  playerId: string;
  actor?: string;
  action: DecisionAction;
  reasons: DecisionReason[];
  riskScore: number;
  kycStatus?: VerificationStatus;
  amlStatus?: RiskLevel;
  fraudScore?: number;
  deviceStatus?: DeviceRisk;
  geoStatus?: GeoStatus;
}
