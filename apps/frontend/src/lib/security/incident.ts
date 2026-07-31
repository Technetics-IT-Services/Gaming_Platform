/**
 * Incident response platform (Phase 8, STEP 8).
 *
 * An incident model with severity classification, a validated status lifecycle, an
 * escalation matrix, a forensic-evidence checklist and a timeline. It coordinates
 * response — it touches no business or financial state.
 */

export enum IncidentSeverity {
  SEV1 = 'sev1', // money movement impaired / breach / full outage
  SEV2 = 'sev2', // degraded / partial
  SEV3 = 'sev3', // minor / single-tenant
  SEV4 = 'sev4', // informational
}
export enum IncidentStatus {
  Detected = 'detected',
  Triaged = 'triaged',
  Contained = 'contained',
  Eradicated = 'eradicated',
  Recovered = 'recovered',
  Closed = 'closed',
}

const INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  [IncidentStatus.Detected]: [IncidentStatus.Triaged, IncidentStatus.Closed],
  [IncidentStatus.Triaged]: [IncidentStatus.Contained, IncidentStatus.Closed],
  [IncidentStatus.Contained]: [IncidentStatus.Eradicated],
  [IncidentStatus.Eradicated]: [IncidentStatus.Recovered],
  [IncidentStatus.Recovered]: [IncidentStatus.Closed],
  [IncidentStatus.Closed]: [],
};

export interface IncidentEvent {
  at: number;
  actor: string;
  action: string;
  detail?: string;
}
export interface Incident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  category: string;
  detectedAt: number;
  updatedAt: number;
  commander?: string;
  timeline: IncidentEvent[];
  /** Forensic-evidence checklist state. */
  forensics: Record<string, boolean>;
}

/** Escalation matrix — who to page per severity (roles, not people). */
export const ESCALATION_MATRIX: Record<IncidentSeverity, string[]> = {
  [IncidentSeverity.SEV1]: ['on-call-eng', 'security-lead', 'eng-director', 'finance-lead', 'legal', 'comms'],
  [IncidentSeverity.SEV2]: ['on-call-eng', 'security-lead'],
  [IncidentSeverity.SEV3]: ['on-call-eng'],
  [IncidentSeverity.SEV4]: ['ticket-queue'],
};

/** Forensic-evidence checklist required before closing a SEV1/SEV2. */
export const FORENSIC_CHECKLIST = [
  'preserve_logs',
  'snapshot_affected_hosts',
  'capture_memory_if_applicable',
  'export_security_audit_stream',
  'record_iocs',
  'chain_of_custody_documented',
] as const;

function secureId(): string {
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  return `inc_${Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export class IncidentManager {
  private readonly incidents = new Map<string, Incident>();
  constructor(private readonly clock: () => number = () => Date.now()) {}

  declare(input: { title: string; severity: IncidentSeverity; category: string; commander?: string }): Incident {
    const now = this.clock();
    const incident: Incident = {
      id: secureId(),
      title: input.title,
      severity: input.severity,
      status: IncidentStatus.Detected,
      category: input.category,
      detectedAt: now,
      updatedAt: now,
      commander: input.commander,
      timeline: [{ at: now, actor: input.commander ?? 'system', action: 'declared', detail: input.severity }],
      forensics: Object.fromEntries(FORENSIC_CHECKLIST.map((k) => [k, false])),
    };
    this.incidents.set(incident.id, incident);
    return incident;
  }

  get(id: string): Incident {
    const i = this.incidents.get(id);
    if (!i) throw new Error('no such incident');
    return i;
  }

  /** Who to escalate to for an incident. */
  escalation(id: string): string[] {
    return ESCALATION_MATRIX[this.get(id).severity];
  }

  advance(id: string, to: IncidentStatus, actor: string, detail?: string): Incident {
    const inc = this.get(id);
    if (!INCIDENT_TRANSITIONS[inc.status].includes(to)) throw new Error(`illegal incident transition ${inc.status} → ${to}`);
    // SEV1/SEV2 cannot close without a complete forensic checklist.
    if (to === IncidentStatus.Closed && (inc.severity === IncidentSeverity.SEV1 || inc.severity === IncidentSeverity.SEV2)) {
      const incomplete = FORENSIC_CHECKLIST.filter((k) => !inc.forensics[k]);
      if (incomplete.length) throw new Error(`forensic checklist incomplete: ${incomplete.join(', ')}`);
    }
    inc.status = to;
    inc.updatedAt = this.clock();
    inc.timeline.push({ at: inc.updatedAt, actor, action: `status:${to}`, detail });
    return inc;
  }

  note(id: string, actor: string, detail: string): void {
    const inc = this.get(id);
    inc.timeline.push({ at: this.clock(), actor, action: 'note', detail });
    inc.updatedAt = this.clock();
  }

  completeForensicItem(id: string, item: (typeof FORENSIC_CHECKLIST)[number], actor: string): void {
    const inc = this.get(id);
    inc.forensics[item] = true;
    inc.timeline.push({ at: this.clock(), actor, action: 'forensic', detail: item });
  }

  open(): Incident[] {
    return [...this.incidents.values()].filter((i) => i.status !== IncidentStatus.Closed);
  }
}
