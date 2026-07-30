/**
 * CRM security (Phase 6B, STEP 10).
 *
 * Integrates with the Operations RBAC by reusing its `Role` vocabulary + `AuthContext`
 * (imported read-only — Operations is not modified) and layering CRM feature
 * permissions on top. Deny-by-default; `CrmRBAC.assert` is the enforcement primitive.
 * A CRM audit store records every action (allow AND deny). Never touches money.
 */
import { Role } from '@/lib/operations';

export enum CrmPermission {
  ProfileView = 'crm.profile.view',
  ProfileEdit = 'crm.profile.edit',
  TagManage = 'crm.tag.manage',
  SegmentView = 'crm.segment.view',
  LoyaltyView = 'loyalty.view',
  LoyaltyAdjust = 'loyalty.adjust',
  VipView = 'vip.view',
  VipManage = 'vip.manage',
  BonusView = 'bonus.view',
  BonusGrant = 'bonus.grant',
  PromotionView = 'promotion.view',
  PromotionManage = 'promotion.manage',
  NotificationSend = 'notification.send',
  NotificationTemplateManage = 'notification.template.manage',
  ReferralView = 'referral.view',
  ReferralManage = 'referral.manage',
  TimelineView = 'crm.timeline.view',
}

export class CrmAccessDeniedError extends Error {
  constructor(
    readonly actor: string,
    readonly permission: CrmPermission,
  ) {
    super(`CRM access denied: ${actor} lacks ${permission}`);
    this.name = 'CrmAccessDeniedError';
  }
}

const P = CrmPermission;
const VIEW_ALL = [P.ProfileView, P.SegmentView, P.LoyaltyView, P.VipView, P.BonusView, P.PromotionView, P.ReferralView, P.TimelineView];

/** Default role → CRM-permission map (reuses Operations roles; configurable). */
const DEFAULT_CRM_ROLES: Partial<Record<Role, CrmPermission[]>> = {
  [Role.Support]: [P.ProfileView, P.SegmentView, P.LoyaltyView, P.VipView, P.BonusView, P.TimelineView, P.ReferralView],
  [Role.SupportAdmin]: [...VIEW_ALL, P.ProfileEdit, P.TagManage, P.NotificationSend, P.BonusGrant],
  [Role.ReadOnlyAuditor]: [...VIEW_ALL],
  [Role.ComplianceAdmin]: [...VIEW_ALL],
  [Role.FinanceAdmin]: [P.ProfileView, P.BonusView, P.VipView, P.LoyaltyView, P.TimelineView],
  [Role.OperationsAdmin]: [...VIEW_ALL, P.ProfileEdit, P.TagManage, P.LoyaltyAdjust, P.VipManage, P.BonusGrant, P.PromotionManage, P.NotificationSend, P.NotificationTemplateManage, P.ReferralManage],
  [Role.SuperAdmin]: Object.values(CrmPermission),
};

export class CrmRBAC {
  private readonly roles: Partial<Record<Role, CrmPermission[]>>;
  constructor(overrides: Partial<Record<Role, CrmPermission[]>> = {}) {
    this.roles = { ...DEFAULT_CRM_ROLES, ...overrides };
  }
  can(roles: Role[], permission: CrmPermission): boolean {
    return roles.some((r) => this.roles[r]?.includes(permission) ?? false);
  }
  assert(actor: string, roles: Role[], permission: CrmPermission): void {
    if (!this.can(roles, permission)) throw new CrmAccessDeniedError(actor, permission);
  }
}

export interface CrmAuditRecord {
  at: number;
  actor: string;
  action: string;
  target?: string;
  allowed: boolean;
  detail?: string;
}

export class CrmAudit {
  private readonly records: CrmAuditRecord[] = [];
  record(rec: CrmAuditRecord): void {
    this.records.push(rec);
  }
  all(): readonly CrmAuditRecord[] {
    return this.records;
  }
  query(q: { actor?: string; action?: string; target?: string; limit?: number } = {}): CrmAuditRecord[] {
    let out = this.records.filter((r) => {
      if (q.actor && r.actor !== q.actor) return false;
      if (q.action && r.action !== q.action) return false;
      if (q.target && r.target !== q.target) return false;
      return true;
    });
    out = out.sort((a, b) => b.at - a.at);
    return q.limit ? out.slice(0, q.limit) : out;
  }
  count(): number {
    return this.records.length;
  }
}

/** Mask a raw email/phone for storage/display (never persist raw PII in CRM). */
export function maskContact(value: string): string {
  if (value.includes('@')) {
    const [user = '', domain = ''] = value.split('@');
    const head = user.slice(0, 2);
    return `${head}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
  }
  const digits = value.replace(/\D/g, '');
  return digits.length <= 4 ? '*'.repeat(digits.length) : `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`;
}
