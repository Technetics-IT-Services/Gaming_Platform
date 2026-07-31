# Risk Register — Enterprise Platform v1.4 (Go-Live)

Likelihood (L) × Impact (I) on 1–5; Severity = L×I. All residual risks are **Low/Medium** with an
owner and mitigation. No risk is a GA blocker given the mitigations in place.

| ID | Risk | L | I | Sev | Mitigation (in place) | Residual | Owner |
|---|---|---|---|---|---|---|---|
| R-01 | Ledger drift / double-spend | 1 | 5 | 5 | Frozen double-entry ledger, exactly-once idempotency, per-op `reconcile()==0` assertions, negative-balance guard | Low | Platform Arch |
| R-02 | Payment double-credit on webhook replay | 1 | 5 | 5 | Triple-guarded exactly-once (event dedup + intent guard + ledger idempotency key); signature + replay window | Low | Payments |
| R-03 | Secret leakage | 2 | 5 | 10 | KMS/Vault, rotation, masking, no-commit + secret-scan gate, audited access | Low | CISO |
| R-04 | Auth compromise (credential stuffing / session theft) | 2 | 4 | 8 | MFA (TOTP/WebAuthn), lockout, refresh-token rotation + reuse detection, jti blacklist | Low | CISO |
| R-05 | Dependency/supply-chain vuln | 3 | 4 | 12 | SCA/SAST/DAST/secret-scan gates, SBOM, cosign, admission policy, pinned lockfile | Medium | DevSecOps |
| R-06 | Region / AZ outage | 2 | 4 | 8 | Multi-zone spread + PDB, regional failover, geo-replicated backups, DR (RTO ≤ 30m) | Low | SRE |
| R-07 | DB primary failure | 2 | 4 | 8 | Streaming replicas, standby promotion, `synchronous_commit` (RPO ≤ 1m), PgBouncer | Low | DB Eng |
| R-08 | Redis primary failure | 2 | 3 | 6 | Sentinel failover, AOF durability, cache/queue split, reliable-queue processing list | Low | SRE |
| R-09 | Traffic spike beyond capacity | 3 | 3 | 9 | HPA (CPU/mem + queue depth), adaptive rate limiting, backpressure (money paths protected), stress-validated knee | Medium | SRE |
| R-10 | Cascading dependency failure | 2 | 4 | 8 | Circuit breakers + bulkheads + timeouts + retry budgets + fallbacks (`Resilience.run`) | Low | Platform Eng |
| R-11 | Latency SLO breach (p95) | 3 | 2 | 6 | Accepted WARN-1; edge caching/pool tuning; regression gate; p99 within target | Medium | SRE |
| R-12 | Pen-test finding post-GA | 2 | 3 | 6 | Internal OWASP/ASVS pass; WARN-2 scheduled; rapid patch pipeline | Medium | CISO |
| R-13 | Compliance attestation gap (formal) | 2 | 3 | 6 | Evidence matrix (ASVS/PCI/ISO/SOC2) + controls implemented; formal audit engaged post-GA | Medium | Compliance |
| R-14 | Data corruption / bad migration | 1 | 5 | 5 | Expand-only migrations, PITR to pre-incident second, post-restore `reconcile()==0` | Low | DB Eng |
| R-15 | Provider (gateway/SMS/email) outage | 3 | 3 | 9 | Provider abstraction + retries/circuit breaker; money paths fail closed (no fabricated success) | Medium | Integrations |
| R-16 | Config/secret misconfiguration at deploy | 2 | 4 | 8 | Config validation (aggregated errors), go-live checklist, health gates, dark-launch flags | Low | Release Mgr |

## Summary

- **Critical financial risks (R-01, R-02, R-14)** are reduced to **Low** by the frozen double-entry
  ledger + exactly-once guarantees + reconcile assertions.
- Highest residual (**Medium**) risks are supply-chain (R-05), spike capacity (R-09), latency (R-11),
  pen-test/compliance follow-ups (R-12/R-13) and provider outages (R-15) — all mitigated and monitored.
- **No High/Critical residual risk remains open.** Register owned by the Review Board; re-reviewed each
  release.
