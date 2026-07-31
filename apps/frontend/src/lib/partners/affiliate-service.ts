/**
 * Affiliate service (Phase 6C, STEP 2).
 *
 * Affiliate profiles, tracking codes + links, campaign tracking, click→conversion
 * lifecycle and attribution rules (first-click / last-click). Tracks marketing
 * attribution only — it grants nothing and moves no money.
 */
import { secureId } from './util';
import {
  type AffiliateLink,
  type AffiliateProfile,
  AttributionModel,
  type Conversion,
  ConversionStatus,
  type TrackingCode,
} from './types';

export class AffiliateService {
  private readonly profiles = new Map<string, AffiliateProfile>();
  private readonly codes = new Map<string, TrackingCode>();
  private readonly conversions = new Map<string, Conversion>();
  /** playerId → attributed affiliateId (dedupe / attribution guard). */
  private readonly attributed = new Map<string, string>();

  constructor(
    private readonly baseUrl = 'https://track.example.com',
    private readonly clock: () => number = () => Date.now(),
  ) {}

  register(partnerId: string, attribution: AttributionModel = AttributionModel.LastClick): AffiliateProfile {
    const profile: AffiliateProfile = { partnerId, attribution, codes: [] };
    this.profiles.set(partnerId, profile);
    return profile;
  }
  profile(partnerId: string): AffiliateProfile {
    const p = this.profiles.get(partnerId);
    if (!p) throw new Error('no such affiliate');
    return p;
  }

  /** Mint a tracking code (optionally scoped to a campaign). */
  createCode(affiliateId: string, opts?: { code?: string; campaign?: string }): TrackingCode {
    const profile = this.profile(affiliateId);
    const code = (opts?.code ?? secureId('trk', 4)).toUpperCase();
    if (this.codes.has(code)) throw new Error('code already exists');
    const tracking: TrackingCode = { code, affiliateId, campaign: opts?.campaign, createdAt: this.clock() };
    this.codes.set(code, tracking);
    profile.codes.push(code);
    return tracking;
  }
  link(code: string): AffiliateLink {
    const t = this.codes.get(code.toUpperCase());
    if (!t) throw new Error('unknown code');
    const qs = t.campaign ? `?ref=${t.code}&c=${encodeURIComponent(t.campaign)}` : `?ref=${t.code}`;
    return { code: t.code, url: `${this.baseUrl}${qs}`, campaign: t.campaign };
  }

  /** Record a click (start of the conversion funnel). */
  click(code: string): Conversion {
    const t = this.codes.get(code.toUpperCase());
    if (!t) throw new Error('unknown code');
    const now = this.clock();
    const conv: Conversion = { id: secureId('cnv'), affiliateId: t.affiliateId, code: t.code, campaign: t.campaign, status: ConversionStatus.Clicked, clickedAt: now, updatedAt: now };
    this.conversions.set(conv.id, conv);
    return conv;
  }

  /**
   * Attribute a player registration to a conversion, honoring the affiliate's model.
   * First-click keeps an existing attribution; last-click overwrites it.
   */
  attribute(conversionId: string, playerId: string): Conversion {
    const conv = this.conversions.get(conversionId);
    if (!conv) throw new Error('no such conversion');
    const model = this.profile(conv.affiliateId).attribution;
    const existing = this.attributed.get(playerId);
    if (existing && model === AttributionModel.FirstClick) {
      // keep the first attribution; mark this later touch as rejected
      conv.status = ConversionStatus.Rejected;
      conv.updatedAt = this.clock();
      return conv;
    }
    this.attributed.set(playerId, conv.affiliateId);
    conv.playerId = playerId;
    conv.status = ConversionStatus.Registered;
    conv.updatedAt = this.clock();
    return conv;
  }

  /** Mark a registered conversion qualified (e.g. first deposit met). */
  qualify(conversionId: string): Conversion {
    const conv = this.conversions.get(conversionId);
    if (!conv) throw new Error('no such conversion');
    if (conv.status !== ConversionStatus.Registered) throw new Error(`cannot qualify from ${conv.status}`);
    conv.status = ConversionStatus.Qualified;
    conv.updatedAt = this.clock();
    return conv;
  }

  attributionOf(playerId: string): string | undefined {
    return this.attributed.get(playerId);
  }
  conversionsFor(affiliateId: string): Conversion[] {
    return [...this.conversions.values()].filter((c) => c.affiliateId === affiliateId);
  }
  playersFor(affiliateId: string): string[] {
    return [...this.attributed.entries()].filter(([, aff]) => aff === affiliateId).map(([playerId]) => playerId);
  }

  /** Acquisition funnel counts for a campaign (or all) of an affiliate. */
  campaignStats(affiliateId: string, campaign?: string): { clicks: number; registrations: number; qualified: number } {
    const rows = this.conversionsFor(affiliateId).filter((c) => campaign === undefined || c.campaign === campaign);
    return {
      clicks: rows.length,
      registrations: rows.filter((c) => c.status === ConversionStatus.Registered || c.status === ConversionStatus.Qualified).length,
      qualified: rows.filter((c) => c.status === ConversionStatus.Qualified).length,
    };
  }
}
