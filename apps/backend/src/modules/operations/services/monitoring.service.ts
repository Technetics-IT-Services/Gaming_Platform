import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { cpus } from 'node:os';

import { MetricsService } from './metrics.service';
import { QueueService } from './queue.service';
import { AlertService } from './alert.service';
import { OperationsHealthService } from './operations-health.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { OperationsGateway } from '../operations.gateway';

export interface SystemMetrics {
  uptimeSeconds: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  cpuPercent: number;
  eventLoopLagMs: number;
  pid: number;
}

const SAMPLE_INTERVAL_MS = 5000;

/**
 * The monitoring orchestrator. On a fixed interval it samples system metrics
 * (memory, CPU, event-loop lag), refreshes health, evaluates alerts against the
 * live values and pushes an overview to the operations dashboard. Other modules
 * feed domain counters into {@link MetricsService}; this service reads them.
 */
@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringService.name);
  private sampleFailures = 0;
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private lagTimer: ReturnType<typeof setInterval> | null = null;
  private lastCpu = process.cpuUsage();
  private lastCpuAt = Date.now();
  private eventLoopLagMs = 0;

  constructor(
    private readonly metrics: MetricsService,
    private readonly queue: QueueService,
    private readonly alerts: AlertService,
    private readonly health: OperationsHealthService,
    private readonly breakers: CircuitBreakerService,
    private readonly gateway: OperationsGateway,
  ) {}

  onModuleInit(): void {
    let expected = Date.now() + 1000;
    this.lagTimer = setInterval(() => {
      const now = Date.now();
      this.eventLoopLagMs = Math.max(0, now - expected);
      expected = now + 1000;
    }, 1000);
    // Phase 2D.11: the rejection MUST be caught here.
    //
    // This previously read `void this.sample()`, which discards the promise — so a transient
    // database or Redis error inside a sampling cycle became an unhandled rejection, and under
    // Node 18+ an unhandled rejection terminates the process. A monitoring sampler taking the
    // whole API down during a momentary database blip is precisely backwards: observability must
    // never be able to kill the thing it observes.
    //
    // Observed once during a full serial test run (`AlertService.rules` → Prisma, mid-teardown).
    this.sampleTimer = setInterval(() => {
      this.sample().catch((error: unknown) => {
        this.sampleFailures += 1;
        this.logger.warn(
          `monitoring sample failed (${this.sampleFailures} since boot): ${String(error)}`,
        );
      });
    }, SAMPLE_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.sampleTimer) clearInterval(this.sampleTimer);
    if (this.lagTimer) clearInterval(this.lagTimer);
  }

  system(): SystemMetrics {
    const mem = process.memoryUsage();
    const now = Date.now();
    const cpu = process.cpuUsage(this.lastCpu);
    const elapsedUs = Math.max(1, (now - this.lastCpuAt) * 1000);
    const cores = Math.max(1, getCpuCount());
    const cpuPercent = Math.min(100, ((cpu.user + cpu.system) / elapsedUs / cores) * 100);
    return {
      uptimeSeconds: Math.round(process.uptime()),
      memoryUsedMb: Math.round(mem.rss / 1024 / 1024),
      memoryTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      cpuPercent: Number(cpuPercent.toFixed(1)),
      eventLoopLagMs: this.eventLoopLagMs,
      pid: process.pid,
    };
  }

  /** Assemble the full operations overview for dashboards. */
  async overview() {
    const system = this.system();
    const health = await this.health.check();
    const queue = this.queue.stats();
    return {
      status: health.status,
      generatedAt: new Date().toISOString(),
      system,
      api: {
        throughput: this.metrics.throughput(),
        errorRate: Number(this.metrics.errorRate().toFixed(4)),
        latencyP95Ms: this.metrics.latencyP95(),
      },
      health,
      queue,
      circuits: this.breakers.states(),
      alerts: this.alerts.activeIncidents(),
    };
  }

  /** One sampling cycle: refresh gauges, evaluate alerts, broadcast. */
  private async sample(): Promise<void> {
    const system = this.system();
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = Date.now();

    this.metrics.gauge('memory_used_mb', system.memoryUsedMb);
    this.metrics.gauge('cpu_percent', system.cpuPercent);
    this.metrics.gauge('event_loop_lag_ms', system.eventLoopLagMs);

    const health = await this.health.check();
    const queue = this.queue.stats();
    const snap = this.metrics.snapshot();

    const values: Record<string, number> = {
      error_rate: this.metrics.errorRate(),
      latency_p95_ms: this.metrics.latencyP95(),
      database_up: health.dependencies.find((d) => d.name === 'database')?.status === 'up' ? 1 : 0,
      redis_up: health.dependencies.find((d) => d.name === 'redis')?.status === 'up' ? 1 : 0,
      queue_backlog: queue.backlog,
      memory_used_mb: system.memoryUsedMb,
      cpu_percent: system.cpuPercent,
      ws_disconnects: counter(snap.counters, 'ws_disconnects_total'),
      failed_settlements: counter(snap.counters, 'failed_settlements_total'),
      wallet_inconsistencies: counter(snap.counters, 'wallet_inconsistencies_total'),
    };

    await this.alerts.evaluate(values);
    this.gateway.emitOverview(await this.overview());
  }
}

function counter(counters: Record<string, number>, prefix: string): number {
  return Object.entries(counters)
    .filter(([k]) => k.startsWith(prefix))
    .reduce((sum, [, v]) => sum + v, 0);
}

function getCpuCount(): number {
  return Math.max(1, cpus().length);
}
