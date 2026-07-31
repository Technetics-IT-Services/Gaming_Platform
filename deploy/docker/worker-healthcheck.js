// Worker health probe (Phase 7, STEP 6). Exit 0 = healthy, non-zero = unhealthy.
// Liveness (--live): the process heartbeat file is fresh.
// Readiness (--ready): the queue backend is reachable.
// Kept dependency-free so it runs in the minimal runtime image.
const fs = require('node:fs');

const mode = process.argv.includes('--ready') ? 'ready' : 'live';
const HEARTBEAT = process.env.WORKER_HEARTBEAT_FILE || '/tmp/worker.heartbeat';
const MAX_STALE_MS = Number(process.env.WORKER_HEARTBEAT_MAX_MS || 30000);

try {
  if (mode === 'live') {
    const stat = fs.statSync(HEARTBEAT);
    const age = Date.now() - stat.mtimeMs;
    process.exit(age <= MAX_STALE_MS ? 0 : 1);
  } else {
    // Readiness: a ready marker is written once the worker has connected to Redis.
    process.exit(fs.existsSync(process.env.WORKER_READY_FILE || '/tmp/worker.ready') ? 0 : 1);
  }
} catch {
  process.exit(1);
}
