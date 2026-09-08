# Phase 2D.8 — Implementation

## 1. AD-09 Platform settings (RED → GREEN)

### The safety design, which drove everything else

`ApplicationSetting` is the live store for **real-money game variant configuration**
(`dice-variant`, `crash-variant`, `roulette-variant`, `card-variant`) plus alerts, missions, seasons
and tournaments — 37 call sites. Generic CRUD over it would have handed an operator a UI that edits
game odds. **It is not exposed at all.**

Settings use **`SystemSetting`** (previously zero writers) behind a **hard-coded allow-list
registry** in `settings.registry.ts`. The registry is consulted **before any database access**, so an
unknown key is rejected rather than filtered out afterwards.

**Deliberately absent from the registry, each with a stated reason:** wallet/payout/financial limits ·
game odds and variant config · settlement logic · `RG_LIMIT_INCREASE_DELAY_HOURS` (responsible-gaming
enforcement) · `SESSION_IDLE_TIMEOUT_MINUTES` (security control) ·
`CASHIER_LARGE_WITHDRAWAL_THRESHOLD` (money-affecting **and** an open client decision).

### What IS exposed

Five strictly non-money keys, each with type, validation, bounds, default, description, write
permission, public flag and restart flag:

`platform.support_email` · `platform.support_phone` · `platform.maintenance_banner_enabled` ·
`platform.maintenance_banner_message` · `platform.support_response_hours`

The maintenance banner is **display only** — it does not stop play, deposits or withdrawals, and the
description says so.

### API

`GET /settings/public` (unauthenticated, registry-filtered) · `GET /admin/settings` ·
`GET /admin/settings/:key` · `POST /admin/settings/:key` · `POST /admin/settings/:key/reset`

Read needs `settings:read` (admin); write needs `settings:write` (**super-admin only**). The service
re-checks the per-setting `writePermission` as well, so a future route cannot bypass a stricter
per-key rule.

### Frontend

- `app/admin/settings/page.tsx` — replaced a 22-line placeholder. Renders whatever the server allows;
  **hardcodes no key at all** (asserted by test). Includes an explicit "Not editable here, by design"
  panel naming what it cannot change and why.
- `app/(dashboard)/support/page.tsx` — now consumes the **real** public settings for contact details
  and the maintenance banner, with the build-time env vars kept only as a fallback. This makes the
  setting genuinely end-to-end rather than write-only.
- `lib/settings-api.ts` — typed client.

### Properties proven

| Property | Evidence |
|---|---|
| Allow-list is the boundary | 8 live probes (4 game variants + RG + session + threshold + arbitrary) all **400**, with **no stray row written** |
| `ApplicationSetting` untouched | live count unchanged; integration test asserts it |
| Validation never silently coerces | out-of-range int, non-boolean, over-length string all 400; stored value unchanged after each |
| Public subset cannot leak | filtered from the REGISTRY, not the DB — a planted non-allow-listed row with `isPublic: true` stays invisible |
| Settings always resolve | a key with no row returns its registry default; `isCustomised` distinguishes the two |
| Audited | before/after recorded; safe because no secret is on the allow-list |
| No money | ledger totals **and entry count** unchanged across all settings activity |

## 2. A correction to my own matrix

The RED row read **"8"** while listing **10** IDs. Corrected to 10 before starting, so the baseline
was honest: **GREEN 24 · AMBER 10 · RED 10 · BLOCKED 11**.

## 3. Not implemented, and why

| Req | Class | Reason |
|---|---|---|
| P-17 referral | A (attribution) / C (reward) | Attribution is implementable and was scoped, but the phase budget went to completing AD-09 as a full vertical slice rather than starting a second partial one. Reward remains BLOCKED: no qualifying-deposit threshold is defined |
| AD-08 promotions | A (CRUD) / C (awarding) | CRUD implementable; awarding has no defined monetary rule |
| P-14 / P-15 / P-16 | **C** | Require inventing VIP tier thresholds, per-tier reward values, daily-login amounts and spin prize tables — all client business decisions |
| F-05 daily settlement | **C** | Settles net profit, which needs the revenue definition |
| PA-07 partner reports | **B** | Depends on partner financials (BLOCKED) |
| X-02 event pipeline | A but L-effort | Too large for the remaining window |

## 4. Frozen surfaces

Untouched. Settings write only to `SystemSetting`. **No `FROZEN_CHANGE_PROPOSAL` needed.**
