# Tenant API Keys (Phase 3.2, STEP 9)

Modules: `control-plane/crypto.ts` + `control-plane/api-key-service.ts` +
`persistence/repositories.ts` (`ApiKeyRepository`). Cryptographically secure keys; the database stores
**only a hash + a safe prefix**, never plaintext.

## Format

```
tk_live_<32 url-safe chars>     ← full secret (plaintext), shown to the caller ONCE
tk_live_ab12cd                  ← prefix (safe to store/display/log)
sha-256(plaintext)              ← the only key material persisted (hex)
```

`generateApiKey('live' | 'test')` returns `{ plaintext, prefix, hash }`. The plaintext is returned by
`issue()` exactly once and is **never** persisted, logged, or retrievable again.

## Storage — never plaintext

`tenant_api_keys` holds: `prefix`, `hash` (unique), `name`, `scopes`, `created_at`, `expires_at`,
`revoked_at`, `last_used_at`, `tenant_id`, `version`. There is **no** column for the secret. The audit
trail redacts any secret-looking field, so a plaintext key never reaches the audit store either
(asserted in tests).

## Lifecycle

```ts
const { plaintext, key } = svc.issue({ tenantId, name, scopes, expiresAt, env });  // plaintext ONCE
svc.verify(plaintext);        // → { tenantId, keyId, scopes } | null  (timing-safe, checks revoke+expiry)
svc.requireValid(plaintext);  // throws KEY_REVOKED / KEY_EXPIRED / NOT_FOUND
svc.revoke(keyId, actor);     // sets revoked_at → verify returns null
svc.list(tenantId);           // ApiKeyView[] — never includes the hash
```

## Verification

- Presented plaintext → `sha-256` → O(1) lookup on the unique `hash` index.
- Comparison is **timing-safe** (`crypto.timingSafeEqual` on the digest bytes).
- A revoked key (`revoked_at` set) or expired key (`expires_at ≤ now`) never verifies.
- `last_used_at` is stamped best-effort on each successful verify.

## Scopes & ownership

Each key carries `scopes` and belongs to exactly one tenant. Verification returns the owning `tenantId` +
`scopes`, which the caller uses for authorization. Cross-tenant key use is impossible — a key resolves only
to its owning tenant. No full secret is ever logged.
