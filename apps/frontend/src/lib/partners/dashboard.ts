/**
 * Partner dashboard (Phase 6C, STEP 8).
 *
 * Read-only per-partner overview: profile, acquisition funnel, revenue/LTV/retention,
 * commission summary, sub-partner count and a system-status marker. Pure aggregation
 * over the partner services + read-only financial port. No money movement.
 */
import { type AgentHierarchy } from './hierarchy';
import { type PartnerService } from './partner-service';
import { type PartnerReporting } from './reporting';
import { type PartnerDashboardView } from './types';

export interface PartnerDashboardDeps {
  partners: PartnerService;
  hierarchy: AgentHierarchy;
  reporting: PartnerReporting;
  clock?: () => number;
}

export class PartnerDashboard {
  private readonly clock: () => number;
  constructor(private readonly deps: PartnerDashboardDeps) {
    this.clock = deps.clock ?? (() => Date.now());
  }

  overview(partnerId: string): PartnerDashboardView {
    const partner = this.deps.partners.get(partnerId);
    return {
      partner: { id: partner.id, name: partner.name, status: partner.status, type: partner.type },
      acquisition: this.deps.reporting.acquisition(partnerId),
      revenue: this.deps.reporting.revenue(partnerId),
      commission: this.deps.reporting.commission(partnerId),
      subPartners: this.deps.hierarchy.descendants(partnerId).length,
      generatedAt: this.clock(),
    };
  }
}
