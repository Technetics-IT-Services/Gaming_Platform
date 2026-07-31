/**
 * Fraud & compliance analytics (Phase 6D, STEP 5).
 *
 * Read-only aggregation over the compliance decision stream: risk distribution,
 * fraud/decision trends, AML/KYC metrics, compliance workload and audit analytics.
 * Consumes the `ComplianceAnalyticsPort` — the Compliance platform is not modified.
 */
import { bucketOf } from './metrics';
import { type ComplianceAnalyticsPort } from './ports';
import { type FraudComplianceAnalytics, Granularity } from './types';

export class FraudComplianceAnalyticsService {
  constructor(
    private readonly compliance: ComplianceAnalyticsPort,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  analytics(): FraudComplianceAnalytics {
    const decisions = this.compliance.decisions();
    const byAction: Record<string, number> = {};
    const riskDistribution = { low: 0, medium: 0, high: 0, critical: 0 };
    const reasonCounts = new Map<string, number>();

    for (const d of decisions) {
      byAction[d.action] = (byAction[d.action] ?? 0) + 1;
      if (d.riskScore >= 80) riskDistribution.critical += 1;
      else if (d.riskScore >= 50) riskDistribution.high += 1;
      else if (d.riskScore >= 25) riskDistribution.medium += 1;
      else riskDistribution.low += 1;
      for (const r of d.reasons) reasonCounts.set(r.code, (reasonCounts.get(r.code) ?? 0) + 1);
    }

    const topReasons = [...reasonCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalDecisions: decisions.length,
      byAction,
      riskDistribution,
      topReasons,
      manualReviewQueue: byAction['manual_review'] ?? 0,
      generatedAt: this.clock(),
    };
  }

  /** Decision volume trend over time (bucketed). */
  decisionTrend(grain: Granularity = Granularity.Day): { at: number; count: number }[] {
    const buckets = new Map<number, number>();
    for (const d of this.compliance.decisions()) {
      const b = bucketOf(d.at, grain);
      buckets.set(b, (buckets.get(b) ?? 0) + 1);
    }
    return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([at, count]) => ({ at, count }));
  }

  /** AML/KYC-style reason counts (which controls fire most). */
  controlMetrics(): { amlHits: number; kycBlocks: number; velocityHits: number; deviceBlocks: number } {
    let amlHits = 0;
    let kycBlocks = 0;
    let velocityHits = 0;
    let deviceBlocks = 0;
    for (const d of this.compliance.decisions()) {
      for (const r of d.reasons) {
        if (r.code.startsWith('AML')) amlHits += 1;
        else if (r.code.startsWith('KYC')) kycBlocks += 1;
        else if (r.code.startsWith('VELOCITY')) velocityHits += 1;
        else if (r.code.startsWith('DEVICE')) deviceBlocks += 1;
      }
    }
    return { amlHits, kycBlocks, velocityHits, deviceBlocks };
  }
}
