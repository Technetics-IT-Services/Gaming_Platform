# Compliance Control Mapping (Phase 8, STEP 7)

Maps the platform's security controls to OWASP ASVS, PCI DSS, ISO 27001 and SOC2. Backed by the
machine-readable registry in `apps/frontend/src/lib/security/compliance-evidence.ts`
(`defaultControls()`), which produces an auditor-ready evidence matrix + coverage metrics.

## Control matrix

| Control | Implementation | ASVS | PCI DSS | ISO 27001 | SOC2 |
|---|---|---|---|---|---|
| AC-1 RBAC enforcement | least-privilege RBAC (ops/partner/analytics/security) | 1.4.1, 4.1.3 | 7.1 | A.9.4 | CC6.1 |
| IA-2 Multi-factor auth | TOTP (RFC 6238) + WebAuthn | 2.2.1 | 8.4 | A.9.4 | CC6.1 |
| SC-8 Transport encryption | TLS + HSTS everywhere | 9.1.1 | 4.1 | A.13.1 | CC6.7 |
| SC-28 Secret management | KMS/Vault, versioned + rotated + audited | 6.4.1 | 3.6 | A.10.1 | CC6.1 |
| AU-2 Security audit logging | append-only event stream + SIEM | 7.1.1 | 10.2 | A.12.4 | CC7.2 |
| SI-10 Input/output safety | validation framework + context encoders | 5.1.1, 5.3.1 | 6.5 | A.14.2 | CC7.1 |
| IR-4 Incident response | IR model + severities + escalation + forensics | 1.11.1 | 12.10 | A.16.1 | CC7.3 |
| CM-7 Least-functionality | non-root, read-only rootfs, admission policy | 14.1.1 | 2.2 | A.12.6 | CC6.8 |

## Framework notes

- **OWASP ASVS** — target **Level 2** (defense-in-depth for apps handling sensitive data). V1 (architecture),
  V2 (authentication), V3 (session), V5 (validation/encoding), V6 (crypto/secrets), V7 (logging), V9
  (communications), V14 (config) are covered by the modules above.
- **PCI DSS** — the platform tokenizes payments through the gateway adapters (Phase 5B); **no raw PAN is
  stored** (SAQ-A posture). Controls here cover Req 3 (protect stored data — secrets), 4 (encrypt
  transit), 6 (secure development — SAST/DAST/SCA), 7/8 (access + MFA), 10 (logging), 12 (IR policy).
- **ISO 27001** — Annex A controls A.9 (access), A.10 (crypto), A.12 (operations/logging), A.13
  (communications), A.14 (secure development), A.16 (incident management).
- **SOC2** — Trust Services Criteria: **CC6** (logical access — RBAC/MFA/secrets), **CC7** (system
  operations — monitoring/validation/IR), plus the availability criteria met by Phase 7 infra (HPA/PDB/DR).

## Evidence collection

Evidence is attached per control (`kind`: config | log | test | scan | document | attestation) by
**reference** — the evidence matrix exports `control → status → frameworks → evidence-count`, and
`coverage()` reports `percentImplemented`. Automated tests (`security.test.ts`, and the full 397-test
suite) serve as `test` evidence for SI-10, IA-2, AC-1, SC-28 and IR-4.
