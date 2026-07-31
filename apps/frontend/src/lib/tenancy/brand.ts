/**
 * Brand Platform (Phase 3.1, STEP 8).
 *
 * Stores and resolves per-tenant brand configuration (name, logo, favicon, colors,
 * typography, email/SMS/push templates, support info, social links). Configuration ONLY
 * — no frontend redesign, no frozen module. A tenant's brand overrides an optional
 * operator-level base brand, which overrides a platform default.
 */
import { defaultBrand } from './defaults';
import type { BrandConfiguration } from './types';

export class BrandPlatform {
  private platformDefault: BrandConfiguration = defaultBrand('Casino');
  private readonly byOperator = new Map<string, Partial<BrandConfiguration>>();
  private readonly byTenant = new Map<string, Partial<BrandConfiguration>>();

  setPlatformDefault(brand: BrandConfiguration): void {
    this.platformDefault = brand;
  }
  setOperatorBrand(operatorId: string, brand: Partial<BrandConfiguration>): void {
    this.byOperator.set(operatorId, brand);
  }
  setTenantBrand(tenantId: string, brand: Partial<BrandConfiguration>): void {
    this.byTenant.set(tenantId, brand);
  }

  /** Resolve the effective brand: platform default ← operator ← tenant ← stored tenant brand. */
  resolve(input: { tenantId: string; operatorId?: string; tenantBrand?: Partial<BrandConfiguration> }): BrandConfiguration {
    return merge(
      this.platformDefault,
      input.operatorId ? this.byOperator.get(input.operatorId) : undefined,
      this.byTenant.get(input.tenantId),
      input.tenantBrand,
    );
  }

  /** Render a named template (email/sms/push) with `{{var}}` substitution. */
  renderTemplate(brand: BrandConfiguration, channel: 'email' | 'sms' | 'push', name: string, vars: Record<string, string> = {}): string | null {
    const templates = channel === 'email' ? brand.emailTemplates : channel === 'sms' ? brand.smsTemplates : brand.pushTemplates;
    const tpl = templates?.[name];
    if (tpl === undefined) return null;
    return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
  }
}

function merge(base: BrandConfiguration, ...patches: (Partial<BrandConfiguration> | undefined)[]): BrandConfiguration {
  let out: BrandConfiguration = { ...base };
  for (const p of patches) {
    if (!p) continue;
    out = {
      ...out,
      ...p,
      typography: { ...out.typography, ...p.typography } as BrandConfiguration['typography'],
      emailTemplates: { ...out.emailTemplates, ...p.emailTemplates },
      smsTemplates: { ...out.smsTemplates, ...p.smsTemplates },
      pushTemplates: { ...out.pushTemplates, ...p.pushTemplates },
      support: { ...out.support, ...p.support },
      socialLinks: { ...out.socialLinks, ...p.socialLinks },
    };
  }
  return out;
}
