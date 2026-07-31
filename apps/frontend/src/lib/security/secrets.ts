/**
 * Secret management (Phase 8, STEP 3).
 *
 * A provider-agnostic secret abstraction with key versioning, rotation and an audit
 * trail. Real deployments bind KMS / Vault / cloud secret managers behind the same
 * `ISecretProvider` interface; an in-memory reference provider ships for tests. It
 * never logs raw secret values — access is audited by reference only.
 */

export interface SecretVersion {
  version: number;
  createdAt: number;
  /** Whether this version is the current/primary one. */
  primary: boolean;
}
export interface SecretMetadata {
  name: string;
  versions: SecretVersion[];
  rotatedAt?: number;
}

/** The pluggable backend (KMS/Vault/cloud). Values never leave the provider raw. */
export interface ISecretProvider {
  readonly name: string;
  get(name: string, version?: number): Promise<string | undefined>;
  set(name: string, value: string): Promise<SecretVersion>;
  list(): Promise<string[]>;
  metadata(name: string): Promise<SecretMetadata | undefined>;
}

export interface SecretAuditRecord {
  at: number;
  action: 'get' | 'set' | 'rotate' | 'access_denied';
  name: string;
  version?: number;
  actor?: string;
}

/** In-memory reference provider (deterministic, for tests). */
export class InMemorySecretProvider implements ISecretProvider {
  readonly name = 'in-memory';
  private readonly store = new Map<string, { value: string; version: number }[]>();
  constructor(private readonly clock: () => number = () => Date.now()) {}

  async set(name: string, value: string): Promise<SecretVersion> {
    const versions = this.store.get(name) ?? [];
    const version = versions.length + 1;
    versions.push({ value, version });
    this.store.set(name, versions);
    return { version, createdAt: this.clock(), primary: true };
  }
  async get(name: string, version?: number): Promise<string | undefined> {
    const versions = this.store.get(name);
    if (!versions || versions.length === 0) return undefined;
    if (version === undefined) return versions[versions.length - 1]!.value; // latest = primary
    return versions.find((v) => v.version === version)?.value;
  }
  async list(): Promise<string[]> {
    return [...this.store.keys()];
  }
  async metadata(name: string): Promise<SecretMetadata | undefined> {
    const versions = this.store.get(name);
    if (!versions) return undefined;
    return { name, versions: versions.map((v, i) => ({ version: v.version, createdAt: 0, primary: i === versions.length - 1 })) };
  }
}

/**
 * The audited secret manager fronting any provider. Rotation creates a new version
 * (the previous stays readable for grace-period decryption). Every access is audited
 * by reference — raw values are never recorded.
 */
export class SecretManager {
  private readonly audit: SecretAuditRecord[] = [];
  constructor(private readonly provider: ISecretProvider, private readonly clock: () => number = () => Date.now()) {}

  async get(name: string, opts: { version?: number; actor?: string } = {}): Promise<string | undefined> {
    const value = await this.provider.get(name, opts.version);
    this.audit.push({ at: this.clock(), action: 'get', name, version: opts.version, actor: opts.actor });
    return value;
  }
  async set(name: string, value: string, actor?: string): Promise<SecretVersion> {
    const v = await this.provider.set(name, value);
    this.audit.push({ at: this.clock(), action: 'set', name, version: v.version, actor });
    return v;
  }
  /** Rotate: write a new version (returns it). Old versions remain for grace decryption. */
  async rotate(name: string, newValue: string, actor?: string): Promise<SecretVersion> {
    const v = await this.provider.set(name, newValue);
    this.audit.push({ at: this.clock(), action: 'rotate', name, version: v.version, actor });
    return v;
  }
  async currentVersion(name: string): Promise<number | undefined> {
    return (await this.provider.metadata(name))?.versions.find((v) => v.primary)?.version;
  }
  auditTrail(name?: string): SecretAuditRecord[] {
    return this.audit.filter((r) => !name || r.name === name);
  }
}

/* -------------------- external provider interface stubs ------------------- */

/** KMS envelope-encryption interface (AWS KMS / GCP KMS / Azure Key Vault). */
export interface IKMSProvider {
  readonly name: string;
  encrypt(keyId: string, plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; keyVersion: string }>;
  decrypt(keyId: string, ciphertext: Uint8Array): Promise<Uint8Array>;
  generateDataKey(keyId: string): Promise<{ plaintext: Uint8Array; ciphertext: Uint8Array }>;
}
/** HashiCorp Vault-style dynamic-secret interface. */
export interface IVaultProvider {
  readonly name: string;
  read(path: string): Promise<Record<string, unknown> | undefined>;
  write(path: string, data: Record<string, unknown>): Promise<void>;
  /** Lease a dynamic (short-lived) credential, e.g. a DB user. */
  lease(path: string): Promise<{ id: string; data: Record<string, unknown>; ttlSeconds: number }>;
}
