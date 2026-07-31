/**
 * Partner service (Phase 6C, STEP 1).
 *
 * Owns partner profiles, status, lifecycle, notes and settings. Pure relationship
 * data — it owns no money and no gameplay. Status/lifecycle transitions are validated
 * and every write is timestamped; the facade layers RBAC + audit on top.
 */
import { maskContact, secureId } from './util';
import {
  type PartnerNote,
  type PartnerProfile,
  type PartnerSettings,
  PartnerLifecycle,
  PartnerStatus,
  type PartnerType,
} from './types';

const STATUS_TRANSITIONS: Record<PartnerStatus, PartnerStatus[]> = {
  [PartnerStatus.Pending]: [PartnerStatus.Active, PartnerStatus.Terminated],
  [PartnerStatus.Active]: [PartnerStatus.Suspended, PartnerStatus.Terminated],
  [PartnerStatus.Suspended]: [PartnerStatus.Active, PartnerStatus.Terminated],
  [PartnerStatus.Terminated]: [],
};

export class PartnerService {
  private readonly partners = new Map<string, PartnerProfile>();
  private readonly notes = new Map<string, PartnerNote[]>();

  constructor(private readonly clock: () => number = () => Date.now()) {}

  create(input: { tenantId: string; type: PartnerType; name: string; email?: string; parentId?: string; settings?: Partial<PartnerSettings> }): PartnerProfile {
    const now = this.clock();
    const partner: PartnerProfile = {
      id: secureId('ptr'),
      tenantId: input.tenantId,
      type: input.type,
      name: input.name,
      emailMasked: input.email ? maskContact(input.email) : undefined,
      status: PartnerStatus.Pending,
      lifecycle: PartnerLifecycle.Prospect,
      parentId: input.parentId,
      settings: { payoutCurrency: input.settings?.payoutCurrency ?? 'USD', defaultPlanId: input.settings?.defaultPlanId, minPayout: input.settings?.minPayout, metadata: input.settings?.metadata },
      createdAt: now,
      updatedAt: now,
    };
    this.partners.set(partner.id, partner);
    return partner;
  }

  get(partnerId: string): PartnerProfile {
    const p = this.partners.get(partnerId);
    if (!p) throw new Error('no such partner');
    return p;
  }
  find(partnerId: string): PartnerProfile | undefined {
    return this.partners.get(partnerId);
  }
  all(): PartnerProfile[] {
    return [...this.partners.values()];
  }
  byTenant(tenantId: string): PartnerProfile[] {
    return this.all().filter((p) => p.tenantId === tenantId);
  }

  setStatus(partnerId: string, status: PartnerStatus): PartnerProfile {
    const p = this.get(partnerId);
    if (p.status !== status && !STATUS_TRANSITIONS[p.status].includes(status)) throw new Error(`illegal partner status ${p.status} → ${status}`);
    p.status = status;
    p.updatedAt = this.clock();
    return p;
  }
  setLifecycle(partnerId: string, lifecycle: PartnerLifecycle): PartnerProfile {
    const p = this.get(partnerId);
    p.lifecycle = lifecycle;
    p.updatedAt = this.clock();
    return p;
  }
  updateSettings(partnerId: string, settings: Partial<PartnerSettings>): PartnerProfile {
    const p = this.get(partnerId);
    p.settings = { ...p.settings, ...settings };
    p.updatedAt = this.clock();
    return p;
  }

  addNote(partnerId: string, body: string, author: string): PartnerNote {
    this.get(partnerId);
    const note: PartnerNote = { id: secureId('pnote'), partnerId, body, author, at: this.clock() };
    this.notes.set(partnerId, [...(this.notes.get(partnerId) ?? []), note]);
    return note;
  }
  listNotes(partnerId: string): PartnerNote[] {
    return [...(this.notes.get(partnerId) ?? [])].sort((a, b) => b.at - a.at);
  }
}
