/**
 * Risk & Compliance platform (Phase 5D) — public surface.
 *
 * A provider-agnostic layer that sits between the Withdrawal Service and Treasury
 * Engine: it evaluates deposits/withdrawals/operations and returns a decision. It
 * NEVER moves money — Treasury + Ledger remain the sole executors. Compose it via
 * `ComplianceService.create(...)` or wire the parts directly.
 */
export * from './types';
export { PolicyEngine, defaultPolicyRules } from './policy-engine';
export { DecisionEngine } from './decision-engine';
export { KYCService, MockKYCProvider } from './kyc';
export { AMLService, MockAMLProvider } from './aml';
export { FraudEngine, type FraudFeatures, type FraudModel, type FraudWeights } from './fraud';
export { DeviceTrustService, MockDeviceProvider } from './device';
export { GeoService, MockGeoProvider, type GeoPolicy } from './geo';
export { VelocityControls } from './velocity';
export { ComplianceAudit, type AuditQuery } from './audit';
export { ComplianceService, type ComplianceServiceDeps } from './compliance-service';
