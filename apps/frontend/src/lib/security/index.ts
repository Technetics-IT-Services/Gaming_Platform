/**
 * Production security, compliance & trust platform (Phase 8) — public surface.
 *
 * Security that WRAPS the frozen Enterprise Platform: application-security headers +
 * input validation + output encoding + CSRF/SSRF guards, identity security (MFA/
 * WebAuthn/passwords/lockout/sessions), secret management, security monitoring +
 * SIEM, a compliance-evidence registry, and incident response. It changes no
 * business, financial or infrastructure logic — pure defensive plumbing.
 */
export {
  defaultCSP,
  serializeCSP,
  securityHeaders,
  secureCookie,
  type CSPDirectives,
  type SecurityHeaderOptions,
  type CookieOptions,
} from './headers';
export {
  V,
  validate,
  ValidationError,
  encode,
  csrf,
  timingSafeEqual,
  assertOutboundUrlSafe,
  type Validator,
} from './validation';
export {
  base32Decode,
  hotp,
  totp,
  MFAService,
  type IWebAuthnProvider,
  checkPassword,
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicy,
  AccountLockout,
  DEFAULT_LOCKOUT,
  type LockoutPolicy,
  SessionManager,
  type Session,
} from './identity';
export {
  SecretManager,
  InMemorySecretProvider,
  type ISecretProvider,
  type IKMSProvider,
  type IVaultProvider,
  type SecretVersion,
  type SecretMetadata,
  type SecretAuditRecord,
} from './secrets';
export {
  SecurityMonitor,
  SecurityEventType,
  SecuritySeverity,
  type SecurityEvent,
  type ThreatIndicator,
  type AnomalyEvent,
  type ISIEMForwarder,
} from './monitoring';
export {
  ComplianceEvidenceRegistry,
  ControlStatus,
  defaultControls,
  type Control,
  type Evidence,
  type Policy,
} from './compliance-evidence';
export {
  IncidentManager,
  IncidentSeverity,
  IncidentStatus,
  ESCALATION_MATRIX,
  FORENSIC_CHECKLIST,
  type Incident,
} from './incident';
export {
  SecurityPlatform,
  SecurityRole,
  SecurityPermission,
  SecurityAccessDeniedError,
  type SecurityAuthContext,
  type SecurityPlatformDeps,
} from './security-platform';
