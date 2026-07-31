# Production Hardening Guide (Phase 8, STEP 4 & 5)

Container security, supply-chain security and the production hardening checklist. This
guide is documentation + CI hooks — it changes no application logic.

## Container security (STEP 4)

- **Non-root** — images run as uid 1001; `runAsNonRoot: true` enforced by Pod Security `restricted`.
- **Read-only root filesystem** — `readOnlyRootFilesystem: true`; writable paths are explicit `emptyDir`
  mounts (`/tmp`, Next cache).
- **Least privilege** — `allowPrivilegeEscalation: false`, `capabilities: { drop: [ALL] }`,
  `seccompProfile: RuntimeDefault`.
- **Image signing** — sign every image with **cosign** (keyless/OIDC); the registry stores the
  signature + attestations.
- **SBOM** — generate a CycloneDX/SPDX SBOM at build (`syft`); attach as an attestation.
- **Admission policy** — cluster admission (Kyverno/Gatekeeper) rejects: unsigned images, `:latest`
  tags, running as root, privileged pods, hostPath mounts, missing resource limits.
- **Runtime security** — Falco (or equivalent) rules for anomalous exec/network activity; alerts route
  to the security event stream / SIEM.

### Verification (per release)
```
cosign verify --key <cosign.pub> ghcr.io/gaming-platform/frontend@<digest>
syft ghcr.io/gaming-platform/frontend@<digest> -o cyclonedx-json > sbom.json
grype sbom:sbom.json --fail-on high        # SBOM-based vuln scan
```

## Supply-chain security (STEP 5)

| Control | Tool (hook) | Gate |
|---|---|---|
| Dependency scanning (SCA) | `pnpm audit`, Dependabot, Grype/Trivy | fail on HIGH/CRITICAL |
| SAST | CodeQL (`.github/workflows/codeql.yml`), Semgrep | fail on error-severity |
| DAST | OWASP ZAP baseline against a staging deploy | fail on High alerts |
| Secret scanning | Gitleaks / TruffleHog (pre-commit + CI) | block on any finding |
| License compliance | `license-checker` allow-list (MIT/Apache-2.0/BSD/ISC) | block copyleft in prod deps |
| Artifact verification | cosign signature + SBOM attestation on pull | admission-enforced |
| Pinned dependencies | `pnpm-lock.yaml` + `--frozen-lockfile` | reproducible builds |

CI ordering: **secret-scan → SAST → build → SBOM → image-scan → sign → (deploy) → DAST**.

## Production hardening checklist

### Network / transport
- [ ] TLS 1.2+ everywhere; HSTS with preload; no mixed content.
- [ ] Default-deny NetworkPolicy; egress restricted to required destinations.
- [ ] WAF / rate-limiting at the ingress.

### Application
- [ ] Security headers + strict CSP on every response.
- [ ] CSRF protection on all state-changing routes.
- [ ] Input validated, output encoded per sink; SSRF guard on all outbound fetches.
- [ ] Secure, `__Host-`-prefixed, HttpOnly session cookies.

### Identity
- [ ] MFA enforced for all privileged (admin/partner/analytics/security) roles.
- [ ] Password policy + lockout enforced; sessions rotate + revoke on reuse.
- [ ] JWT jti blacklist checked on every request.

### Secrets
- [ ] No secrets in Git/images/env dumps (secret scanning green).
- [ ] Secrets from KMS/Vault, versioned + rotated on a schedule; access audited.

### Platform
- [ ] Containers non-root, read-only rootfs, caps dropped, seccomp default.
- [ ] Images signed + SBOM + admission-enforced; no `:latest`.
- [ ] Least-privilege RBAC across every admin surface; audited allow AND deny.

### Monitoring
- [ ] Security events forwarded to SIEM; High/Critical page on-call.
- [ ] Threat indicators + anomaly detection wired.
