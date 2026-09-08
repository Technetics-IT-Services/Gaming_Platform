# Phase 2D.8 — Security Tests

**35 live HTTP checks, 0 failed**, plus 17 DB-backed integration tests.

## 1. Authorization

| Principal | `GET /admin/settings` | write |
|---|---|---|
| Unauthenticated | **401** | **401** |
| Player | **403** | **403** |
| Moderator | **403** | **403** |
| Admin (`settings:read`) | 200 | refused (no `settings:write`) |
| Super-admin | 200 | 200 |

Defence in depth: the controller guard checks `settings:write`, **and** the service re-checks the
per-setting `writePermission`, so a future route cannot bypass a stricter per-key rule.

## 2. The allow-list is the security boundary

| Attempted key | Category | Result |
|---|---|---|
| `dice-variant`, `crash-variant`, `roulette-variant`, `card-variant` | **real-money game config** | **400** ×4 |
| `RG_LIMIT_INCREASE_DELAY_HOURS` | responsible-gaming enforcement | **400** |
| `SESSION_IDLE_TIMEOUT_MINUTES` | session security | **400** |
| `CASHIER_LARGE_WITHDRAWAL_THRESHOLD` | money + open client decision | **400** |
| `anything.at.all` | unknown | **400** |

**`application_settings` row count unchanged** after every attempt, and **no stray `system_settings`
row was created** — the rejection happens before any database access.

## 3. Validation and mass assignment

- integer out of range → 400 · non-boolean for a boolean → 400 · over-length string → 400
- **after each rejection the stored value was unchanged** (no partial write)
- extra body fields (`isPublic`, `type`) → **400** (`forbidNonWhitelisted`)
- the client sends **only** `value`; key comes from the URL and is allow-list checked

## 4. Information exposure

- The public endpoint filters from the **registry**, not the database. A planted
  `system_settings` row for a non-allow-listed key with `isPublic: true` stayed invisible.
- No key matching `secret|password|token|credential|key$` is public.
- Audit records before/after values — safe precisely because no secret is on the allow-list.

## 5. Financial safety

Ledger debit total **and entry count** identical before and after all settings activity
(`17528257.499999999999998000|45128` → unchanged). Zero negative balances.

## 6. Limitations

- **SA-L1** — HTTP only; HTTPS/TLS still unexercised (environment, unchanged since 2C.15).
- **SA-L2** — No rate limit specific to settings writes; the global throttler applies.
- **SA-L3** — Settings are not versioned; the audit trail is the history.
