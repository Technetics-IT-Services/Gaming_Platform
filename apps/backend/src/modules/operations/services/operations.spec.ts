import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MetricsService } from './metrics.service';
import { QueueService } from './queue.service';

/**
 * Operations service semantics: metrics aggregation (error rate / throughput)
 * and the background queue's retry → dead-letter behaviour, verified
 * deterministically by draining at injected times.
 */
describe('MetricsService', () => {
  it('aggregates throughput and error rate from HTTP records', () => {
    const metrics = new MetricsService();
    metrics.recordHttp('GET', '/a', 200, 10);
    metrics.recordHttp('GET', '/a', 200, 20);
    metrics.recordHttp('POST', '/b', 500, 30);
    expect(metrics.throughput()).toBe(3);
    expect(metrics.errorRate()).toBeCloseTo(1 / 3, 5);
    expect(metrics.latencyP95()).toBeGreaterThan(0);
  });
});

describe('QueueService', () => {
  it('retries a failing job then dead-letters it', async () => {
    const queue = new QueueService();
    try {
      let attempts = 0;
      queue.process('settle', async () => {
        attempts += 1;
        throw new Error('boom');
      });
      const id = queue.enqueue('settle', { x: 1 }, { maxAttempts: 2 });

      await queue.drain(0); // attempt 1 → fails, reschedules
      await queue.drain(60_000); // attempt 2 → fails → dead-letter
      expect(attempts).toBe(2);
      expect(queue.stats().byStatus.dead).toBe(1);

      expect(queue.retry(id)).toBe(true); // requeue from DLQ
      expect(queue.stats().byStatus.pending).toBe(1);
    } finally {
      queue.onModuleDestroy();
    }
  });

  it('completes a successful job and supports batches', async () => {
    const queue = new QueueService();
    try {
      const seen: number[] = [];
      queue.process<number>('notify', async (n) => {
        seen.push(n);
      });
      queue.enqueueBatch('notify', [1, 2, 3]);
      await queue.drain(0);
      expect(seen.sort()).toEqual([1, 2, 3]);
      expect(queue.stats().byStatus.completed).toBe(3);
    } finally {
      queue.onModuleDestroy();
    }
  });
});

/**
 * Phase 2D.11 — the monitoring sampler must never be able to kill the process.
 *
 * Regression for a real defect: `setInterval(() => void this.sample(), …)` discarded the promise,
 * so a transient database error inside a sampling cycle became an unhandled rejection — and an
 * unhandled rejection terminates the Node process. Observed once during a full serial test run.
 */
describe('MonitoringService — a failing sample cannot crash the process', () => {
  it('catches the rejection at the interval callback', () => {
    // Comments are stripped first: the fix's own note QUOTES the dangerous shape in order to
    // explain it, and scanning the raw file would flag that explanation.
    const src = readFileSync(join(__dirname, 'monitoring.service.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // The dangerous shape must not return.
    expect(src).not.toContain('void this.sample()');
    // And the promise must be caught.
    expect(src).toMatch(/this\.sample\(\)\s*\.catch\(/);
  });
});
