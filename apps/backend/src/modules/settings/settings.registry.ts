import { PERMISSIONS, type PermissionSlug } from '../authorization/rbac.constants';

/**
 * The settings ALLOW-LIST.
 *
 * This registry is the security boundary, not a filter applied afterwards: a key that is not
 * declared here cannot be read or written through the API at all. `SettingsService` resolves every
 * request against this map first and rejects anything it does not find.
 *
 * WHY A SEPARATE STORE FROM `ApplicationSetting`
 * `ApplicationSetting` is already the live store for **real-money game variant configuration**
 * (`dice-variant`, `crash-variant`, `roulette-variant`, `card-variant`) plus alerts, missions,
 * seasons and tournaments — 37 call sites. Exposing generic CRUD over it would hand an operator a
 * UI that edits game odds. Settings therefore live in `SystemSetting`, which had no writer at all.
 *
 * DELIBERATELY ABSENT FROM THIS REGISTRY, each for a stated reason:
 *   - wallet / payout / financial limits ............ money-affecting
 *   - game odds, variants, engine configuration ..... money-affecting (and in ApplicationSetting)
 *   - settlement logic .............................. money-affecting
 *   - RG_LIMIT_INCREASE_DELAY_HOURS ................. responsible-gaming ENFORCEMENT control
 *   - SESSION_IDLE_TIMEOUT_MINUTES .................. security control
 *   - CASHIER_LARGE_WITHDRAWAL_THRESHOLD ............ money-affecting AND an open client decision
 *
 * Adding any of those would require its own audited change with the safety implications reviewed.
 */

export type SettingType = 'STRING' | 'BOOLEAN' | 'INTEGER';

export interface SettingDefinition {
  key: string;
  type: SettingType;
  /** Value used when nothing is stored. Settings always resolve — there is no undefined state. */
  defaultValue: string | boolean | number;
  description: string;
  /** Permission required to CHANGE it. Reading the admin list needs `settings:read`. */
  writePermission: PermissionSlug;
  /** Exposed on the unauthenticated public endpoint (never anything sensitive). */
  isPublic: boolean;
  /** Does changing it need a service restart to take effect? Surfaced to the operator. */
  requiresRestart: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
}

/**
 * Every setting this platform exposes.
 *
 * Kept deliberately small and strictly non-money: operator contact details and a maintenance
 * banner. These are values an operator genuinely needs to change without a deploy, and none of them
 * can affect a balance, a payout, a game outcome or a compliance control.
 */
export const SETTINGS_REGISTRY: Record<string, SettingDefinition> = {
  'platform.support_email': {
    key: 'platform.support_email',
    type: 'STRING',
    defaultValue: '',
    description: 'Support email shown to players. Empty means no email channel is advertised.',
    writePermission: PERMISSIONS.SETTINGS_WRITE,
    isPublic: true,
    requiresRestart: false,
    maxLength: 200,
  },
  'platform.support_phone': {
    key: 'platform.support_phone',
    type: 'STRING',
    defaultValue: '',
    description: 'Support phone shown to players. Empty means no phone channel is advertised.',
    writePermission: PERMISSIONS.SETTINGS_WRITE,
    isPublic: true,
    requiresRestart: false,
    maxLength: 40,
  },
  'platform.maintenance_banner_enabled': {
    key: 'platform.maintenance_banner_enabled',
    type: 'BOOLEAN',
    defaultValue: false,
    description: 'Show a maintenance notice to players. Display only — it does NOT stop play, deposits or withdrawals.',
    writePermission: PERMISSIONS.SETTINGS_WRITE,
    isPublic: true,
    requiresRestart: false,
  },
  'platform.maintenance_banner_message': {
    key: 'platform.maintenance_banner_message',
    type: 'STRING',
    defaultValue: '',
    description: 'Text of the maintenance notice. Display only.',
    writePermission: PERMISSIONS.SETTINGS_WRITE,
    isPublic: true,
    requiresRestart: false,
    maxLength: 300,
  },
  'platform.support_response_hours': {
    key: 'platform.support_response_hours',
    type: 'INTEGER',
    defaultValue: 24,
    description: 'Target first-response time in hours, shown to players on the support page. Display only.',
    writePermission: PERMISSIONS.SETTINGS_WRITE,
    isPublic: true,
    requiresRestart: false,
    min: 1,
    max: 720,
  },
};

export const SETTING_KEYS = Object.keys(SETTINGS_REGISTRY);

/** Resolve a key, or `null` when it is not on the allow-list. */
export function settingDefinition(key: string): SettingDefinition | null {
  return Object.prototype.hasOwnProperty.call(SETTINGS_REGISTRY, key)
    ? SETTINGS_REGISTRY[key]!
    : null;
}
