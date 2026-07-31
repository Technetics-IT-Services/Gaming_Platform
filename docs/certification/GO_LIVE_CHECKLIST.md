# Go-Live Checklist — Enterprise Platform v1.4

**Release manager:** _________ · **Target window:** _________ · **Baseline:** `main` @ `00998b0`

Go/No-Go is **GO** only when every **blocking** item is checked. Non-blocking items are tracked.

## Release governance (STEP 7)

- [ ] **Release notes** finalized (`RELEASE_NOTES.md`) and distributed.
- [ ] **Version** tagged (annotated git tag; image digests immutable; `/version` returns the tag).
- [ ] **Rollback plan** rehearsed — `kubectl rollout undo deploy/frontend`; migrations are expand-only so
      app rollback needs no schema rollback.
- [ ] **Deployment approval** recorded (gated production environment; named approver).
- [ ] **Maintenance window** scheduled + communicated; change ticket raised.
- [ ] **Communication plan** ready (status page, stakeholder + support notice, on-call roster).

## Technical gates (blocking)

- [ ] CI green on the release commit (lint + typecheck + **439 unit tests** + e2e).
- [ ] Image built from an immutable digest and **scanned** (no HIGH/CRITICAL); cosign-signed; SBOM attached.
- [ ] DB migration is **expand-only** and dry-run-verified against a staging clone.
- [ ] Secrets present in the secret manager (no placeholders); **secret-scan clean** (no secrets in Git/images).
- [ ] Feature flags for the release default **off** (dark launch).
- [ ] Health endpoints green: `/api/health/live`, `/api/health/ready`, `/version`.

## Infrastructure & HA (blocking)

- [ ] ≥3 replicas across ≥3 zones; PDB + topology spread applied (`deploy/ha/multi-zone.yaml`).
- [ ] HPA configured (frontend CPU/mem, worker queue depth); scale-up verified < 60s.
- [ ] PgBouncer + read replicas live; replication lag alerting on.
- [ ] Redis Sentinel (or managed HA) live; AOF persistence on; cache/queue split.
- [ ] Backups running + a **restore drill** completed within the last quarter (RPO ≤ 1m / RTO ≤ 30m).

## Security (blocking)

- [ ] MFA enforced for all privileged roles; RBAC + tenant isolation verified.
- [ ] TLS + HSTS + security headers + strict CSP live at the ingress.
- [ ] SIEM forwarding active; High/Critical events page on-call.
- [ ] Incident response on-call + escalation matrix confirmed.

## Observability & SRE (blocking)

- [ ] Dashboards live: SLO burn, latency p95/p99, error rate, queue depth, replication lag,
      circuit/bulkhead stats.
- [ ] Alert rules + channels wired (page ≥ 14.4 burn, ticket ≥ 3).
- [ ] Error budgets seeded; error-budget policy acknowledged.

## Financial integrity (blocking)

- [ ] Post-deploy smoke asserts `ledger.reconcile().systemSum === 0` and treasury `balanced === true`.
- [ ] Payment webhook signature verification + idempotency confirmed in staging (no double-credit).

## Non-blocking (tracked)

- [ ] External penetration test scheduled.
- [ ] Formal PCI / SOC2 / ISO attestations engaged.
- [ ] API p95 tuning (accepted WARN — target ≤ 200ms).

## Go/No-Go decision

| Role | Name | Go / No-Go | Notes |
|---|---|---|---|
| CTO | | | |
| CISO | | | |
| Principal SRE | | | |
| Principal QA Director | | | |
| Release Manager | | | |

**Decision:** ☐ GO ☐ NO-GO — recorded by the Production Readiness Review Board.
