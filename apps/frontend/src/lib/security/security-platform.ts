/**
 * Security platform (Phase 8, STEP 9) — the RBAC-enforced read-only facade.
 *
 * A single entry point for the security/SOC/audit surfaces: security event export,
 * compliance evidence, policy registry, incident coordination and the production
 * security-header set. Every call is permission-checked and audited. It WRAPS the
 * frozen platform — it exposes read-only security data and coordination, and changes
 * no business, financial or infrastructure logic.
 */
import { ComplianceEvidenceRegistry, type Report } from './compliance-evidence';
import { securityHeaders, type SecurityHeaderOptions } from './headers';
import { IncidentManager } from './incident';
import { type ISIEMForwarder, SecurityMonitor, type SecurityEvent } from './monitoring';

export enum SecurityRole {
  SecurityAdmin = 'security_admin',
  SecurityAnalyst = 'security_analyst',
  ComplianceAuditor = 'compliance_auditor',
  IncidentResponder = 'incident_responder',
  ReadOnly = 'read_only',
}

export enum SecurityPermission {
  EventsView = 'security.events.view',
  EvidenceView = 'security.evidence.view',
  EvidenceManage = 'security.evidence.manage',
  PolicyView = 'security.policy.view',
  IncidentView = 'security.incident.view',
  IncidentManage = 'security.incident.manage',
  Export = 'security.export',
  ConfigView = 'security.config.view',
}

const P = SecurityPermission;
const ALL_VIEW = [P.EventsView, P.EvidenceView, P.PolicyView, P.IncidentView, P.ConfigView];
const DEFAULT_ROLES: Record<SecurityRole, SecurityPermission[]> = {
  [SecurityRole.ReadOnly]: [P.EvidenceView, P.PolicyView, P.ConfigView],
  [SecurityRole.SecurityAnalyst]: [...ALL_VIEW, P.Export],
  [SecurityRole.ComplianceAuditor]: [P.EvidenceView, P.EvidenceManage, P.PolicyView, P.Export, P.EventsView],
  [SecurityRole.IncidentResponder]: [P.IncidentView, P.IncidentManage, P.EventsView],
  [SecurityRole.SecurityAdmin]: Object.values(SecurityPermission),
};

export interface SecurityAuthContext {
  actor: string;
  roles: SecurityRole[];
  correlationId?: string;
}
export class SecurityAccessDeniedError extends Error {
  constructor(readonly actor: string, readonly permission: SecurityPermission) {
    super(`Security access denied: ${actor} lacks ${permission}`);
    this.name = 'SecurityAccessDeniedError';
  }
}

export interface SecurityAuditRecord {
  at: number;
  actor: string;
  action: string;
  allowed: boolean;
  detail?: string;
}

export interface SecurityPlatformDeps {
  clock?: () => number;
  siem?: ISIEMForwarder;
  roles?: Partial<Record<SecurityRole, SecurityPermission[]>>;
}

export class SecurityPlatform {
  readonly monitor: SecurityMonitor;
  readonly evidence: ComplianceEvidenceRegistry;
  readonly incidents: IncidentManager;
  private readonly roles: Record<SecurityRole, SecurityPermission[]>;
  private readonly audit: SecurityAuditRecord[] = [];
  private readonly clock: () => number;

  constructor(deps: SecurityPlatformDeps = {}) {
    this.clock = deps.clock ?? (() => Date.now());
    this.roles = { ...DEFAULT_ROLES, ...deps.roles };
    this.monitor = new SecurityMonitor(this.clock, deps.siem);
    this.evidence = new ComplianceEvidenceRegistry(this.clock);
    this.incidents = new IncidentManager(this.clock);
  }

  /* ------------------------------ enforcement ----------------------------- */

  private can(roles: SecurityRole[], permission: SecurityPermission): boolean {
    return roles.some((r) => this.roles[r]?.includes(permission) ?? false);
  }
  private enforce<T>(auth: SecurityAuthContext, permission: SecurityPermission, action: string, fn: () => T): T {
    if (!this.can(auth.roles, permission)) {
      this.audit.push({ at: this.clock(), actor: auth.actor, action, allowed: false, detail: `denied: ${permission}` });
      throw new SecurityAccessDeniedError(auth.actor, permission);
    }
    const result = fn();
    this.audit.push({ at: this.clock(), actor: auth.actor, action, allowed: true });
    return result;
  }
  auditTrail(): readonly SecurityAuditRecord[] {
    return this.audit;
  }

  /* --------------------------------- APIs --------------------------------- */

  securityEvents(auth: SecurityAuthContext, filter?: Parameters<SecurityMonitor['query']>[0]): SecurityEvent[] {
    return this.enforce(auth, SecurityPermission.EventsView, 'events.view', () => this.monitor.query(filter));
  }
  socExport(auth: SecurityAuthContext): ReturnType<SecurityMonitor['socExport']> {
    return this.enforce(auth, SecurityPermission.Export, 'events.export', () => this.monitor.socExport());
  }
  evidenceMatrix(auth: SecurityAuthContext): Report {
    return this.enforce(auth, SecurityPermission.Export, 'evidence.export', () => this.evidence.export());
  }
  complianceCoverage(auth: SecurityAuthContext) {
    return this.enforce(auth, SecurityPermission.EvidenceView, 'evidence.coverage', () => this.evidence.coverage());
  }
  policies(auth: SecurityAuthContext) {
    return this.enforce(auth, SecurityPermission.PolicyView, 'policy.list', () => this.evidence.listPolicies());
  }
  openIncidents(auth: SecurityAuthContext) {
    return this.enforce(auth, SecurityPermission.IncidentView, 'incident.list', () => this.incidents.open());
  }
  declareIncident(auth: SecurityAuthContext, input: Parameters<IncidentManager['declare']>[0]) {
    return this.enforce(auth, SecurityPermission.IncidentManage, 'incident.declare', () => this.incidents.declare({ ...input, commander: input.commander ?? auth.actor }));
  }
  /** The production security-header set for the edge/app middleware (config view). */
  headers(auth: SecurityAuthContext, opts?: SecurityHeaderOptions): Record<string, string> {
    return this.enforce(auth, SecurityPermission.ConfigView, 'config.headers', () => securityHeaders(opts));
  }
}
