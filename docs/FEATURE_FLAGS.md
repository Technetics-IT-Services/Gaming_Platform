# Feature Flags (Phase 3.1, STEP 7)

Module: `feature-flags.ts`. `FeatureFlagService` resolves a flag for a tenant/operator through a strict
precedence chain. Deterministic — percentage rollout uses a stable hash of `(flag, tenantId)`, no RNG.

## Precedence (highest → lowest)

```
1. Emergency Kill Switch   → OFF for everyone (overrides all)
2. Tenant override         → tenant.features[flag]
3. Operator allow-list     → force ON for listed operators
4. Percentage rollout      → ON if hash(flag,tenantId) % 100 < rolloutPercentage
5. Plan flag               → rule.plans[plan]  (else PLAN_FEATURES default)
6. Global default          → rule.default ?? false
```

## Defining & evaluating

```ts
const flags = new FeatureFlagService();
flags.define('poker.enabled', {
  default: false,
  plans: { [TenantPlan.Enterprise]: true },
  operatorAllowList: ['op-vip'],
  rolloutPercentage: 25,
});

flags.isEnabled('poker.enabled', { tenantId, plan, operatorId, tenantOverride });
flags.setKillSwitch('poker.enabled', true);      // emergency off
flags.resolveAll({ tenantId, operatorId, plan }, tenant.features); // → flat map for the context
```

`resolveAll` produces the `featureFlags` map baked into every `TenantContext`; read it with
`contextFlag(ctx, 'poker.enabled')`.

## Plan defaults (`PLAN_FEATURES`)

| Flag | Starter | Growth | Enterprise / Custom |
|---|:--:|:--:|:--:|
| `poker.enabled` | ✗ | ✓ | ✓ |
| `lottery.enabled` | ✓ | ✓ | ✓ |
| `sportsbook.enabled` | ✗ | ✓ | ✓ |
| `ai.enabled` | ✗ | ✗ | ✓ |
| `marketplace.enabled` | ✗ | ✗ | ✓ |
| `slots.enabled` / `table-games.enabled` / `instant-games.enabled` | ✓ | ✓ | ✓ |

## Examples in play

- **Poker/Lottery/Sportsbook enabled** per plan; a Growth tenant gets poker, a Starter tenant does not.
- **AI / Marketplace enabled** only on Enterprise, or via a per-tenant override / gradual rollout.
- **Percentage rollout** is stable: the same tenant always lands in the same bucket, so a 25% rollout is
  reproducible across requests and restarts.
- **Kill switch** instantly disables a flag platform-wide (incident response) regardless of any override.

Feature flags gate **capabilities only** — they never alter game mathematics, settlement or any frozen
financial rule.
