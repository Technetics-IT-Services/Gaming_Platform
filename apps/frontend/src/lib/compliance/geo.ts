/**
 * Geolocation framework (Phase 5D, STEP 7).
 *
 * `GeoService` classifies a location against configurable country/state rules and
 * restricted regions, with a timezone-consistency hook and an optional IP-lookup
 * provider. Pure classification — it decides nothing on its own; the policy engine
 * turns a `GeoStatus` into an action.
 */
import {
  type GeoResult,
  type GeoSignal,
  GeoStatus,
  type IGeoProvider,
} from './types';

export interface GeoPolicy {
  /** ISO country codes that are fully blocked. */
  blockedCountries?: string[];
  /** Countries allowed only in specific states (others in them are restricted). */
  restrictedStates?: Record<string, string[]>;
  /** If set, only these countries are allowed; all others are blocked. */
  allowedCountries?: string[];
}

export class GeoService {
  private readonly blocked: Set<string>;
  private readonly allowed?: Set<string>;
  private readonly restrictedStates: Map<string, Set<string>>;

  constructor(
    policy: GeoPolicy = {},
    private readonly provider?: IGeoProvider,
  ) {
    this.blocked = new Set((policy.blockedCountries ?? []).map((c) => c.toUpperCase()));
    this.allowed = policy.allowedCountries ? new Set(policy.allowedCountries.map((c) => c.toUpperCase())) : undefined;
    this.restrictedStates = new Map(
      Object.entries(policy.restrictedStates ?? {}).map(([country, states]) => [country.toUpperCase(), new Set(states.map((s) => s.toUpperCase()))]),
    );
  }

  /** Resolve a signal from an IP via the optional provider. */
  async locate(ip: string): Promise<GeoSignal> {
    if (!this.provider) return { ip };
    return this.provider.locate(ip);
  }

  /** Classify a location signal into an allow/restrict/block status. */
  classify(signal: GeoSignal): GeoResult {
    const country = signal.country?.toUpperCase();
    if (!country) return { status: GeoStatus.Unknown, reason: 'no country' };
    if (this.blocked.has(country)) return { status: GeoStatus.Blocked, country, reason: 'blocked country' };
    if (this.allowed && !this.allowed.has(country)) return { status: GeoStatus.Blocked, country, reason: 'country not in allow-list' };

    const states = this.restrictedStates.get(country);
    if (states) {
      const state = signal.state?.toUpperCase();
      if (!state || !states.has(state)) return { status: GeoStatus.Restricted, country, state: signal.state, reason: 'state not permitted' };
    }
    return { status: GeoStatus.Allowed, country, state: signal.state };
  }

  /**
   * Timezone-consistency hook: flags when the reported IANA timezone's region does
   * not match the country (a coarse VPN/location-spoof heuristic).
   */
  timezoneConsistent(signal: GeoSignal, expectedTimezonePrefixByCountry: Record<string, string>): boolean {
    const country = signal.country?.toUpperCase();
    if (!country || !signal.timezone) return true; // nothing to check
    const expectedPrefix = expectedTimezonePrefixByCountry[country];
    if (!expectedPrefix) return true;
    return signal.timezone.startsWith(expectedPrefix);
  }
}

/** Deterministic mock geo provider — maps seeded IPs to signals. */
export class MockGeoProvider implements IGeoProvider {
  readonly name = 'mock-geo';
  private readonly map: Map<string, GeoSignal>;

  constructor(seed: Record<string, GeoSignal> = {}) {
    this.map = new Map(Object.entries(seed));
  }

  async locate(ip: string): Promise<GeoSignal> {
    return this.map.get(ip) ?? { ip, country: 'IN', timezone: 'Asia/Kolkata' };
  }
}
