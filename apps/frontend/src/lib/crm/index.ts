/**
 * CRM, Loyalty & Marketing platform (Phase 6B) — public surface.
 *
 * An enterprise player-engagement layer that CONSUMES existing platform services
 * read-only and NEVER owns or moves money (the bonus wallet is logical-only). It
 * integrates with the Operations RBAC (reusing its `Role`/`AuthContext`) and adds
 * segmentation, loyalty, VIP, bonuses, promotions, notifications, referrals and a
 * unified player timeline — with zero changes to any frozen financial/gameplay system.
 */
export * from './types';
export { CrmRBAC, CrmPermission, CrmAccessDeniedError, CrmAudit, maskContact, type CrmAuditRecord } from './security';
export { type PlayerInsightPort, operationsInsightPort } from './ports';
export { SegmentationEngine, defaultSegments, type SegmentConfig } from './segmentation';
export { LoyaltyEngine } from './loyalty';
export { VipService } from './vip';
export { BonusEngine } from './bonus';
export { PromotionEngine } from './promotions';
export { NotificationService, MockNotificationProvider, type ContactResolver, type PreferenceResolver } from './notifications';
export { ReferralProgram, type ReferralRewardRule } from './referral';
export { CRMService, type CRMServiceDeps } from './crm-service';
