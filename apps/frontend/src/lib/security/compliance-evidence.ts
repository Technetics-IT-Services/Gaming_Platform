/**
 * Compliance evidence platform (Phase 8, STEP 7).
 *
 * A control registry with framework mappings (OWASP ASVS, PCI DSS, ISO 27001, SOC2),
 * an evidence registry, a policy registry and an export-ready evidence exporter. This
 * is audit/attestation tooling — it records what controls exist and their evidence,
 * and changes no business logic. (Distinct from the frozen risk Compliance Platform.)
 */

export enum ControlStatus {
  Implemented = 'implemented',
  Partial = 'partial',
  Planned = 'planned',
  NotApplicable = 'not_applicable',
}

export interface Control {
  id: string;
  title: string;
  description: string;
  status: ControlStatus;
  owner?: string;
  /** Cross-framework references, e.g. { asvs: ['2.1.1'], pci: ['8.3'], iso27001: ['A.9.4'], soc2: ['CC6.1'] }. */
  mappings: Partial<Record<'asvs' | 'pci' | 'iso27001' | 'soc2', string[]>>;
  /** Evidence ids substantiating this control. */
  evidence: string[];
}

export interface Evidence {
  id: string;
  controlId: string;
  kind: 'config' | 'log' | 'test' | 'scan' | 'document' | 'attestation';
  reference: string; // URI / artifact id — never the raw sensitive artifact
  collectedAt: number;
  collectedBy?: string;
}

export interface Policy {
  id: string;
  name: string;
  version: string;
  summary: string;
  effectiveFrom: number;
}

export interface Report {
  name: string;
  columns: string[];
  rows: (string | number)[][];
  generatedAt: number;
}

export class ComplianceEvidenceRegistry {
  private readonly controls = new Map<string, Control>();
  private readonly evidence = new Map<string, Evidence>();
  private readonly policies = new Map<string, Policy>();
  private seq = 0;
  constructor(private readonly clock: () => number = () => Date.now()) {}

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq.toString().padStart(4, '0')}`;
  }

  /* -------------------------------- controls ------------------------------ */

  registerControl(control: Omit<Control, 'evidence'> & { evidence?: string[] }): Control {
    const c: Control = { evidence: [], ...control };
    this.controls.set(c.id, c);
    return c;
  }
  setControlStatus(id: string, status: ControlStatus): Control {
    const c = this.controls.get(id);
    if (!c) throw new Error('no such control');
    c.status = status;
    return c;
  }
  controlsFor(framework: 'asvs' | 'pci' | 'iso27001' | 'soc2'): Control[] {
    return [...this.controls.values()].filter((c) => (c.mappings[framework]?.length ?? 0) > 0);
  }
  listControls(): Control[] {
    return [...this.controls.values()];
  }

  /* -------------------------------- evidence ------------------------------ */

  attachEvidence(input: Omit<Evidence, 'id' | 'collectedAt'>): Evidence {
    const control = this.controls.get(input.controlId);
    if (!control) throw new Error('no such control');
    const e: Evidence = { id: this.id('ev'), collectedAt: this.clock(), ...input };
    this.evidence.set(e.id, e);
    control.evidence.push(e.id);
    return e;
  }
  evidenceFor(controlId: string): Evidence[] {
    return [...this.evidence.values()].filter((e) => e.controlId === controlId);
  }

  /* -------------------------------- policies ------------------------------ */

  registerPolicy(policy: Policy): Policy {
    this.policies.set(policy.id, policy);
    return policy;
  }
  listPolicies(): Policy[] {
    return [...this.policies.values()];
  }

  /* --------------------------------- coverage ----------------------------- */

  /** Coverage summary: how many controls are implemented + have evidence. */
  coverage(): { total: number; implemented: number; withEvidence: number; percentImplemented: number } {
    const all = this.listControls();
    const implemented = all.filter((c) => c.status === ControlStatus.Implemented).length;
    const withEvidence = all.filter((c) => c.evidence.length > 0).length;
    return { total: all.length, implemented, withEvidence, percentImplemented: all.length ? Math.round((implemented / all.length) * 100) : 0 };
  }

  /** Export an auditor-ready evidence matrix (control → status → frameworks → evidence). */
  export(): Report {
    const rows = this.listControls().map((c) => [
      c.id,
      c.title,
      c.status,
      Object.entries(c.mappings).map(([f, ids]) => `${f}:${(ids ?? []).join('/')}`).join(' '),
      c.evidence.length,
    ] as (string | number)[]);
    return { name: 'compliance-evidence-matrix', columns: ['control', 'title', 'status', 'frameworks', 'evidenceCount'], rows, generatedAt: this.clock() };
  }
}

/** A representative production control set with framework mappings (seed/tune per audit). */
export function defaultControls(): (Omit<Control, 'evidence'> & { evidence?: string[] })[] {
  return [
    { id: 'AC-1', title: 'RBAC enforcement', description: 'Least-privilege RBAC across admin/partner/analytics surfaces', status: ControlStatus.Implemented, mappings: { asvs: ['1.4.1', '4.1.3'], pci: ['7.1'], iso27001: ['A.9.4'], soc2: ['CC6.1'] } },
    { id: 'IA-2', title: 'Multi-factor authentication', description: 'TOTP/WebAuthn MFA for privileged access', status: ControlStatus.Implemented, mappings: { asvs: ['2.2.1'], pci: ['8.4'], iso27001: ['A.9.4'], soc2: ['CC6.1'] } },
    { id: 'SC-8', title: 'Transport encryption', description: 'TLS + HSTS everywhere', status: ControlStatus.Implemented, mappings: { asvs: ['9.1.1'], pci: ['4.1'], iso27001: ['A.13.1'], soc2: ['CC6.7'] } },
    { id: 'SC-28', title: 'Secret management + rotation', description: 'KMS/Vault-backed secrets with versioning + rotation + audit', status: ControlStatus.Implemented, mappings: { asvs: ['6.4.1'], pci: ['3.6'], iso27001: ['A.10.1'], soc2: ['CC6.1'] } },
    { id: 'AU-2', title: 'Security audit logging', description: 'Append-only security event stream + SIEM forwarding', status: ControlStatus.Implemented, mappings: { asvs: ['7.1.1'], pci: ['10.2'], iso27001: ['A.12.4'], soc2: ['CC7.2'] } },
    { id: 'SI-10', title: 'Input validation + output encoding', description: 'Validation framework + context-aware encoders (anti-injection/XSS)', status: ControlStatus.Implemented, mappings: { asvs: ['5.1.1', '5.3.1'], pci: ['6.5'], iso27001: ['A.14.2'], soc2: ['CC7.1'] } },
    { id: 'IR-4', title: 'Incident response', description: 'Documented IR model, severities, escalation, forensic checklist', status: ControlStatus.Implemented, mappings: { asvs: ['1.11.1'], pci: ['12.10'], iso27001: ['A.16.1'], soc2: ['CC7.3'] } },
    { id: 'CM-7', title: 'Least-functionality containers', description: 'Non-root, read-only rootfs, dropped caps, admission policy', status: ControlStatus.Implemented, mappings: { asvs: ['14.1.1'], pci: ['2.2'], iso27001: ['A.12.6'], soc2: ['CC6.8'] } },
  ];
}
