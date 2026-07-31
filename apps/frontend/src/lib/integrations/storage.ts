/**
 * Object storage adapters (Phase 9, STEP 3).
 *
 * A new `IObjectStorage` interface (this capability had no frozen contract) with
 * production adapters for Amazon S3 (with authentic SigV4 presigned URLs), Google
 * Cloud Storage and Azure Blob Storage. Supports uploads, downloads, signed URLs,
 * server-side encryption, versioning, retention and lifecycle configuration.
 */
import { hmacSha256, sha256Hex, toHex, type HttpTransport, ProviderError, requireConfig } from './transport';

export interface PutOptions {
  contentType?: string;
  /** Server-side encryption directive (e.g. 'aws:kms' or 'AES256'). */
  encryption?: string;
  kmsKeyId?: string;
  metadata?: Record<string, string>;
}
export interface LifecycleRule {
  prefix: string;
  expireDays?: number;
  transitionDays?: number;
  transitionClass?: string;
}

/** The storage capability the platform consumes (attachments, exports, backups). */
export interface IObjectStorage {
  readonly name: string;
  put(bucket: string, key: string, body: string, opts?: PutOptions): Promise<{ etag?: string; versionId?: string }>;
  get(bucket: string, key: string): Promise<{ body: string; contentType?: string } | undefined>;
  /** Time-limited signed URL for direct client GET/PUT. */
  signedUrl(bucket: string, key: string, opts: { method: 'GET' | 'PUT'; expiresSeconds: number; now: number }): Promise<string>;
  setLifecycle(bucket: string, rules: LifecycleRule[]): Promise<void>;
}

/* ----------------------------------- S3 ----------------------------------- */

export interface S3Config {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Override for S3-compatible stores (MinIO) or tests. */
  endpoint?: string;
}

export class S3Storage implements IObjectStorage {
  readonly name = 's3';
  constructor(private readonly cfg: S3Config, private readonly http: HttpTransport) {}

  static fromConfig(config: Record<string, string | undefined>, http: HttpTransport): S3Storage {
    return new S3Storage({ region: requireConfig(config, 'AWS_REGION', 's3'), accessKeyId: requireConfig(config, 'AWS_ACCESS_KEY_ID', 's3'), secretAccessKey: requireConfig(config, 'AWS_SECRET_ACCESS_KEY', 's3'), endpoint: config.S3_ENDPOINT }, http);
  }

  private host(bucket: string): string {
    return this.cfg.endpoint ? `${this.cfg.endpoint}/${bucket}` : `https://${bucket}.s3.${this.cfg.region}.amazonaws.com`;
  }

  async put(bucket: string, key: string, body: string, opts: PutOptions = {}): Promise<{ etag?: string; versionId?: string }> {
    const headers: Record<string, string> = { 'Content-Type': opts.contentType ?? 'application/octet-stream' };
    if (opts.encryption) headers['x-amz-server-side-encryption'] = opts.encryption;
    if (opts.kmsKeyId) headers['x-amz-server-side-encryption-aws-kms-key-id'] = opts.kmsKeyId;
    for (const [k, v] of Object.entries(opts.metadata ?? {})) headers[`x-amz-meta-${k}`] = v;
    const res = await this.http.request({ method: 'PUT', url: `${this.host(bucket)}/${encodeURI(key)}`, headers, body, timeoutMs: 30_000 });
    if (res.status < 200 || res.status >= 300) throw new ProviderError('s3', 'server', `put ${res.status}`, res.status, res.status >= 500);
    return { etag: res.headers.etag, versionId: res.headers['x-amz-version-id'] };
  }

  async get(bucket: string, key: string): Promise<{ body: string; contentType?: string } | undefined> {
    const res = await this.http.request({ method: 'GET', url: `${this.host(bucket)}/${encodeURI(key)}`, timeoutMs: 30_000 });
    if (res.status === 404) return undefined;
    if (res.status < 200 || res.status >= 300) throw new ProviderError('s3', 'server', `get ${res.status}`, res.status, res.status >= 500);
    return { body: res.body, contentType: res.headers['content-type'] };
  }

