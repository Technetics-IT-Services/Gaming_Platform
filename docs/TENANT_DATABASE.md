# Tenant Database Schema (Phase 3.2, STEP 1)

Declarative schema + migrations live in `persistence/schema.ts` (`TABLES`, `TABLE_INDEXES`, `MIGRATIONS`)
and row types in `persistence/records.ts`. The same definitions drive the in-memory driver and a
production SQL/Prisma deployment. Every mutable row carries ownership + audit columns: `tenant_id`,
`created_at`, `updated_at`, `created_by`, `updated_by`, `version`.

## Tables

### `tenants`
`id` PK · `code` **UNIQUE** · `name` · `operator_id` (idx) · `status` · `plan` · `region` · `timezone` ·
`currency` · `locale` · `brand` JSONB · `theme` JSONB · `limits` JSONB · `metadata` JSONB · lifecycle
timestamps · audit cols · `version`.

### `tenant_domains`
`id` PK · `tenant_id` (idx) · `hostname` **UNIQUE where status≠removed** · `kind` (subdomain|custom) ·
`status` (pending-verification|verified|active|suspended|removed) · `verification_method` ·
`verification_token` · `verified_at` · audit cols · `version`.

### `tenant_api_keys`
`id` PK · `tenant_id` (idx) · `prefix` **UNIQUE** · `hash` **UNIQUE** (sha-256) · `name` · `scopes` ·
`expires_at` · `revoked_at` · `last_used_at` · audit cols · `version`. **No plaintext ever stored.**

### `tenant_configurations`
`id` PK · `tenant_id` **UNIQUE** · `active_version` · audit cols · `version`. (Pointer to the active
configuration version.)

### `tenant_configuration_versions`
`id` PK (`{tenantId}:v{n}`) · `tenant_id` (idx) · `version` (monotonic per tenant) · `config` JSONB ·
`created_at` · `created_by` · `reason`. **Immutable — never updated or deleted.**

### `tenant_feature_flags`
`id` PK (`{scope}:{flag}`) · `scope` (global|tenantId, idx) · `flag` (idx) · `enabled` (tenant override) ·
`rule` JSONB (global rule: default/plans/rolloutPercentage/operatorAllowList/killSwitch) · audit cols.

### `tenant_quotas`
`id` PK · `tenant_id` **UNIQUE** · `limits` JSONB · audit cols · `version`.

### `tenant_lifecycle_events` (append-only)
`id` PK · `tenant_id` (idx) · `from_status` · `to_status` · `actor_id` · `reason` · `at`.

### `tenant_audit_events` (append-only, immutable)
`id` PK · `tenant_id` (idx) · `actor_id` · `actor_type` · `action` (idx) · `resource` · `resource_id` ·
`at` · `request_id` · `correlation_id` · `reference` · `before` JSONB · `after` JSONB · `result` ·
`reason` · `metadata` JSONB. **Secrets redacted before write.**

### `tenant_provisioning`
`id` PK · `tenant_id` (idx) · `idempotency_key` **UNIQUE** · `state` · `completed_steps` · `error` ·
audit cols · `version`.

### `tenant_secret_refs`
`id` PK · `tenant_id` (idx) · `path` **UNIQUE** (`tenant/{id}/{ns}/{name}`) · `reference` (opaque handle) ·
`rotation_of` · audit cols · `version`. **References only — never secret values.**

## Indexes (O(1) lookups — STEP 22)

`tenants_code_uq`, `tenants_operator`, `domains_hostname_uq`, `domains_tenant`, `apikeys_prefix_uq`,
`apikeys_hash_uq`, `apikeys_tenant`, `config_tenant_uq`, `configver_tenant`, `flags_scope`, `flags_flag`,
`quotas_tenant_uq`, `lifecycle_tenant`, `audit_tenant`, `audit_action`, `provisioning_idem_uq`,
`provisioning_tenant`, `secretrefs_path_uq`, `secretrefs_tenant`.

## Migrations

`MIGRATIONS` is an ordered, versioned list (v1 = `0001_init_tenant_control_plane`) enumerating the exact
`CREATE TABLE` / `CREATE [UNIQUE] INDEX` statements a real migrator runs. `applySchema(driver)` wires the
same tables + indexes into any driver. A production deployment maps each table to a Postgres table via
Prisma; JSONB columns hold the brand/theme/limits/config payloads.
