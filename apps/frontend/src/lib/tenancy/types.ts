/**
 * Enterprise Multi-Tenant Foundation (Version 3.0, Phase 3.1) — domain types.
 *
 * An ADDITIVE SaaS layer that turns the production-certified, permanently FROZEN
 * Enterprise Casino Platform into a multi-tenant platform. It never modifies, forks or
 * duplicates any frozen module (Runtime, Wallet, Ledger, Treasury, Payments, Games,
 * CRM, Analytics, Security…). Every request runs inside a `TenantContext`; the shared
 * platform is isolated purely by context. Type-only.
 */

/* --------------------------------- lifecycle --------------------------------- */

/** The tenant lifecycle states (STEP 1 / STEP 14). */
export enum TenantStatus {
  /** Created + configured, not yet serving traffic. */
  Provisioned = 'provisioned',
  /** Live and serving requests. */
  Active = 'active',
  /** Temporarily disabled (billing, compliance) — data retained, traffic blocked. */
  Suspended = 'suspended',
  /** Read-only, retired from service; restorable. */
  Archived = 'archived',
  /** Soft-deleted; retained for the grace window, then purgeable. */
  Deleted = 'deleted',
}

/** Commercial plan — gates features, quotas and flags. */
export enum TenantPlan {
  Starter = 'starter',
  Growth = 'growth',
  Enterprise = 'enterprise',
  Custom = 'custom',
}

/** Deployment region (data residency + latency). */
export type TenantRegion = 'global' | 'eu-west' | 'eu-central' | 'us-east' | 'us-west' | 'ap-south' | 'ap-east' | 'sa-east' | (string & {});

/* -------------------------------- configuration ------------------------------ */

/** Per-tenant resource ceilings (STEP 12). */
export interface TenantLimits {
  concurrentPlayers: number;
  concurrentSessions: number;
  storageMB: number;
  mediaMB: number;
  apiRequestsPerMinute: number;
  scheduledJobs: number;
  queueDepth: number;
  notificationsPerDay: number;
  backgroundWorkers: number;
}

/** Money bound used by deposit/withdrawal configuration (logical — no money moves here). */
export interface AmountBound {
  min: number;
  max: number;
  daily?: number;
  monthly?: number;
  currency?: string;
}

/** Responsible-gaming configuration surface (values only; enforced by the frozen platform). */
export interface ResponsibleGamingConfig {
  depositLimitEnabled: boolean;
  lossLimitEnabled: boolean;
  sessionRemindersMinutes?: number;
  selfExclusionEnabled: boolean;
  realityCheckMinutes?: number;
}

/** Hierarchical, per-tenant configuration values (STEP 6). */
export interface TenantConfiguration {
  depositLimits: AmountBound;
  withdrawalLimits: AmountBound;
  currencies: string[];
  languages: string[];
  responsibleGaming: ResponsibleGamingConfig;
  paymentProviders: string[];
  /** gameId → available. Absent id → inherit the parent layer. */
  gameAvailability: Record<string, boolean>;
  notificationSettings: {
    emailEnabled: boolean;
    smsEnabled: boolean;
    pushEnabled: boolean;
  };
  /** Free-form additional keys resolved through the hierarchy. */
  extra?: Record<string, unknown>;
}

/* ----------------------------------- brand ----------------------------------- */

/** Brand configuration (STEP 8) — configuration only, no frontend redesign. */
export interface BrandConfiguration {
  casinoName: string;
  logoUrl?: string;
  faviconUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  typography?: { fontFamily: string; headingFamily?: string };
  emailTemplates?: Record<string, string>;
  smsTemplates?: Record<string, string>;
  pushTemplates?: Record<string, string>;
  support?: { email?: string; phone?: string; url?: string };
  socialLinks?: Record<string, string>;
}

/* ----------------------------------- theme ----------------------------------- */

export enum ThemeMode {
  Light = 'light',
  Dark = 'dark',
  Custom = 'custom',
}

/** Theme configuration (STEP 9) — configuration only. */
export interface ThemeConfiguration {
  mode: ThemeMode;
  /** Design tokens (CSS custom-property names → values). */
  tokens: Record<string, string>;
  /** Optional named asset pack (icons/sprites bundle id). */
  assetPack?: string;
  /** Optional reference to a shared brand theme this extends. */
  baseThemeId?: string;
}

/* ---------------------------------- tenant ----------------------------------- */

export interface TenantMetadata {
  tags?: string[];
  createdBy?: string;
  notes?: string;
  [key: string]: unknown;
}

/** The tenant aggregate root (STEP 1). */
export interface Tenant {
  id: string; // TenantId
  code: string; // stable, human-friendly TenantCode (unique)
  name: string; // TenantName
  operatorId: string; // owning operator
  status: TenantStatus;
  plan: TenantPlan;
  region: TenantRegion;
  timezone: string;
  currency: string;
  locale: string;
  brand: BrandConfiguration;
  theme: ThemeConfiguration;
  /** Tenant-scoped feature-flag overrides (flag key → enabled). */
  features: Record<string, boolean>;
  limits: TenantLimits;
  configuration: TenantConfiguration;
  metadata: TenantMetadata;
  /** Hostnames / subdomains / api keys that resolve to this tenant. */
  domains: string[];
  apiKeys: string[];
  createdAt: number;
  updatedAt: number;
  provisionedAt?: number;
  activatedAt?: number;
  suspendedAt?: number;
  archivedAt?: number;
  deletedAt?: number;
}

/* --------------------------------- context ----------------------------------- */

/** How a request's tenant was resolved (STEP 3). */
export enum TenantResolutionSource {
  Hostname = 'hostname',
  Subdomain = 'subdomain',
  JwtClaim = 'jwt-claim',
  ApiKey = 'api-key',
  Header = 'header',
  InternalContext = 'internal-context',
  Cli = 'cli',
  BackgroundJob = 'background-job',
}

/**
 * The immutable per-request tenant context (STEP 4). Every downstream module consumes
 * this WITHOUT knowing how it was resolved. It is a projection of the tenant — never a
 * live handle to it — so it is safe to pass across module and async boundaries.
 */
export interface TenantContext {
  tenantId: string;
  tenantCode: string;
  operatorId: string;
  region: TenantRegion;
  timezone: string;
  currency: string;
  locale: string;
  plan: TenantPlan;
  brand: BrandConfiguration;
  permissions: string[];
  /** Fully-resolved feature flags for this request. */
  featureFlags: Record<string, boolean>;
  configuration: TenantConfiguration;
  resolvedVia: TenantResolutionSource;
  /** Correlation id for observability. */
  requestId: string;
  /** When the context was created (ms). */
  issuedAt: number;
}

/** Input a resolver receives from any transport (STEP 3). */
export interface TenantResolutionInput {
  hostname?: string;
  subdomain?: string;
  jwtClaims?: Record<string, unknown>;
  apiKey?: string;
  headers?: Record<string, string | undefined>;
  /** An already-known tenant id (internal calls / CLI / jobs). */
  internalTenantId?: string;
  operatorId?: string;
  permissions?: string[];
  requestId?: string;
  source?: TenantResolutionSource;
}

/** A health snapshot for a tenant (STEP 2). */
export interface TenantHealth {
  tenantId: string;
  status: TenantStatus;
  healthy: boolean;
  reasons: string[];
  checkedAt: number;
}
