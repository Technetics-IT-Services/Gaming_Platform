/**
 * Commission engine (Phase 6C, STEP 4).
 *
 * Computes partner commissions across CPA / Revenue-Share / Hybrid / Fixed /
 * Percentage / Tiered models, records entries with a status lifecycle, supports
 * manual adjustments, and keeps a per-partner logical balance + history. **Logical
 * accounting ONLY — no ledger postings, no money movement.** Actual payout of an
 * approved balance is a Treasury/Operations concern and is out of scope here.
 */
import { secureId } from './util';
import {
  type CommissionContext,
  type CommissionEntry,
  CommissionModel,
  type CommissionPlan,
  CommissionStatus,
} from './types';

const COMMISSION_TRANSITIONS: Record<CommissionStatus, CommissionStatus[]> = {
  [CommissionStatus.Pending]: [CommissionStatus.Approved, CommissionStatus.Rejected, CommissionStatus.Adjusted],
  [CommissionStatus.Approved]: [CommissionStatus.Paid, CommissionStatus.Adjusted],
  [CommissionStatus.Adjusted]: [CommissionStatus.Approved, CommissionStatus.Rejected],
  [CommissionStatus.Paid]: [],
  [CommissionStatus.Rejected]: [],
};

export class CommissionEngine {
  private readonly plans = new Map<string, CommissionPlan>();
  private readonly entries = new Map<string, CommissionEntry>();
  private readonly byPartner = new Map<string, string[]>();

  constructor(private readonly clock: () => number = () => Date.now()) {}

  /* --------------------------------- plans -------------------------------- */

  createPlan(plan: CommissionPlan): CommissionPlan {
    this.plans.set(plan.id, plan);
    return plan;
  }
  plan(planId: string): CommissionPlan {
    const p = this.plans.get(planId);
    if (!p) throw new Error('no such plan');
    return p;
  }

  /** Pure calculation of a commission amount for a plan + context (logical units). */
  static compute(plan: CommissionPlan, ctx: CommissionContext): number {
    const bpsOf = (base: number, bps: number) => Math.floor((base * bps) / 10_000);
    switch (plan.model) {
      case CommissionModel.CPA:
        return (plan.cpaAmount ?? 0) * (ctx.conversions ?? 0);
      case CommissionModel.RevShare:
      case CommissionModel.Percentage:
        return bpsOf(ctx.ngr ?? 0, plan.bps ?? 0);
      case CommissionModel.Hybrid:
        return (plan.cpaAmount ?? 0) * (ctx.conversions ?? 0) + bpsOf(ctx.ngr ?? 0, plan.bps ?? 0);
      case CommissionModel.Fixed:
        return plan.fixedAmount ?? 0;
      case CommissionModel.Tiered: {
        const base = ctx.volume ?? ctx.ngr ?? 0;
        const tiers = [...(plan.tiers ?? [])].sort((a, b) => a.threshold - b.threshold);
        let bps = 0;
        for (const t of tiers) if (base >= t.threshold) bps = t.bps;
        return bpsOf(base, bps);
      }
      default:
        return 0;
    }
  }

  /* -------------------------------- entries ------------------------------- */

  private push(entry: CommissionEntry): CommissionEntry {
    this.entries.set(entry.id, entry);
    this.byPartner.set(entry.partnerId, [...(this.byPartner.get(entry.partnerId) ?? []), entry.id]);
    return entry;
  }

  /** Accrue a commission entry from a plan + context (status Pending). */
  accrue(partnerId: string, planId: string, ctx: CommissionContext): CommissionEntry {
    const plan = this.plan(planId);
    const amount = CommissionEngine.compute(plan, ctx);
    return this.push({
      id: secureId('com'),
      partnerId,
      planId,
      model: plan.model,
      amount,
      base: ctx.ngr ?? ctx.volume,
      status: CommissionStatus.Pending,
      at: this.clock(),
      period: ctx.period,
    });
  }

  private transition(entry: CommissionEntry, to: CommissionStatus): void {
    if (!COMMISSION_TRANSITIONS[entry.status].includes(to)) throw new Error(`illegal commission transition ${entry.status} → ${to}`);
    entry.status = to;
  }
  private get(entryId: string): CommissionEntry {
    const e = this.entries.get(entryId);
    if (!e) throw new Error('no such commission entry');
    return e;
  }

  approve(entryId: string, actor: string): CommissionEntry {
    const e = this.get(entryId);
    this.transition(e, CommissionStatus.Approved);
    e.actor = actor;
    return e;
  }
  reject(entryId: string, actor: string, reason: string): CommissionEntry {
    const e = this.get(entryId);
    this.transition(e, CommissionStatus.Rejected);
    e.actor = actor;
    e.reason = reason;
    return e;
  }
  markPaid(entryId: string, actor: string): CommissionEntry {
    const e = this.get(entryId);
    this.transition(e, CommissionStatus.Paid);
    e.actor = actor;
    return e;
  }

  /** Manual logical adjustment (positive or negative) — a new audited entry. */
  adjust(partnerId: string, amount: number, actor: string, reason: string): CommissionEntry {
    return this.push({ id: secureId('com'), partnerId, model: CommissionModel.Fixed, amount, status: CommissionStatus.Adjusted, actor, reason, at: this.clock() });
  }

  history(partnerId: string): CommissionEntry[] {
    return (this.byPartner.get(partnerId) ?? []).map((id) => this.entries.get(id)!).sort((a, b) => b.at - a.at);
  }

  /** Logical balances for a partner (never a money balance). */
  summary(partnerId: string): { pending: number; approved: number; paid: number; total: number; balance: number } {
    let pending = 0;
    let approved = 0;
    let paid = 0;
    let total = 0;
    for (const e of this.history(partnerId)) {
      if (e.status === CommissionStatus.Rejected) continue;
      total += e.amount;
      if (e.status === CommissionStatus.Pending) pending += e.amount;
      else if (e.status === CommissionStatus.Approved || e.status === CommissionStatus.Adjusted) approved += e.amount;
      else if (e.status === CommissionStatus.Paid) paid += e.amount;
    }
    // Outstanding logical balance = accrued (non-rejected) minus already paid.
    return { pending, approved, paid, total, balance: total - paid };
  }
}
