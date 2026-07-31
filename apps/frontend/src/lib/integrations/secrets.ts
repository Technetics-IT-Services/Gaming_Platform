/**
 * Secret-provider adapters (Phase 9, STEP 4).
 *
 * Production `ISecretProvider` adapters (the FROZEN security secret interface) for AWS
 * Secrets Manager, HashiCorp Vault (also `IVaultProvider`), Azure Key Vault and Google
 * Secret Manager. They implement the existing interface only — the `SecretManager`
 * (versioning/rotation/audit) is unchanged; these just bind the backend.
 */
import { type ISecretProvider, type IVaultProvider, type SecretMetadata, type SecretVersion } from '@/lib/security';

import { type HttpTransport, ProviderError, requireConfig } from './transport';

/* ------------------------- AWS Secrets Manager ---------------------------- */

export interface AwsSMConfig {
  region: string;
  endpoint?: string;
  accessToken?: string; // adapters call an authed proxy/SDK; SigV4 signing handled upstream
}

export class AwsSecretsManagerProvider implements ISecretProvider {
  readonly name = 'aws-secrets-manager';
  constructor(private readonly cfg: AwsSMConfig, private readonly http: HttpTransport, private readonly clock: () => number = () => Date.now()) {}

  static fromConfig(config: Record<string, string | undefined>, http: HttpTransport): AwsSecretsManagerProvider {
    return new AwsSecretsManagerProvider({ region: requireConfig(config, 'AWS_REGION', 'aws-sm'), endpoint: config.AWS_SM_ENDPOINT, accessToken: config.AWS_SM_TOKEN }, http);
  }

  private async api(target: string, payload: unknown): Promise<{ status: number; body: string }> {
    const endpoint = this.cfg.endpoint ?? `https://secretsmanager.${this.cfg.region}.amazonaws.com`;
    return this.http.request({ method: 'POST', url: endpoint, headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `secretsmanager.${target}`, ...(this.cfg.accessToken ? { Authorization: `Bearer ${this.cfg.accessToken}` } : {}) }, body: JSON.stringify(payload) });
  }

  async get(name: string, version?: number): Promise<string | undefined> {
    const res = await this.api('GetSecretValue', { SecretId: name, ...(version ? { VersionId: String(version) } : {}) });
    if (res.status === 400) return undefined;
    if (res.status !== 200) throw new ProviderError('aws-sm', 'server', `get ${res.status}`, res.status, res.status >= 500);
    return (JSON.parse(res.body) as { SecretString?: string }).SecretString;
  }
  async set(name: string, value: string): Promise<SecretVersion> {
    const res = await this.api('PutSecretValue', { SecretId: name, SecretString: value });
    if (res.status !== 200) throw new ProviderError('aws-sm', 'server', `set ${res.status}`, res.status, res.status >= 500);
    const json = JSON.parse(res.body) as { VersionId?: string };
    return { version: Number(json.VersionId ?? 1) || 1, createdAt: this.clock(), primary: true };
  }
  async list(): Promise<string[]> {
    const res = await this.api('ListSecrets', {});
    if (res.status !== 200) return [];
    return (JSON.parse(res.body) as { SecretList?: { Name: string }[] }).SecretList?.map((s) => s.Name) ?? [];
  }
  async metadata(name: string): Promise<SecretMetadata | undefined> {
    const res = await this.api('DescribeSecret', { SecretId: name });
    if (res.status !== 200) return undefined;
    return { name, versions: [{ version: 1, createdAt: this.clock(), primary: true }] };
  }
}

/* ------------------------------ HashiCorp Vault --------------------------- */

export interface VaultConfig {
  addr: string;
  token: string;
  /** KV v2 mount, default 'secret'. */
  mount?: string;
}

export class VaultSecretProvider implements ISecretProvider, IVaultProvider {
  readonly name = 'vault';
  constructor(private readonly cfg: VaultConfig, private readonly http: HttpTransport, private readonly clock: () => number = () => Date.now()) {}

  static fromConfig(config: Record<string, string | undefined>, http: HttpTransport): VaultSecretProvider {
    return new VaultSecretProvider({ addr: requireConfig(config, 'VAULT_ADDR', 'vault'), token: requireConfig(config, 'VAULT_TOKEN', 'vault'), mount: config.VAULT_MOUNT ?? 'secret' }, http);
  }
  private hdr(): Record<string, string> {
    return { 'X-Vault-Token': this.cfg.token, 'Content-Type': 'application/json' };
  }

