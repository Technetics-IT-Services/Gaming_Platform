/**
 * Monitoring & alerting (Phase 6D, STEP 7).
 *
 * A health dashboard over the read-only health port, service/error/latency/queue/
 * cache/resource metrics, and a configurable alert-rule engine with channels. Rules
 * evaluate metric values and fire alerts; delivery is via registered channels. No
 * business logic, no money movement.
 */
import { type MetricsRegistry } from './metrics';
import { type Observability } from './observability';
import { type HealthPort } from './ports';
import {
  type Alert,
  type AlertChannel,
  AlertComparator,
  type AlertRule,
  type AlertSeverity,
} from './types';

function secureId(prefix: string): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export interface SystemHealthDashboard {
  overall: string;
  components: { name: string; status: string; detail?: string }[];
  errorRate: number;
  latencyP95: number;
  queueDepth: number;
  cacheHitRate: number;
  generatedAt: number;
}

export class MonitoringService {
  private readonly rules = new Map<string, AlertRule>();
  private readonly channels = new Map<string, AlertChannel>();
  private readonly fired: Alert[] = [];
  /** Simple gauge store for queue depth / cache / resource utilization hooks. */
  private readonly gauges = new Map<string, number>();

  constructor(
    private readonly health: HealthPort,
    private readonly observability: Observability,
    private readonly metrics: MetricsRegistry,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  /* ----------------------------- infra gauges ----------------------------- */

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }
  gauge(name: string): number {
    return this.gauges.get(name) ?? 0;
  }

  /* ------------------------------ dashboard ------------------------------- */

  dashboard(): SystemHealthDashboard {
    const h = this.health.status();
    return {
      overall: h.overall,
      components: h.components,
      errorRate: this.observability.errorRate(),
      latencyP95: this.observability.latency().p95,
      queueDepth: this.gauge('queue.depth'),
      cacheHitRate: this.gauge('cache.hit_rate'),
      generatedAt: this.clock(),
    };
  }

  /* -------------------------------- alerting ------------------------------ */

  addChannel(channel: Omit<AlertChannel, 'id'>): AlertChannel {
    const c: AlertChannel = { id: secureId('chan'), ...channel };
    this.channels.set(c.id, c);
    return c;
  }
  addRule(rule: Omit<AlertRule, 'id'>): AlertRule {
    const r: AlertRule = { id: secureId('rule'), ...rule };
    this.rules.set(r.id, r);
    return r;
  }
  listRules(): AlertRule[] {
    return [...this.rules.values()];
  }

  /** Resolve a metric value for a rule (counters, gauges, or infra gauges). */
  private valueOf(metric: string): number {
    if (metric === 'error_rate') return this.observability.errorRate();
    if (metric === 'latency_p95') return this.observability.latency().p95;
    const gauge = this.gauges.get(metric);
    if (gauge !== undefined) return gauge;
    return this.metrics.counter(metric);
  }

  /** Evaluate every enabled rule; fire alerts for breaches. Returns new alerts. */
  evaluate(): Alert[] {
    const now = this.clock();
    const newAlerts: Alert[] = [];
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      const value = this.valueOf(rule.metric);
      const breached = rule.comparator === AlertComparator.GreaterThan ? value > rule.threshold : value < rule.threshold;
      if (!breached) continue;
      const alert: Alert = {
        id: secureId('alert'),
        ruleId: rule.id,
        metric: rule.metric,
        value,
        threshold: rule.threshold,
        severity: rule.severity,
        firedAt: now,
        message: `${rule.description} — ${rule.metric}=${value} ${rule.comparator} ${rule.threshold}`,
      };
      this.fired.push(alert);
      newAlerts.push(alert);
    }
    return newAlerts;
  }

  /** Channels a fired alert would be delivered to (delivery is a downstream hook). */
  channelsFor(alert: Alert): AlertChannel[] {
    const rule = this.rules.get(alert.ruleId);
    if (!rule) return [];
    return rule.channels.map((id) => this.channels.get(id)).filter((c): c is AlertChannel => c !== undefined);
  }

  firedAlerts(severity?: AlertSeverity): Alert[] {
    return this.fired.filter((a) => !severity || a.severity === severity);
  }
}
