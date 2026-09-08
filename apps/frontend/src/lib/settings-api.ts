import { apiClient, unwrap } from './api-client';

/**
 * Platform settings client (AD-09).
 *
 * The server owns the allow-list: only keys it declares can be read or written, and the client
 * never sends a key's type, visibility or description — those are server facts.
 *
 * Money-affecting configuration (game variants, wallet, payout, settlement) and safety controls
 * (responsible gaming, session security) are deliberately NOT part of this surface.
 */

export type SettingType = 'STRING' | 'BOOLEAN' | 'INTEGER';

export interface SettingView {
  key: string;
  value: string | boolean | number;
  type: SettingType;
  description: string;
  isPublic: boolean;
  requiresRestart: boolean;
  /** False means the built-in default is being served. */
  isCustomised: boolean;
  updatedAt: string | null;
}

/** Public settings, readable without authentication. */
export type PublicSettings = Record<string, string | boolean | number>;

export const settingsApi = {
  publicSettings: () => unwrap<PublicSettings>(apiClient.get('/settings/public')),
};

export const adminSettingsApi = {
  list: () => unwrap<SettingView[]>(apiClient.get('/admin/settings')),
  set: (key: string, value: string | boolean | number) =>
    unwrap<SettingView>(apiClient.post(`/admin/settings/${encodeURIComponent(key)}`, { value })),
  reset: (key: string) =>
    unwrap<SettingView>(apiClient.post(`/admin/settings/${encodeURIComponent(key)}/reset`, {})),
};
