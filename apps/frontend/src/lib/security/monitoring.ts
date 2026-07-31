/**
 * Security monitoring (Phase 8, STEP 6).
 *
 * A security event model, an append-only security audit stream, threat indicators,
 * anomaly contracts, a SIEM forwarder interface and SOC export APIs. Read-only
 * observation that wraps the platform — it emits and forwards events, never mutating
 * business state.
 */

export enum SecurityEventType {
  AuthSuccess = 'auth.success',
  AuthFailure = 'auth.failure',
  MfaChallenge = 'auth.mfa_challenge',
  AccountLocked = 'auth.account_locked',
  SessionRevoked = 'auth.session_revoked',
  TokenReuse = 'auth.token_reuse',
  AccessDenied = 'authz.access_denied',
  CsrfRejected = 'app.csrf_rejected',
  RateLimited = 'app.rate_limited',
  SsrfBlocked = 'app.ssrf_blocked',
  SecretAccess = 'secret.access',
  SecretRotated = 'secret.rotated',
  AnomalyDetected = 'anomaly.detected',
  PolicyViolation = 'policy.violation',
}

export enum SecuritySeverity {
  Info = 'info',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Critical = 'critical',
}

export interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  severity: SecuritySeverity;
  at: number;
  actor?: string;
  source?: string;
  ip?: string;
  correlationId?: string;
  /** Non-sensitive detail only — never raw secrets/PII. */
  detail?: string;
  attributes?: Record<string, string>;
}

/** A forwardable threat indicator (IOC) — feeds allow/deny + SIEM correlation. */
export interface ThreatIndicator {
  kind: 'ip' | 'device' | 'account' | 'asn' | 'hash';
  value: string;
  confidence: number; // 0–100
  reason: string;
  addedAt: number;
}

export interface AnomalyEvent {
  subject: string;
  metric: string;
  observed: number;
  baseline: number;
  zScore: number;
  at: number;
}

/** Pluggable SIEM forwarder (Splunk/Elastic/Sentinel/Chronicle). */
export interface ISIEMForwarder {
  readonly name: string;
  forward(events: SecurityEvent[]): Promise<{ accepted: number }>;
}

function secureId(): string {
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return `sev_${Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export class SecurityMonitor {
  private readonly events: SecurityEvent[] = [];
  private readonly indicators = new Map<string, ThreatIndicator>();
  constructor(private readonly clock: () => number = () => Date.now(), private readonly siem?: ISIEMForwarder) {}

  /** Record a security event (append-only stream). Auto-forwards High/Critical. */
  record(input: Omit<SecurityEvent, 'id' | 'at'> & { at?: number }): SecurityEvent {
    const event: SecurityEvent = { id: secureId(), at: input.at ?? this.clock(), ...input };
    this.events.push(event);
    if (this.siem && (event.severity === SecuritySeverity.High || event.severity === SecuritySeverity.Critical)) {
      void this.siem.forward([event]);
    }
    return event;
  }

  query(filter: { type?: SecurityEventType; severity?: SecuritySeverity; actor?: string; from?: number; to?: number; limit?: number } = {}): SecurityEvent[] {
    let out = this.events.filter((e) => {
      if (filter.type && e.type !== filter.type) return false;
      if (filter.severity && e.severity !== filter.severity) return false;
      if (filter.actor && e.actor !== filter.actor) return false;
      if (filter.from !== undefined && e.at < filter.from) return false;
      if (filter.to !== undefined && e.at > filter.to) return false;
      return true;
    });
    out = out.sort((a, b) => b.at - a.at);
    return filter.limit ? out.slice(0, filter.limit) : out;
  }

  /** Threat-indicator registry. */
  addIndicator(indicator: Omit<ThreatIndicator, 'addedAt'>): void {
    this.indicators.set(`${indicator.kind}:${indicator.value}`, { ...indicator, addedAt: this.clock() });
  }
  isIndicated(kind: ThreatIndicator['kind'], value: string): ThreatIndicator | undefined {
    return this.indicators.get(`${kind}:${value}`);
  }

  /** SOC export: events + severity rollup (read-only, SIEM-ready). */
  socExport(filter: Parameters<SecurityMonitor['query']>[0] = {}): { events: SecurityEvent[]; bySeverity: Record<string, number>; generatedAt: number } {
    const events = this.query({ ...filter, limit: filter.limit ?? 100_000 });
    const bySeverity: Record<string, number> = {};
    for (const e of events) bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
    return { events, bySeverity, generatedAt: this.clock() };
  }

  /** Forward a batch to the SIEM on demand. */
  async flushToSiem(): Promise<number> {
    if (!this.siem) return 0;
    const { accepted } = await this.siem.forward(this.events);
    return accepted;
  }
}
