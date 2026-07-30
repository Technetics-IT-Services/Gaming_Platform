/**
 * Device trust framework (Phase 5D, STEP 6).
 *
 * `DeviceTrustService` fronts an `IDeviceTrustProvider` (IP reputation / VPN / Tor /
 * proxy hooks) and maintains a trusted-device registry. It derives a `DeviceRisk`
 * band from reputation + trust. Only a deterministic mock provider ships here.
 */
import {
  type DeviceFingerprint,
  type DeviceReputation,
  type DeviceResult,
  DeviceRisk,
  type IDeviceTrustProvider,
  type TrustedDevice,
} from './types';

export class DeviceTrustService {
  private readonly trusted = new Map<string, TrustedDevice>();

  constructor(
    private readonly provider: IDeviceTrustProvider,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Mark a fingerprint trusted for a player (e.g. after step-up auth). */
  trust(playerId: string, fingerprintId: string): void {
    this.trusted.set(this.key(playerId, fingerprintId), { playerId, fingerprintId, trustedAt: this.clock() });
  }
  isTrusted(playerId: string, fingerprintId: string): boolean {
    return this.trusted.has(this.key(playerId, fingerprintId));
  }
  private key(playerId: string, fingerprintId: string): string {
    return `${playerId}:${fingerprintId}`;
  }

  /** Assess a fingerprint (async provider call — cache upstream if needed). */
  async assess(fp: DeviceFingerprint): Promise<DeviceResult> {
    const reputation = await this.provider.assess(fp);
    const trusted = fp.playerId ? this.isTrusted(fp.playerId, fp.id) : false;
    return { risk: DeviceTrustService.risk(reputation, trusted), reputation, trusted, fingerprintId: fp.id };
  }

  static risk(rep: DeviceReputation, trusted: boolean): DeviceRisk {
    if (rep.tor) return DeviceRisk.Blocked;
    if (trusted) return DeviceRisk.Trusted;
    if (rep.vpn || rep.proxy || rep.ipReputation < 40) return DeviceRisk.Suspicious;
    if (rep.ipReputation >= 70) return DeviceRisk.Trusted;
    return DeviceRisk.Unknown;
  }
}

/**
 * Deterministic mock device provider. Seed sets flag which IPs are VPN/Tor/proxy;
 * an explicit reputation map overrides the default (clean = 90).
 */
export class MockDeviceProvider implements IDeviceTrustProvider {
  readonly name = 'mock-device';
  private readonly vpn: Set<string>;
  private readonly tor: Set<string>;
  private readonly proxy: Set<string>;
  private readonly reputation: Map<string, number>;

  constructor(seed?: { vpnIps?: string[]; torIps?: string[]; proxyIps?: string[]; reputation?: Record<string, number> }) {
    this.vpn = new Set(seed?.vpnIps ?? []);
    this.tor = new Set(seed?.torIps ?? []);
    this.proxy = new Set(seed?.proxyIps ?? []);
    this.reputation = new Map(Object.entries(seed?.reputation ?? {}));
  }

  async assess(fp: DeviceFingerprint): Promise<DeviceReputation> {
    const ip = fp.ip ?? '';
    const vpn = this.vpn.has(ip);
    const tor = this.tor.has(ip);
    const proxy = this.proxy.has(ip);
    const explicit = this.reputation.get(ip);
    const ipReputation = explicit ?? (tor ? 5 : vpn || proxy ? 30 : 90);
    return { vpn, tor, proxy, ipReputation };
  }
}
