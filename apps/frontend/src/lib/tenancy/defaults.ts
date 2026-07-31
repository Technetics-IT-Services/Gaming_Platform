/**
 * Plan-based defaults for new tenants (Phase 3.1). Pure data + helpers — a new tenant
 * inherits sensible limits/config/brand/theme from its plan, then overrides as needed.
 * No frozen module is referenced.
 */
import {
  type BrandConfiguration,
  type TenantConfiguration,
  type TenantLimits,
  TenantPlan,
  type ThemeConfiguration,
  ThemeMode,
} from './types';

/** Resource ceilings per plan (STEP 12). */
export const PLAN_LIMITS: Record<TenantPlan, TenantLimits> = {
  [TenantPlan.Starter]: { concurrentPlayers: 500, concurrentSessions: 750, storageMB: 1_024, mediaMB: 2_048, apiRequestsPerMinute: 600, scheduledJobs: 10, queueDepth: 1_000, notificationsPerDay: 10_000, backgroundWorkers: 2 },
  [TenantPlan.Growth]: { concurrentPlayers: 5_000, concurrentSessions: 7_500, storageMB: 10_240, mediaMB: 20_480, apiRequestsPerMinute: 6_000, scheduledJobs: 50, queueDepth: 10_000, notificationsPerDay: 100_000, backgroundWorkers: 8 },
  [TenantPlan.Enterprise]: { concurrentPlayers: 50_000, concurrentSessions: 75_000, storageMB: 102_400, mediaMB: 204_800, apiRequestsPerMinute: 60_000, scheduledJobs: 500, queueDepth: 100_000, notificationsPerDay: 5_000_000, backgroundWorkers: 32 },
  [TenantPlan.Custom]: { concurrentPlayers: 100_000, concurrentSessions: 150_000, storageMB: 1_048_576, mediaMB: 2_097_152, apiRequestsPerMinute: 120_000, scheduledJobs: 2_000, queueDepth: 1_000_000, notificationsPerDay: 50_000_000, backgroundWorkers: 128 },
};

export function defaultConfiguration(currency = 'USD', locale = 'en-US'): TenantConfiguration {
  return {
    depositLimits: { min: 10, max: 10_000, daily: 25_000, monthly: 250_000, currency },
    withdrawalLimits: { min: 20, max: 20_000, daily: 50_000, monthly: 500_000, currency },
    currencies: [currency],
    languages: [locale.split('-')[0] ?? 'en'],
    responsibleGaming: { depositLimitEnabled: true, lossLimitEnabled: true, selfExclusionEnabled: true, sessionRemindersMinutes: 60, realityCheckMinutes: 60 },
    paymentProviders: [],
    gameAvailability: {},
    notificationSettings: { emailEnabled: true, smsEnabled: false, pushEnabled: true },
  };
}

export function defaultBrand(name: string): BrandConfiguration {
  return {
    casinoName: name,
    primaryColor: '#7c3aed',
    secondaryColor: '#0ea5e9',
    typography: { fontFamily: 'Inter, sans-serif' },
    support: {},
    socialLinks: {},
  };
}

export function defaultTheme(): ThemeConfiguration {
  return {
    mode: ThemeMode.Dark,
    tokens: { '--color-bg': '#0b0f19', '--color-fg': '#e5e7eb', '--color-primary': '#7c3aed', '--color-accent': '#0ea5e9' },
  };
}

/** Feature availability per plan (STEP 7 — plan flags). */
export const PLAN_FEATURES: Record<TenantPlan, Record<string, boolean>> = {
  [TenantPlan.Starter]: { 'poker.enabled': false, 'lottery.enabled': true, 'sportsbook.enabled': false, 'ai.enabled': false, 'marketplace.enabled': false, 'slots.enabled': true, 'table-games.enabled': true, 'instant-games.enabled': true },
  [TenantPlan.Growth]: { 'poker.enabled': true, 'lottery.enabled': true, 'sportsbook.enabled': true, 'ai.enabled': false, 'marketplace.enabled': false, 'slots.enabled': true, 'table-games.enabled': true, 'instant-games.enabled': true },
  [TenantPlan.Enterprise]: { 'poker.enabled': true, 'lottery.enabled': true, 'sportsbook.enabled': true, 'ai.enabled': true, 'marketplace.enabled': true, 'slots.enabled': true, 'table-games.enabled': true, 'instant-games.enabled': true },
  [TenantPlan.Custom]: { 'poker.enabled': true, 'lottery.enabled': true, 'sportsbook.enabled': true, 'ai.enabled': true, 'marketplace.enabled': true, 'slots.enabled': true, 'table-games.enabled': true, 'instant-games.enabled': true },
};
