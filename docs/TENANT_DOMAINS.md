# Tenant Domains & Verification (Phase 3.2, STEP 7 & 8)

Modules: `persistence/repositories.ts` (`DomainRepository`) + `control-plane/domain-service.ts`
(`DomainService`). Manages platform subdomains and custom domains with hostname normalization,
uniqueness, tenant ownership, and a real verification flow. A domain can **never** become Active without a
genuine verification result.

## Lifecycle

```
createDomain → PendingVerification
   → verifyDomain (provider confirms the DNS/HTTP challenge) → Verified
      → activateDomain → Active  (resolves traffic)
         → suspendDomain → Suspended → activateDomain → Active
      → removeDomain → Removed  (frees the hostname)
```

Domain states: `PendingVerification`, `Verified`, `Active`, `Suspended`, `Removed`.

## Verification (STEP 8) — never faked

```ts
interface DomainVerificationProvider {
  check(input: { hostname, method: 'dns-txt' | 'dns-cname' | 'http', token }): boolean | Promise<boolean>;
}
```

`verifyDomain` calls the provider and marks the domain `Verified` **only** on a genuine pass; a failure
throws `DOMAIN_VERIFICATION_FAILED` and is audited. A production provider queries DNS (TXT/CNAME) or fetches
an HTTP challenge URL. The `MockDomainVerificationProvider` (tests/dev) does **not** auto-pass — a challenge
must be explicitly `satisfy()`-ed, mirroring the operator publishing the DNS/HTTP record. Real verification
is therefore never bypassed.

## Takeover protection

- **Hostname normalization**: trimmed, lower-cased, trailing dot stripped; format-validated.
- **Global uniqueness**: `domains_hostname_uq` is unique among all non-removed rows, so a hostname bound to
  one tenant cannot be re-registered by another → `DOMAIN_TAKEOVER`.
- **Tenant ownership**: every domain row carries `tenant_id`; `resolveDomain` returns the owning tenant only
  for **Active** domains.

## Resolution

```ts
domainService.resolveDomain('play.acme.com'); // → { tenantId, domainId } | null (Active only)
```

The control plane's `resolve()` uses this for hostname-based tenant resolution — O(1) via the hostname
index. Subdomains resolve by tenant code. This prevents cross-tenant domain binding and duplicate hostname
ownership.
