# Tenant Provisioning (Phase 3.2, STEP 13)

Module: `control-plane/provisioning-service.ts` (`ProvisioningService`). An **idempotent, retry-safe**
workflow that creates a tenant and brings it to Active, keyed by an `idempotencyKey`.

## Flow

```
provision({ ..., idempotencyKey })
  ├─ create tenant record  ─┐ (atomic with the provisioning row)
  ├─ start provisioning row ─┘  → state: record-created
  ├─ create initial configuration version   → configured
  ├─ feature flags (plan defaults apply)     → flagged
  ├─ persist quotas (plan limits)            → quota-set
  ├─ create resource namespaces              → namespaced
  ├─ audit + mark provisioned                → provisioned
  └─ activate (Provisioned → Active)         → activated
```

`tenant_provisioning` persists `state`, `completed_steps`, `error`, `idempotency_key` (unique), `tenant_id`.

## Idempotency & retry (STEP 13, 20)

- **Replay**: calling `provision` again with an `idempotencyKey` whose attempt is already `activated`
  returns the SAME tenant (`reused: true`) — no duplicate tenant, no re-run.
- **Retry after failure**: each step is guarded (checks whether it is already done), so a retry **resumes**
  from where it failed rather than starting over.
- **Atomic start**: the tenant record and the provisioning row are created in one transaction — a failure
  there rolls back both (no orphan tenant).

## Failure handling — no partially-active tenant

If any step throws, the workflow records `state: 'failed'` with the error, writes a `ProvisioningFailed`
audit entry, and throws `PROVISIONING_FAILED`. Crucially, activation is the **last** step — so a failed
provision leaves the tenant in `Provisioned` (never a partially-active tenant). A subsequent retry with the
same key completes it. This is verified in `control-plane.test.ts` (fail → assert `Provisioned` → retry →
`Active`).

## Financial inertness (STEP 27)

Provisioning creates zero ledger entries, zero wallet movement, zero treasury/payment impact — it only
writes control-plane tables. The wallet-balance invariant test proves a full provision leaves money
untouched.
