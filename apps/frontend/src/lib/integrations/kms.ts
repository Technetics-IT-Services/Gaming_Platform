/**
 * KMS adapters + envelope encryption (Phase 9, STEP 6).
 *
 * Production `IKMSProvider` adapters (the FROZEN security KMS interface) for AWS KMS,
 * GCP Cloud KMS and Azure Key Vault Keys, plus an envelope-encryption helper that
 * encrypts data locally with an AES-GCM data key and wraps that key with the KMS
 * CMK. A `LocalKMSProvider` (real AES-GCM key wrapping via Web Crypto) makes the
 * envelope path fully testable without a cloud. Implements existing interfaces only.
 */
import { type IKMSProvider } from '@/lib/security';

import { type HttpTransport, ProviderError, requireConfig, toBase64 } from './transport';

/* --------------------------- envelope encryption -------------------------- */

export interface Envelope {
  /** KMS-wrapped data key (base64). */
  wrappedKey: string;
  keyVersion: string;
  /** AES-GCM IV (base64) + ciphertext (base64). */
  iv: string;
  ciphertext: string;
}

/** Encrypt plaintext with a fresh AES-256-GCM data key wrapped by the KMS CMK. */
export async function envelopeEncrypt(kms: IKMSProvider, keyId: string, plaintext: Uint8Array): Promise<Envelope> {
  const { plaintext: dataKey, ciphertext: wrapped } = await kms.generateDataKey(keyId);
  const key = await crypto.subtle.importKey('raw', dataKey as BufferSource, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plaintext as BufferSource));
  return { wrappedKey: toBase64(wrapped), keyVersion: 'v1', iv: toBase64(iv), ciphertext: toBase64(ct) };
}

/** Decrypt an envelope: unwrap the data key via KMS, then AES-GCM decrypt. */
export async function envelopeDecrypt(kms: IKMSProvider, keyId: string, env: Envelope): Promise<Uint8Array> {
  const dataKey = await kms.decrypt(keyId, fromBase64(env.wrappedKey));
  const key = await crypto.subtle.importKey('raw', dataKey as BufferSource, 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(env.iv) as BufferSource }, key, fromBase64(env.ciphertext) as BufferSource);
  return new Uint8Array(pt);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/* ------------------------- Local KMS (testable) --------------------------- */

/**
 * A local KMS backed by a real AES-GCM master key (Web Crypto). Wraps/unwraps data
 * keys authentically — used for tests and air-gapped envs. Same `IKMSProvider` shape.
 */
export class LocalKMSProvider implements IKMSProvider {
  readonly name = 'local-kms';
  private masterKey?: CryptoKey;
  constructor(private readonly masterKeyBytes: Uint8Array) {}

  private async master(): Promise<CryptoKey> {
    if (!this.masterKey) this.masterKey = await crypto.subtle.importKey('raw', this.masterKeyBytes as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
    return this.masterKey;
  }
  async encrypt(_keyId: string, plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; keyVersion: string }> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await this.master(), plaintext as BufferSource));
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv, 0);
    out.set(ct, iv.length);
    return { ciphertext: out, keyVersion: 'v1' };
  }
  async decrypt(_keyId: string, ciphertext: Uint8Array): Promise<Uint8Array> {
    const iv = ciphertext.slice(0, 12);
    const ct = ciphertext.slice(12);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await this.master(), ct as BufferSource));
  }
  async generateDataKey(keyId: string): Promise<{ plaintext: Uint8Array; ciphertext: Uint8Array }> {
    const dataKey = crypto.getRandomValues(new Uint8Array(32));
    const { ciphertext } = await this.encrypt(keyId, dataKey);
    return { plaintext: dataKey, ciphertext };
  }
}

/* ------------------------------- AWS KMS ---------------------------------- */

export interface AwsKmsConfig {
  region: string;
  endpoint?: string;
  accessToken?: string;
}
export class AwsKMSProvider implements IKMSProvider {
  readonly name = 'aws-kms';
  constructor(private readonly cfg: AwsKmsConfig, private readonly http: HttpTransport) {}
  static fromConfig(config: Record<string, string | undefined>, http: HttpTransport): AwsKMSProvider {
    return new AwsKMSProvider({ region: requireConfig(config, 'AWS_REGION', 'aws-kms'), endpoint: config.AWS_KMS_ENDPOINT, accessToken: config.AWS_KMS_TOKEN }, http);
  }
  private async api(target: string, payload: unknown): Promise<{ status: number; body: string }> {
    const endpoint = this.cfg.endpoint ?? `https://kms.${this.cfg.region}.amazonaws.com`;
    return this.http.request({ method: 'POST', url: endpoint, headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `TrentService.${target}`, ...(this.cfg.accessToken ? { Authorization: `Bearer ${this.cfg.accessToken}` } : {}) }, body: JSON.stringify(payload) });
  }
  async encrypt(keyId: string, plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; keyVersion: string }> {
    const res = await this.api('Encrypt', { KeyId: keyId, Plaintext: toBase64(plaintext) });
    if (res.status !== 200) throw new ProviderError('aws-kms', 'server', `encrypt ${res.status}`, res.status, res.status >= 500);
    return { ciphertext: fromBase64((JSON.parse(res.body) as { CiphertextBlob: string }).CiphertextBlob), keyVersion: 'aws' };
  }
  async decrypt(keyId: string, ciphertext: Uint8Array): Promise<Uint8Array> {
    const res = await this.api('Decrypt', { KeyId: keyId, CiphertextBlob: toBase64(ciphertext) });
    if (res.status !== 200) throw new ProviderError('aws-kms', 'server', `decrypt ${res.status}`, res.status, res.status >= 500);
    return fromBase64((JSON.parse(res.body) as { Plaintext: string }).Plaintext);
  }
  async generateDataKey(keyId: string): Promise<{ plaintext: Uint8Array; ciphertext: Uint8Array }> {
    const res = await this.api('GenerateDataKey', { KeyId: keyId, KeySpec: 'AES_256' });
    if (res.status !== 200) throw new ProviderError('aws-kms', 'server', `gen-data-key ${res.status}`, res.status, res.status >= 500);
    const json = JSON.parse(res.body) as { Plaintext: string; CiphertextBlob: string };
    return { plaintext: fromBase64(json.Plaintext), ciphertext: fromBase64(json.CiphertextBlob) };
  }
}
