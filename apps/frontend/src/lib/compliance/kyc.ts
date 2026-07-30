/**
 * KYC framework (Phase 5D, STEP 3).
 *
 * `KYCService` fronts any number of `IKYCProvider` adapters. It caches the latest
 * verification per player so the synchronous decision path can read a status without
 * an inline network call — real deployments refresh KYC out-of-band and cache it.
 * Only a deterministic mock provider ships here (no real credentials).
 */
import {
  DocumentStatus,
  type IKYCProvider,
  IdentityStatus,
  type KYCResult,
  VerificationStatus,
} from './types';

export class KYCService {
  private readonly cache = new Map<string, KYCResult>();

  constructor(
    private readonly provider: IKYCProvider,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /** Call the provider and cache the result (async, out-of-band). */
  async refresh(playerId: string, input?: { documentRef?: string; metadata?: Record<string, unknown> }): Promise<KYCResult> {
    const result = await this.provider.verify({ playerId, ...input });
    this.cache.set(playerId, result);
    return result;
  }

  /** Seed/override a cached status (e.g. from a webhook callback). */
  put(result: KYCResult): void {
    this.cache.set(result.playerId, result);
  }

  /** The cached status, or an `Unverified` default (never null) for the sync path. */
  get(playerId: string): KYCResult {
    return (
      this.cache.get(playerId) ?? {
        playerId,
        status: VerificationStatus.Unverified,
        document: DocumentStatus.Missing,
        identity: IdentityStatus.Unknown,
        level: 0,
        provider: 'none',
        checkedAt: this.clock(),
      }
    );
  }

  isVerified(playerId: string): boolean {
    return this.get(playerId).status === VerificationStatus.Verified;
  }
}

/**
 * Deterministic mock KYC provider. Verdicts are driven by a seed map so tests are
 * repeatable; unknown players default to `Verified` at level 2 (a benign default —
 * policy still gates on the fields it needs).
 */
export class MockKYCProvider implements IKYCProvider {
  readonly name = 'mock-kyc';
  private readonly seed: Map<string, Partial<KYCResult>>;

  constructor(
    seed: Record<string, Partial<KYCResult>> = {},
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.seed = new Map(Object.entries(seed));
  }

  async verify(input: { playerId: string }): Promise<KYCResult> {
    const s = this.seed.get(input.playerId) ?? {};
    return {
      playerId: input.playerId,
      status: s.status ?? VerificationStatus.Verified,
      document: s.document ?? DocumentStatus.Approved,
      identity: s.identity ?? IdentityStatus.Matched,
      level: s.level ?? 2,
      provider: this.name,
      checkedAt: this.clock(),
    };
  }
}
