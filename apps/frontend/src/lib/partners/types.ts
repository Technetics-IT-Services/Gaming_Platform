/**
 * Partner, Affiliate & Multi-Tenant platform contracts (Phase 6C).
 *
 * An enterprise growth/distribution layer: `Partners → Partner Platform → Operations
 * APIs → CRM APIs → Platform Services`. It manages business relationships,
 * commissions, white-label brands and partner reporting. It **owns no gameplay and no
 * money** — commission is LOGICAL accounting only, never a ledger posting. Consumes
 * existing services read-only. Framework-agnostic. Integer minor/logical units.
 */

/* -------------------------------- partner --------------------------------- */

export enum PartnerType {
  Affiliate = 'affiliate',
  MasterAgent = 'master_agent',
  SubAgent = 'sub_agent',
  Dealer = 'dealer',
  WhiteLabel = 'white_label',
}
export enum PartnerStatus {
  Pending = 'pending',
  Active = 'active',
  Suspended = 'suspended',
  Terminated = 'terminated',
}
export enum PartnerLifecycle {
  Prospect = 'prospect',
  Onboarding = 'onboarding',
  Active = 'active',
  Dormant = 'dormant',
  Churned = 'churned',
}

export interface PartnerSettings {
  payoutCurrency: string;
  /** Default commission plan id applied to this partner's conversions. */
  defaultPlanId?: string;
  /** Minimum logical balance before a payout is eligible. */
  minPayout?: number;
  metadata?: Record<string, unknown>;
}
export interface PartnerNote {
  id: string;
  partnerId: string;
  body: string;
  author: string;
  at: number;
}
export interface PartnerProfile {
  id: string;
  tenantId: string;
  type: PartnerType;
  name: string;
  /** Masked contact (never raw PII). */
  emailMasked?: string;
  status: PartnerStatus;
  lifecycle: PartnerLifecycle;
  parentId?: string;
  settings: PartnerSettings;
  createdAt: number;
  updatedAt: number;
}
export interface PartnerAuditRecord {
  at: number;
  actor: string;
  action: string;
  target?: string;
  tenantId?: string;
  allowed: boolean;
  detail?: string;
}

/* ------------------------------- affiliate -------------------------------- */

export interface TrackingCode {
  code: string;
  affiliateId: string;
  campaign?: string;
  createdAt: number;
}
export interface AffiliateLink {
  code: string;
  url: string;
  campaign?: string;
}
export enum ConversionStatus {
  Clicked = 'clicked',
  Registered = 'registered',
  Qualified = 'qualified',
  Rejected = 'rejected',
}
export interface Conversion {
  id: string;
  affiliateId: string;
  code: string;
  campaign?: string;
  playerId?: string;
  status: ConversionStatus;
  clickedAt: number;
  updatedAt: number;
}
export enum AttributionModel {
  LastClick = 'last_click',
  FirstClick = 'first_click',
}
export interface AffiliateProfile {
  partnerId: string;
  attribution: AttributionModel;
  codes: string[];
}

/* ------------------------------- hierarchy -------------------------------- */

export interface PartnerTreeNode {
  partnerId: string;
  type: PartnerType;
  children: PartnerTreeNode[];
}

/* ------------------------------ commission -------------------------------- */

export enum CommissionModel {
  CPA = 'cpa',
  RevShare = 'rev_share',
  Hybrid = 'hybrid',
  Fixed = 'fixed',
  Percentage = 'percentage',
  Tiered = 'tiered',
}
export interface CommissionTier {
  /** Minimum base (volume/NGR) for this tier's rate to apply. */
  threshold: number;
  /** Basis points (1% = 100). */
  bps: number;
}
export interface CommissionPlan {
  id: string;
  name: string;
  model: CommissionModel;
  /** CPA: logical amount per qualified acquisition. */
  cpaAmount?: number;
  /** RevShare/Percentage: basis points of the base (NGR/base amount). */
  bps?: number;
  /** Tiered: ascending tiers by threshold. */
  tiers?: CommissionTier[];
  /** Fixed: flat periodic logical amount. */
  fixedAmount?: number;
}
export enum CommissionStatus {
  Pending = 'pending',
  Approved = 'approved',
  Paid = 'paid',
  Rejected = 'rejected',
  Adjusted = 'adjusted',
}
export interface CommissionEntry {
  id: string;
  partnerId: string;
  planId?: string;
  model: CommissionModel;
  /** LOGICAL commission units — never posted to the ledger. */
  amount: number;
  base?: number;
  status: CommissionStatus;
  reason?: string;
  actor?: string;
  at: number;
  period?: string;
}
export interface CommissionContext {
  /** Qualified acquisitions in the period (CPA/Hybrid). */
  conversions?: number;
  /** Net gaming revenue for the period (RevShare/Hybrid/Percentage/Tiered). */
  ngr?: number;
  /** Volume for tiered evaluation (defaults to ngr). */
  volume?: number;
  period?: string;
}

/* -------------------------------- tenant ---------------------------------- */

export interface BrandTheme {
  primaryColor: string;
  secondaryColor?: string;
  logoUrl?: string;
  /** Additional brand asset refs (ids/URLs, never binary). */
  assets?: Record<string, string>;
}
export interface Localization {
  defaultLocale: string;
  locales: string[];
  defaultCurrency: string;
  currencies: string[];
}
export interface Tenant {
  id: string;
  partnerId: string;
  brandName: string;
  theme: BrandTheme;
  /** Host → tenant mapping (e.g. `casino.brand.com`). */
  domains: string[];
  localization: Localization;
  featureFlags: Record<string, boolean>;
  status: PartnerStatus;
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------- reporting -------------------------------- */

export interface AcquisitionReport {
  partnerId: string;
  clicks: number;
  registrations: number;
  qualified: number;
  conversionRate: number;
}
export interface RevenueReport {
  partnerId: string;
  ngr: number;
  ltv: number;
  players: number;
  retainedPlayers: number;
  retentionRate: number;
}
export interface CommissionSummary {
  partnerId: string;
  pending: number;
  approved: number;
  paid: number;
  total: number;
  balance: number;
}
export interface Report {
  name: string;
  columns: string[];
  rows: (string | number)[][];
  generatedAt: number;
}

/* ------------------------------- dashboard -------------------------------- */

export interface PartnerDashboardView {
  partner: { id: string; name: string; status: PartnerStatus; type: PartnerType };
  acquisition: AcquisitionReport;
  revenue: RevenueReport;
  commission: CommissionSummary;
  subPartners: number;
  generatedAt: number;
}
