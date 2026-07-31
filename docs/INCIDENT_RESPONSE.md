# Incident Response Plan (Phase 8, STEP 8)

Backed by the incident model in `apps/frontend/src/lib/security/incident.ts` (severity, validated
lifecycle, escalation matrix, forensic checklist). Complements the operational runbooks in
`docs/RUNBOOKS.md`.

## Lifecycle

`Detected → Triaged → Contained → Eradicated → Recovered → Closed` (transitions validated;
SEV1/SEV2 cannot close until the forensic checklist is complete).

## Severity classification

| Sev | Definition | Examples |
|---|---|---|
| **SEV1** | Money movement impaired, confirmed breach, or full outage | ledger drift, credential DB exfil, payment webhook forgery |
| **SEV2** | Degraded / partial; elevated risk | brute-force campaign, one AZ down, suspected token theft |
| **SEV3** | Minor / single-tenant | isolated XSS report, one tenant misconfig |
| **SEV4** | Informational | scanner noise, low-confidence indicator |

## Escalation matrix

| Sev | Paged roles |
|---|---|
| SEV1 | on-call-eng, security-lead, eng-director, finance-lead, legal, comms |
| SEV2 | on-call-eng, security-lead |
| SEV3 | on-call-eng |
| SEV4 | ticket-queue |

## Response phases

1. **Detect** — alert from SIEM / security event stream / anomaly detection → declare an incident.
2. **Triage** — assign an Incident Commander, set severity, page per the matrix, open a war-room + timeline.
3. **Contain** — revoke sessions (`SessionManager.revokeAllForUser`), rotate compromised secrets, block IOCs
   (`SecurityMonitor.addIndicator`), scale down blast radius. **Preserve evidence first.**
4. **Eradicate** — remove the root cause (patch, rotate keys, redeploy a clean image).
5. **Recover** — restore service (DR playbook if data-tier affected), verify `ledger.reconcile() == 0`.
6. **Close** — only after the forensic checklist is complete; schedule the postmortem.

## Forensic evidence checklist (gates SEV1/SEV2 close)
- [ ] preserve_logs — snapshot app/audit/access logs before any remediation
- [ ] snapshot_affected_hosts — disk images of affected nodes/pods
- [ ] capture_memory_if_applicable — live memory where relevant
- [ ] export_security_audit_stream — `SecurityMonitor.socExport()`
- [ ] record_iocs — IPs, devices, accounts, hashes
- [ ] chain_of_custody_documented — who/when/what for every artifact

## Breach response (data / credential compromise)

1. Contain + preserve (above). Do **not** wipe — image and hold.
2. Determine scope: what data, which subjects, what window (from the audit streams).
3. Legal + compliance engaged (SEV1 auto-escalates). Assess regulatory notification duties (GDPR 72h,
   PCI, state laws) with counsel.
4. Rotate **all** potentially-exposed credentials/keys; force re-auth (`revokeAllForUser` fleet-wide).
5. Notify affected users/regulators per counsel's timeline; prepare comms.
6. Postmortem + control improvements tracked to closure.

## Postmortem template (blameless)

```
# Incident <id> — <title>
- Severity / duration / impact (users, money, data)
- Timeline (detection → resolution; from the incident timeline)
- Root cause (5 whys)
- What went well / what didn't
- Detection & response gaps
- Action items (owner, due date, tracking link)
- Evidence: forensic checklist artifacts
```