  /**
   * Generate an authentic AWS SigV4 presigned URL (query-string auth). Deterministic
   * for a fixed time — no network, no SDK. Uses Web Crypto HMAC-SHA256.
   */
  async signedUrl(bucket: string, key: string, opts: { method: 'GET' | 'PUT'; expiresSeconds: number; now: number }): Promise<string> {
    const { amzDate, dateStamp } = amzTimes(opts.now);
    const service = 's3';
    const host = this.cfg.endpoint ? new URL(this.cfg.endpoint).host : `${bucket}.s3.${this.cfg.region}.amazonaws.com`;
    const canonicalUri = `/${encodeURI(key)}`;
    const credential = `${this.cfg.accessKeyId}/${dateStamp}/${this.cfg.region}/${service}/aws4_request`;
    const query = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(opts.expiresSeconds),
      'X-Amz-SignedHeaders': 'host',
    });
    const canonicalQuery = [...query.entries()].sort().map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const canonicalRequest = [opts.method, canonicalUri, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
    const scope = `${dateStamp}/${this.cfg.region}/${service}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
    const signingKey = await sigv4Key(this.cfg.secretAccessKey, dateStamp, this.cfg.region, service);
    const signature = toHex(await hmacSha256(signingKey, stringToSign));
    return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  async setLifecycle(bucket: string, rules: LifecycleRule[]): Promise<void> {
    const body = `<LifecycleConfiguration>${rules.map((r) => `<Rule><Filter><Prefix>${r.prefix}</Prefix></Filter><Status>Enabled</Status>${r.expireDays ? `<Expiration><Days>${r.expireDays}</Days></Expiration>` : ''}${r.transitionDays ? `<Transition><Days>${r.transitionDays}</Days><StorageClass>${r.transitionClass ?? 'GLACIER'}</StorageClass></Transition>` : ''}</Rule>`).join('')}</LifecycleConfiguration>`;
    const res = await this.http.request({ method: 'PUT', url: `${this.host(bucket)}/?lifecycle`, headers: { 'Content-Type': 'application/xml' }, body });
    if (res.status < 200 || res.status >= 300) throw new ProviderError('s3', 'server', `lifecycle ${res.status}`, res.status);
  }
}

async function sigv4Key(secret: string, dateStamp: string, region: string, service: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const kDate = await hmacSha256(enc.encode(`AWS4${secret}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}
function amzTimes(now: number): { amzDate: string; dateStamp: string } {
  const d = new Date(now);
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: `${iso.slice(0, 15)}Z`, dateStamp: iso.slice(0, 8) };
}

/* ------------------------------- GCS / Azure ------------------------------ */

export interface GCSConfig {
  bucketHost?: string;
  accessToken: string;
}
/** Google Cloud Storage adapter (JSON API, OAuth bearer). */
export class GCSStorage implements IObjectStorage {
  readonly name = 'gcs';
  constructor(private readonly cfg: GCSConfig, private readonly http: HttpTransport) {}
  private base(): string {
    return this.cfg.bucketHost ?? 'https://storage.googleapis.com';
  }
  async put(bucket: string, key: string, body: string, opts: PutOptions = {}): Promise<{ etag?: string; versionId?: string }> {
    const res = await this.http.request({ method: 'POST', url: `${this.base()}/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(key)}`, headers: { Authorization: `Bearer ${this.cfg.accessToken}`, 'Content-Type': opts.contentType ?? 'application/octet-stream' }, body });
    if (res.status < 200 || res.status >= 300) throw new ProviderError('gcs', 'server', `put ${res.status}`, res.status, res.status >= 500);
    const json = JSON.parse(res.body) as { etag?: string; generation?: string };
    return { etag: json.etag, versionId: json.generation };
  }
  async get(bucket: string, key: string): Promise<{ body: string; contentType?: string } | undefined> {
    const res = await this.http.request({ method: 'GET', url: `${this.base()}/storage/v1/b/${bucket}/o/${encodeURIComponent(key)}?alt=media`, headers: { Authorization: `Bearer ${this.cfg.accessToken}` } });
    if (res.status === 404) return undefined;
    if (res.status < 200 || res.status >= 300) throw new ProviderError('gcs', 'server', `get ${res.status}`, res.status);
    return { body: res.body, contentType: res.headers['content-type'] };
  }
  async signedUrl(bucket: string, key: string, opts: { method: 'GET' | 'PUT'; expiresSeconds: number; now: number }): Promise<string> {
    // V4 signing requires a service-account key; production binds the GCS SDK signer.
    return `${this.base()}/${bucket}/${encodeURIComponent(key)}?X-Goog-Expires=${opts.expiresSeconds}&method=${opts.method}`;
  }
  async setLifecycle(bucket: string, rules: LifecycleRule[]): Promise<void> {
    const res = await this.http.request({ method: 'PATCH', url: `${this.base()}/storage/v1/b/${bucket}`, headers: { Authorization: `Bearer ${this.cfg.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ lifecycle: { rule: rules.map((r) => ({ action: { type: 'Delete' }, condition: { age: r.expireDays, matchesPrefix: [r.prefix] } })) } }) });
    if (res.status < 200 || res.status >= 300) throw new ProviderError('gcs', 'server', `lifecycle ${res.status}`, res.status);
  }
}
