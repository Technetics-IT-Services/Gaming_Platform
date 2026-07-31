/**
 * Version / build metadata (Phase 7, STEP 7).
 *
 * Deployment-time build information surfaced at `/version` for release traceability
 * (blue-green / canary / rollback). Populated from env vars injected by CI. Read-only.
 */

export interface BuildInfo {
  version: string;
  gitSha: string;
  builtAt: string;
  environment: string;
  /** Deployment strategy that shipped this build (informational). */
  releaseChannel?: string;
}

/** Read build metadata from an env source, with safe defaults for local dev. */
export function buildInfo(env: Record<string, string | undefined> = {}): BuildInfo {
  return {
    version: env.APP_VERSION ?? '0.0.0-dev',
    gitSha: env.GIT_SHA ?? 'unknown',
    builtAt: env.BUILD_TIME ?? '1970-01-01T00:00:00Z',
    environment: env.NODE_ENV ?? 'development',
    releaseChannel: env.RELEASE_CHANNEL,
  };
}

/** A tiny semver comparator for rollout/rollback decisions (−1 / 0 / 1). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, '').split('-')[0]!.split('.').map((n) => Number(n) || 0);
  const [pa, pb] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}
