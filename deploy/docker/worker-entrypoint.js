// Worker entrypoint (Phase 7, STEP 6) — a thin, dependency-light bootstrap that
// drives the framework-agnostic job framework (src/lib/infra/jobs.ts). It writes a
// heartbeat + ready marker consumed by worker-healthcheck.js, and drains queues on a
// timer. Wiring to the real Redis queue backend + job handlers is deployment-specific
// and injected here; the framework itself owns retries/backoff/DLQ/scheduling.
const fs = require('node:fs');

const HEARTBEAT = process.env.WORKER_HEARTBEAT_FILE || '/tmp/worker.heartbeat';
const READY = process.env.WORKER_READY_FILE || '/tmp/worker.ready';
const POLL_MS = Number(process.env.WORKER_POLL_MS || 1000);

let running = true;
function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`[worker] received ${signal}, draining…`);
  running = false;
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function main() {
  // TODO(deployment): connect the Redis queue backend + register job handlers via
  // the Worker/Scheduler from src/lib/infra. Marked ready once connected.
  fs.writeFileSync(READY, String(Date.now()));
  // eslint-disable-next-line no-console
  console.log('[worker] started');
  while (running) {
    fs.writeFileSync(HEARTBEAT, String(Date.now()));
    // drain(): worker.drain(); scheduler.tick(); — driven by the infra job framework.
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  // eslint-disable-next-line no-console
  console.log('[worker] stopped cleanly');
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker] fatal', err);
  process.exit(1);
});
