/**
 * AML framework (Phase 5D, STEP 4).
 *
 * `AMLService` fronts any `IAMLProvider` adapter and caches the latest screening per
 * player for the synchronous decision path. Screening covers sanctions, PEP and
 * watchlist checks plus derived risk flags. Only a deterministic mock ships here.
 */
import {
  type AMLResult,
  type IAMLProvider,
  RiskFlag,
  RiskLevel,
} from './types';

/** Countries treated as high-risk jurisdictions by the mock (configurable). */
const DEFAULT_HIGH_RISK = new Set(['IR', 'KP', 'SY', 'AF', 'MM']);

export class AMLService {
  private readonly cache = new Map<string, AMLResult>();

  constructor(
    private readonly provider: IAMLProvider,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async refresh(playerId: string, input?: { country?: string; amount?: number }): Promise<AMLResult> {
    const result = await this.provider.screen({ playerId, ...input });
    this.cache.set(playerId, result);
    return result;
  }

  put(result: AMLResult): void {
    this.cache.set(result.playerId, result);
  }

  /** The cached screening, or a clean default (never null) for the sync path. */
  get(playerId: string): AMLResult {
    return (
      this.cache.get(playerId) ?? {
        playerId,
        sanctions: { hit: false, lists: [] },
        pep: { hit: false },
        watchlist: { hit: false, sources: [] },
        flags: [],
        riskLevel: RiskLevel.Low,
        provider: 'none',
        checkedAt: this.clock(),
      }
    );
  }
}

/**
 * Deterministic mock AML provider. Seed maps declare which players hit which lists;
 * high-risk jurisdictions add a flag. Clean players score `Low`.
 */
export class MockAMLProvider implements IAMLProvider {
  readonly name = 'mock-aml';
  private readonly sanctioned: Set<string>;
  private readonly pep: Set<string>;
  private readonly watchlisted: Set<string>;
  private readonly highRisk: Set<string>;

  constructor(
    seed?: { sanctioned?: string[]; pep?: string[]; watchlisted?: string[]; highRiskCountries?: string[] },
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.sanctioned = new Set(seed?.sanctioned ?? []);
    this.pep = new Set(seed?.pep ?? []);
    this.watchlisted = new Set(seed?.watchlisted ?? []);
    this.highRisk = new Set((seed?.highRiskCountries ?? [...DEFAULT_HIGH_RISK]).map((c) => c.toUpperCase()));
  }

  async screen(input: { playerId: string; country?: string; amount?: number }): Promise<AMLResult> {
    const flags: RiskFlag[] = [];
    const sanctions = { hit: this.sanctioned.has(input.playerId), lists: this.sanctioned.has(input.playerId) ? ['OFAC-SDN'] : [] };
    const pep = { hit: this.pep.has(input.playerId), category: this.pep.has(input.playerId) ? 'domestic' : undefined };
    const watchlist = { hit: this.watchlisted.has(input.playerId), sources: this.watchlisted.has(input.playerId) ? ['INTERNAL'] : [] };
    const country = input.country?.toUpperCase();

    if (sanctions.hit) flags.push(RiskFlag.Sanctions);
    if (pep.hit) flags.push(RiskFlag.PEP);
    if (watchlist.hit) flags.push(RiskFlag.Watchlist);
    if (country && this.highRisk.has(country)) flags.push(RiskFlag.HighRiskJurisdiction);

    let riskLevel = RiskLevel.Low;
    if (flags.includes(RiskFlag.Sanctions)) riskLevel = RiskLevel.Critical;
    else if (flags.includes(RiskFlag.Watchlist)) riskLevel = RiskLevel.High;
    else if (flags.length > 0) riskLevel = RiskLevel.Medium;

    return { playerId: input.playerId, sanctions, pep, watchlist, flags, riskLevel, provider: this.name, checkedAt: this.clock() };
  }
}