  async get(name: string, version?: number): Promise<string | undefined> {
    const q = version ? `?version=${version}` : '';
    const res = await this.http.request({ method: 'GET', url: `${this.cfg.addr}/v1/${this.cfg.mount}/data/${name}${q}`, headers: this.hdr() });
    if (res.status === 404) return undefined;
    if (res.status !== 200) throw new ProviderError('vault', 'server', `get ${res.status}`, res.status, res.status >= 500);
    return (JSON.parse(res.body) as { data?: { data?: { value?: string } } }).data?.data?.value;
  }
  async set(name: string, value: string): Promise<SecretVersion> {
    const res = await this.http.request({ method: 'POST', url: `${this.cfg.addr}/v1/${this.cfg.mount}/data/${name}`, headers: this.hdr(), body: JSON.stringify({ data: { value } }) });
    if (res.status < 200 || res.status >= 300) throw new ProviderError('vault', 'server', `set ${res.status}`, res.status, res.status >= 500);
    const v = (JSON.parse(res.body) as { data?: { version?: number } }).data?.version ?? 1;
    return { version: v, createdAt: this.clock(), primary: true };
  }
  async list(): Promise<string[]> {
    const res = await this.http.request({ method: 'GET', url: `${this.cfg.addr}/v1/${this.cfg.mount}/metadata?list=true`, headers: this.hdr() });
    if (res.status !== 200) return [];
    return (JSON.parse(res.body) as { data?: { keys?: string[] } }).data?.keys ?? [];
  }
  async metadata(name: string): Promise<SecretMetadata | undefined> {
    const res = await this.http.request({ method: 'GET', url: `${this.cfg.addr}/v1/${this.cfg.mount}/metadata/${name}`, headers: this.hdr() });
    if (res.status !== 200) return undefined;
    const versions = (JSON.parse(res.body) as { data?: { versions?: Record<string, unknown> } }).data?.versions ?? {};
    const keys = Object.keys(versions).map(Number).sort((a, b) => a - b);
    return { name, versions: keys.map((k, i) => ({ version: k, createdAt: this.clock(), primary: i === keys.length - 1 })) };
  }

  /* --------------------------- IVaultProvider ---------------------------- */
  async read(path: string): Promise<Record<string, unknown> | undefined> {
    const res = await this.http.request({ method: 'GET', url: `${this.cfg.addr}/v1/${path}`, headers: this.hdr() });
    if (res.status !== 200) return undefined;
    return (JSON.parse(res.body) as { data?: Record<string, unknown> }).data;
  }
  async write(path: string, data: Record<string, unknown>): Promise<void> {
    const res = await this.http.request({ method: 'POST', url: `${this.cfg.addr}/v1/${path}`, headers: this.hdr(), body: JSON.stringify(data) });
    if (res.status < 200 || res.status >= 300) throw new ProviderError('vault', 'server', `write ${res.status}`, res.status);
  }
  async lease(path: string): Promise<{ id: string; data: Record<string, unknown>; ttlSeconds: number }> {
    const res = await this.http.request({ method: 'GET', url: `${this.cfg.addr}/v1/${path}`, headers: this.hdr() });
    if (res.status !== 200) throw new ProviderError('vault', 'server', `lease ${res.status}`, res.status);
    const json = JSON.parse(res.body) as { lease_id?: string; data?: Record<string, unknown>; lease_duration?: number };
    return { id: json.lease_id ?? '', data: json.data ?? {}, ttlSeconds: json.lease_duration ?? 0 };
  }
}

/* ---------------------------- Azure Key Vault ----------------------------- */

export class AzureKeyVaultSecretProvider implements ISecretProvider {
  readonly name = 'azure-key-vault';
  constructor(private readonly vaultUrl: string, private readonly accessToken: string, private readonly http: HttpTransport, private readonly clock: () => number = () => Date.now()) {}
  static fromConfig(config: Record<string, string | undefined>, http: HttpTransport): AzureKeyVaultSecretProvider {
    return new AzureKeyVaultSecretProvider(requireConfig(config, 'AZURE_KV_URL', 'azure-kv'), requireConfig(config, 'AZURE_KV_TOKEN', 'azure-kv'), http);
  }
  private hdr(): Record<string, string> {
    return { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' };
  }
  async get(name: string, version?: number): Promise<string | undefined> {
    const res = await this.http.request({ method: 'GET', url: `${this.vaultUrl}/secrets/${name}${version ? `/${version}` : ''}?api-version=7.4`, headers: this.hdr() });
    if (res.status === 404) return undefined;
    if (res.status !== 200) throw new ProviderError('azure-kv', 'server', `get ${res.status}`, res.status, res.status >= 500);
    return (JSON.parse(res.body) as { value?: string }).value;
  }
  async set(name: string, value: string): Promise<SecretVersion> {
    const res = await this.http.request({ method: 'PUT', url: `${this.vaultUrl}/secrets/${name}?api-version=7.4`, headers: this.hdr(), body: JSON.stringify({ value }) });
    if (res.status < 200 || res.status >= 300) throw new ProviderError('azure-kv', 'server', `set ${res.status}`, res.status);
    return { version: 1, createdAt: this.clock(), primary: true };
  }
  async list(): Promise<string[]> {
    const res = await this.http.request({ method: 'GET', url: `${this.vaultUrl}/secrets?api-version=7.4`, headers: this.hdr() });
    if (res.status !== 200) return [];
    return (JSON.parse(res.body) as { value?: { id: string }[] }).value?.map((s) => s.id.split('/').pop() ?? s.id) ?? [];
  }
  async metadata(name: string): Promise<SecretMetadata | undefined> {
    return { name, versions: [{ version: 1, createdAt: this.clock(), primary: true }] };
  }
}
