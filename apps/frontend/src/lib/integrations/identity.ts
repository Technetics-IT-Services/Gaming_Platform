/**
 * Identity-provider adapters (Phase 9, STEP 5).
 *
 * Production `IWebAuthnProvider` (FROZEN security interface) with challenge management,
 * an `IDeviceTrustProvider` (FROZEN compliance interface) backed by an IP-reputation
 * API, and a generic OIDC/OAuth2 adapter. Implements existing interfaces only; SAML is
 * defined as an interface for a downstream adapter.
 */
import { type DeviceFingerprint, type DeviceReputation, type IDeviceTrustProvider } from '@/lib/compliance';
import { type IWebAuthnProvider } from '@/lib/security';

import { type HttpTransport, ProviderError, requireConfig } from './transport';

/* -------------------------------- WebAuthn -------------------------------- */

/** Verifies attestation/assertion (production binds @simplewebauthn/server here). */
export interface WebAuthnVerifier {
  verifyRegistration(input: { userId: string; response: unknown; challenge: string; rpId: string; origin: string }): Promise<{ credentialId: string; publicKey: string; counter: number }>;
  verifyAuthentication(input: { userId: string; response: unknown; challenge: string; rpId: string; origin: string }): Promise<{ ok: boolean; newCounter: number }>;
}

export class WebAuthnServerProvider implements IWebAuthnProvider {
  readonly name = 'webauthn';
  private readonly challenges = new Map<string, string>();
  constructor(
    private readonly cfg: { rpId: string; rpName: string; origin: string },
    private readonly verifier: WebAuthnVerifier,
    private readonly randomChallenge: () => string = defaultChallenge,
  ) {}

  async registrationOptions(input: { userId: string; userName: string }): Promise<Record<string, unknown>> {
    const challenge = this.randomChallenge();
    this.challenges.set(`reg:${input.userId}`, challenge);
    return { rp: { id: this.cfg.rpId, name: this.cfg.rpName }, user: { id: input.userId, name: input.userName, displayName: input.userName }, challenge, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], timeout: 60_000, attestation: 'none' };
  }
  async verifyRegistration(input: { userId: string; response: unknown }): Promise<{ credentialId: string; publicKey: string; counter: number }> {
    const challenge = this.challenges.get(`reg:${input.userId}`);
    if (!challenge) throw new ProviderError('webauthn', 'verification_failed', 'no registration challenge');
    this.challenges.delete(`reg:${input.userId}`);
    return this.verifier.verifyRegistration({ ...input, challenge, rpId: this.cfg.rpId, origin: this.cfg.origin });
  }
  async authenticationOptions(input: { userId: string }): Promise<Record<string, unknown>> {
    const challenge = this.randomChallenge();
    this.challenges.set(`auth:${input.userId}`, challenge);
    return { rpId: this.cfg.rpId, challenge, timeout: 60_000, userVerification: 'preferred' };
  }
  async verifyAuthentication(input: { userId: string; response: unknown }): Promise<{ ok: boolean; newCounter: number }> {
    const challenge = this.challenges.get(`auth:${input.userId}`);
    if (!challenge) return { ok: false, newCounter: 0 };
    this.challenges.delete(`auth:${input.userId}`);
    return this.verifier.verifyAuthentication({ ...input, challenge, rpId: this.cfg.rpId, origin: this.cfg.origin });
  }
}

function defaultChallenge(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------ device trust ------------------------------ */

export interface DeviceTrustConfig {
  endpoint: string;
  apiKey: string;
}

/** IP-reputation / VPN / Tor / proxy assessment via a threat-intel API. */
export class IpReputationDeviceProvider implements IDeviceTrustProvider {
  readonly name = 'ip-reputation';
  constructor(private readonly cfg: DeviceTrustConfig, private readonly http: HttpTransport) {}
  static fromConfig(config: Record<string, string | undefined>, http: HttpTransport): IpReputationDeviceProvider {
    return new IpReputationDeviceProvider({ endpoint: requireConfig(config, 'IPREP_URL', 'ip-reputation'), apiKey: requireConfig(config, 'IPREP_API_KEY', 'ip-reputation') }, http);
  }
  async assess(fp: DeviceFingerprint): Promise<DeviceReputation> {
    const ip = fp.ip ?? '';
    const res = await this.http.request({ method: 'GET', url: `${this.cfg.endpoint}/check?ip=${encodeURIComponent(ip)}`, headers: { Authorization: `Bearer ${this.cfg.apiKey}` }, timeoutMs: 5_000 });
    if (res.status < 200 || res.status >= 300) {
      // Fail closed-ish: unknown reputation, flag nothing false-positively.
      return { vpn: false, tor: false, ipReputation: 50 };
    }
    const j = JSON.parse(res.body) as { vpn?: boolean; tor?: boolean; proxy?: boolean; score?: number };
    return { vpn: !!j.vpn, tor: !!j.tor, proxy: !!j.proxy, ipReputation: typeof j.score === 'number' ? j.score : 50 };
  }
}

/* ---------------------------------- OIDC ---------------------------------- */

export interface OIDCConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}
export interface IOIDCProvider {
  readonly name: string;
  authorizationUrl(state: string, nonce: string, scope?: string): string;
  exchangeCode(code: string): Promise<{ accessToken: string; idToken?: string; expiresIn: number }>;
  userInfo(accessToken: string): Promise<Record<string, unknown>>;
}
export class OIDCProvider implements IOIDCProvider {
  readonly name = 'oidc';
  constructor(private readonly cfg: OIDCConfig, private readonly http: HttpTransport) {}
  authorizationUrl(state: string, nonce: string, scope = 'openid profile email'): string {
    const q = new URLSearchParams({ response_type: 'code', client_id: this.cfg.clientId, redirect_uri: this.cfg.redirectUri, scope, state, nonce });
    return `${this.cfg.issuer}/authorize?${q.toString()}`;
  }
  async exchangeCode(code: string): Promise<{ accessToken: string; idToken?: string; expiresIn: number }> {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.cfg.redirectUri, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }).toString();
    const res = await this.http.request({ method: 'POST', url: `${this.cfg.issuer}/token`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (res.status !== 200) throw new ProviderError('oidc', 'auth', `token ${res.status}`, res.status);
    const j = JSON.parse(res.body) as { access_token: string; id_token?: string; expires_in: number };
    return { accessToken: j.access_token, idToken: j.id_token, expiresIn: j.expires_in };
  }
  async userInfo(accessToken: string): Promise<Record<string, unknown>> {
    const res = await this.http.request({ method: 'GET', url: `${this.cfg.issuer}/userinfo`, headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status !== 200) throw new ProviderError('oidc', 'auth', `userinfo ${res.status}`, res.status);
    return JSON.parse(res.body) as Record<string, unknown>;
  }
}

/** SAML 2.0 provider interface (downstream adapter binds a SAML library). */
export interface ISAMLProvider {
  readonly name: string;
  loginUrl(relayState: string): string;
  verifyAssertion(samlResponse: string): Promise<{ ok: boolean; nameId?: string; attributes?: Record<string, string> }>;
}
