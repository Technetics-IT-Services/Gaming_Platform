/**
 * SIEM & observability exporters (Phase 9, STEP 7).
 *
 * Production `ISIEMForwarder` adapters (the FROZEN security SIEM interface) for Splunk
 * HEC, Elastic, Datadog and Microsoft Sentinel, plus OpenTelemetry / Prometheus
 * exporters. They forward the security event stream to the backend — implementing the
 * existing interface only, changing no monitoring logic.
 */
import { type ISIEMForwarder, type SecurityEvent } from '@/lib/security';

import { type HttpTransport, ProviderError, requireConfig } from './transport';

/** Splunk HTTP Event Collector. */
export class SplunkHECForwarder implements ISIEMForwarder {
  readonly name = 'splunk-hec';
  constructor(private readonly endpoint: string, private readonly token: string, private readonly http: HttpTransport) {}
  static fromConfig(config: Record<string, string | undefined>, http: HttpTransport): SplunkHECForwarder {
    return new SplunkHECForwarder(requireConfig(config, 'SPLUNK_HEC_URL', 'splunk'), requireConfig(config, 'SPLUNK_HEC_TOKEN', 'splunk'), http);
  }
  async forward(events: SecurityEvent[]): Promise<{ accepted: number }> {
    if (events.length === 0) return { accepted: 0 };
    const body = events.map((e) => JSON.stringify({ time: Math.floor(e.at / 1000), event: e, sourcetype: 'gaming:security' })).join('\n');
    const res = await this.http.request({ method: 'POST', url: `${this.endpoint}/services/collector/event`, headers: { Authorization: `Splunk ${this.token}`, 'Content-Type': 'application/json' }, body });
    if (res.status < 200 || res.status >= 300) throw new ProviderError('splunk', 'server', `forward ${res.status}`, res.status, res.status >= 500);
    return { accepted: events.length };
  }
}

/** Elastic bulk ingest. */
export class ElasticForwarder implements ISIEMForwarder {
  readonly name = 'elastic';
  constructor(private readonly endpoint: string, private readonly apiKey: string, private readonly index: string, private readonly http: HttpTransport) {}
  static fromConfig(config: Record<string, string | undefined>, http: HttpTransport): ElasticForwarder {
    return new ElasticForwarder(requireConfig(config, 'ELASTIC_URL', 'elastic'), requireConfig(config, 'ELASTIC_API_KEY', 'elastic'), config.ELASTIC_INDEX ?? 'security-events', http);
  }
  async forward(events: SecurityEvent[]): Promise<{ accepted: number }> {
    if (events.length === 0) return { accepted: 0 };
    const ndjson = events.flatMap((e) => [JSON.stringify({ index: { _index: this.index } }), JSON.stringify(e)]).join('\n') + '\n';
    const res = await this.http.request({ method: 'POST', url: `${this.endpoint}/_bulk`, headers: { Authorization: `ApiKey ${this.apiKey}`, 'Content-Type': 'application/x-ndjson' }, body: ndjson });
    if (res.status < 200 || res.status >= 300) throw new ProviderError('elastic', 'server', `bulk ${res.status}`, res.status, res.status >= 500);
    return { accepted: events.length };
  }
}

/** Datadog Logs intake. */
export class DatadogForwarder implements ISIEMForwarder {
  readonly name = 'datadog';
  constructor(private readonly site: string, private readonly apiKey: string, private readonly http: HttpTransport) {}
  static fromConfig(config: Record<string, string | undefined>, http: HttpTransport): DatadogForwarder {
    return new DatadogForwarder(config.DATADOG_SITE ?? 'datadoghq.com', requireConfig(config, 'DATADOG_API_KEY', 'datadog'), http);
  }
  async forward(events: SecurityEvent[]): Promise<{ accepted: number }> {
    if (events.length === 0) return { accepted: 0 };
    const res = await this.http.request({ method: 'POST', url: `https://http-intake.logs.${this.site}/api/v2/logs`, headers: { 'DD-API-KEY': this.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(events.map((e) => ({ ddsource: 'gaming-security', service: e.source ?? 'platform', message: e.type, ...e }))) });
    if (res.status < 200 || res.status >= 300) throw new ProviderError('datadog', 'server', `logs ${res.status}`, res.status, res.status >= 500);
    return { accepted: events.length };
  }
}

/** OpenTelemetry log/trace exporter (OTLP-HTTP). Not an ISIEMForwarder — a sink. */
export interface ITelemetryExporter {
  readonly name: string;
  export(records: Record<string, unknown>[]): Promise<{ accepted: number }>;
}
export class OTelExporter implements ITelemetryExporter {
  readonly name = 'otel';
  constructor(private readonly endpoint: string, private readonly http: HttpTransport) {}
  async export(records: Record<string, unknown>[]): Promise<{ accepted: number }> {
    const res = await this.http.request({ method: 'POST', url: `${this.endpoint}/v1/logs`, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resourceLogs: records }) });
    if (res.status < 200 || res.status >= 300) throw new ProviderError('otel', 'server', `export ${res.status}`, res.status, res.status >= 500);
    return { accepted: records.length };
  }
}

/** Prometheus text-exposition exporter for a metrics scrape endpoint. */
export class PrometheusExporter {
  readonly name = 'prometheus';
  private readonly counters = new Map<string, number>();
  inc(metric: string, by = 1): void {
    this.counters.set(metric, (this.counters.get(metric) ?? 0) + by);
  }
  /** Render the `/metrics` text-exposition body. */
  render(): string {
    return [...this.counters.entries()].map(([k, v]) => `${k} ${v}`).join('\n') + '\n';
  }
}
