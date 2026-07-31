/**
 * Theme Platform (Phase 3.1, STEP 9).
 *
 * Stores and resolves theme configuration: light / dark / custom modes, brand themes,
 * operator themes and asset packs. Resolution composes design tokens: base theme ←
 * operator theme ← tenant theme. Configuration ONLY — emits a flat token map the UI can
 * apply as CSS variables; no frozen module, no redesign.
 */
import { defaultTheme } from './defaults';
import { type ThemeConfiguration, ThemeMode } from './types';

const LIGHT_TOKENS: Record<string, string> = { '--color-bg': '#f8fafc', '--color-fg': '#0f172a', '--color-primary': '#7c3aed', '--color-accent': '#0ea5e9' };
const DARK_TOKENS: Record<string, string> = { '--color-bg': '#0b0f19', '--color-fg': '#e5e7eb', '--color-primary': '#7c3aed', '--color-accent': '#0ea5e9' };

export class ThemePlatform {
  private readonly namedThemes = new Map<string, ThemeConfiguration>();
  private readonly byOperator = new Map<string, Partial<ThemeConfiguration>>();
  private readonly byTenant = new Map<string, Partial<ThemeConfiguration>>();

  constructor() {
    this.namedThemes.set('light', { mode: ThemeMode.Light, tokens: LIGHT_TOKENS });
    this.namedThemes.set('dark', { mode: ThemeMode.Dark, tokens: DARK_TOKENS });
  }

  /** Register a reusable brand theme by id. */
  defineTheme(id: string, theme: ThemeConfiguration): void {
    this.namedThemes.set(id, theme);
  }
  setOperatorTheme(operatorId: string, theme: Partial<ThemeConfiguration>): void {
    this.byOperator.set(operatorId, theme);
  }
  setTenantTheme(tenantId: string, theme: Partial<ThemeConfiguration>): void {
    this.byTenant.set(tenantId, theme);
  }
  getNamed(id: string): ThemeConfiguration | undefined {
    return this.namedThemes.get(id);
  }

  /** Resolve the effective theme for a tenant. */
  resolve(input: { tenantId: string; operatorId?: string; tenantTheme?: Partial<ThemeConfiguration> }): ThemeConfiguration {
    const stored = this.byTenant.get(input.tenantId);
    const base = pickBase(stored ?? input.tenantTheme, this.namedThemes) ?? defaultTheme();
    const operator = input.operatorId ? this.byOperator.get(input.operatorId) : undefined;

    let tokens = { ...base.tokens };
    let mode = base.mode;
    let assetPack = base.assetPack;
    for (const layer of [operator, stored, input.tenantTheme]) {
      if (!layer) continue;
      if (layer.mode) mode = layer.mode;
      if (layer.tokens) tokens = { ...tokens, ...layer.tokens };
      if (layer.assetPack) assetPack = layer.assetPack;
    }
    return { mode, tokens, assetPack, baseThemeId: base.baseThemeId };
  }

  /** Flatten a resolved theme to `--var: value;` CSS custom-property text. */
  toCssVariables(theme: ThemeConfiguration): string {
    return Object.entries(theme.tokens).map(([k, v]) => `${k}: ${v};`).join(' ');
  }
}

function pickBase(theme: Partial<ThemeConfiguration> | undefined, named: Map<string, ThemeConfiguration>): ThemeConfiguration | undefined {
  if (theme?.baseThemeId && named.has(theme.baseThemeId)) return named.get(theme.baseThemeId);
  if (theme?.mode && named.has(theme.mode)) return named.get(theme.mode);
  return undefined;
}
