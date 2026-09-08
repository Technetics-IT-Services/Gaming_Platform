# Production Bootstrap & Wallet Provisioning (Phase 2A)

The idempotent bootstrap layer that makes the existing wallet/ledger and admin APIs legitimately
exercisable — **without** modifying any frozen module (runtime, ledger, wallet-core, games) and **without**
fabricating financial history. Implemented entirely in the seed: `packages/database/prisma/seed.ts`.

## What the seed creates

| Reference data | Detail |
|---|---|
| **Currencies** | `INR` — Indian Rupee `₹` (**primary**, India-market) and `USD` `$`. `type FIAT`, `decimals 2`, `isActive true`. Upsert by `code`. |
| **Permissions** | The 24-entry canonical catalog (`users:read`…`feature_flags:write`). Upsert by `slug`; `resource`/`action` split from the slug. |
| **Roles** | 5 system roles: `user`(10), `vip`(20), `moderator`(30), `admin`(40), `super_admin`(50). Upsert by `slug`, `isSystem: true`. |
| **Grants** | `role_permissions` per the catalog: `admin` gets `wallets:read` (+ operational reads/writes); `super_admin` gets **all** permissions. |
| **Bootstrap admin** | A deterministic user from env credentials, `status ACTIVE`, `emailVerified true`, assigned the **`super_admin`** role. |

The slugs/levels mirror the backend's `RbacBootstrapService` (`apps/backend/.../rbac.constants.ts`) exactly,
so **seed-then-boot converge** (both upsert by slug — no duplicates).

## Environment variables

| Var | Required | Purpose |
|---|:--:|---|
| `DATABASE_URL` | ✓ | target database (platform-owned; never a shared/other project's DB) |
| `BOOTSTRAP_ADMIN_EMAIL` | ✓ | bootstrap admin email |
| `BOOTSTRAP_ADMIN_PASSWORD` | ✓ | bootstrap admin password (hashed with bcrypt via `@gaming-platform/auth`; **never stored/printed in plaintext**) |
| `BOOTSTRAP_ADMIN_USERNAME` | – | optional (default `root_admin`) |

If `BOOTSTRAP_ADMIN_EMAIL` or `BOOTSTRAP_ADMIN_PASSWORD` is missing, the seed **fails clearly** and creates
**no** admin (never a silent insecure account).

## Operator procedure

```bash
# 1. Migrate the schema (Phase 1 baseline)
pnpm --filter @gaming-platform/database db:migrate:deploy

# 2. Seed reference data + bootstrap admin (idempotent)
DATABASE_URL=... \
BOOTSTRAP_ADMIN_EMAIL=admin@yourdomain \
BOOTSTRAP_ADMIN_PASSWORD='<strong-secret-from-secret-manager>' \
pnpm --filter @gaming-platform/database db:seed

# 3. Boot the backend (RbacBootstrapService re-affirms the RBAC catalog idempotently)
# 4. Log in as the bootstrap admin → the super_admin can reach admin/wallet endpoints
```

Re-running step 2 is safe: it upserts only and **rotates the admin password** to the current env value. It
NEVER deletes, truncates, resets, creates wallets, or writes ledger entries.

## Wallet provisioning model

Wallets are **provisioned on demand** by the existing frozen wallet engine — `WalletEngineService`
(`getOrCreateWallet` upsert) creates the `Wallet` + `WalletBalance` the first time a user's balance is
touched (e.g. an authorized `POST /api/v1/admin/wallet/credit`). Registration does **not** pre-create a
wallet, and the **seed does not create wallets or ledger entries**. Controlled test funding uses the
existing admin endpoint (super_admin → `wallets:adjust`); the double-entry ledger keeps `debit === credit`.

## Authorization model (unchanged / not weakened)

Global guards: `JwtAuthGuard → RolesGuard → PermissionsGuard`. `admin/wallet/reconcile` requires
`wallets:read`; `credit`/`debit` require `wallets:adjust`. `super_admin` short-circuits the
`PermissionsGuard`. The bootstrap admin is a `super_admin`, so it can reconcile and (for later controlled
funding) adjust. No controller was modified; authorization is enforced entirely by the existing RBAC.

## Verification (all live-proven, Phase 2A)

- Seed idempotent: two runs → stable counts (currencies 2, roles 5, permissions 24, 46 grants; admin 1).
- Fail-safe: no credentials → seed refuses (exit 1, clear message).
- Admin login works; `/users/me` → `role: SUPER_ADMIN`.
- Normal `USER` → `admin/wallet/reconcile` → **403**; bootstrap admin → **200**.
- Empty-ledger reconcile: `{ debit:"0", credit:"0", balanced:true, difference:"0" }`.
- Controlled credit → wallet auto-provisioned; post-movement reconcile `{ debit:"100", credit:"100", balanced:true, difference:"0" }`.
- Automated: `packages/database` vitest — 3 pure + 4 DB-gated tests (catalog, fail-safe, hashing, idempotency, currencies, roles/grants, admin). DB tests skip cleanly when `DATABASE_URL` is unset.

## Security considerations

- Bootstrap credentials come only from the environment (a secret manager in production); never committed,
  never logged. The password is bcrypt-hashed via the platform's own `hashPassword`.
- The seed touches only reference/configuration + the admin identity — **no money, no ledger history**.
- Point `DATABASE_URL` at a platform-owned database; never at another project's instance.

## Production deployment notes

Run order: **migrate → seed → boot**. Provision `BOOTSTRAP_ADMIN_*` from your secret store. Rotate the
bootstrap password by re-running the seed with a new `BOOTSTRAP_ADMIN_PASSWORD`. Deposits, withdrawals,
payment gateways, KYC and real-money game settlement are **out of scope** here (later phases).
