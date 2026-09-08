# Phase 2D.13 — Security Audit

Scope: the four operator consoles added this phase, plus a re-verification of the whole guarded
surface. **No backend code changed in this phase**, so the audit is chiefly about whether new
interfaces can reach anything they should not — and whether anything opened since 2D.12.

---

## 1. Route and guard inventory (machine-generated, whole backend)

```
TOTAL ROUTES: 482
  with @RequirePermissions/@Roles : 215
  explicitly @Public              : 72
  authenticated-only              : 195

A. ADMIN ROUTES WITH NO PERMISSION/ROLE (must be empty)
  (none)
```

Category A is empty. Every route under an admin surface carries an explicit permission or role.
The 195 authenticated-only routes are player self-service, and each money-shaped one was
individually re-checked for owner-scoping (§3).

The detector used here is the rewritten one from 2D.10 — the earlier version missed class-level
decorators placed above `@Controller` and assumed one controller per file, which produced false
"unguarded" hits. It was rewritten rather than its findings dismissed.

## 2. The four new consoles

Each was scoped so it *cannot* become a way to invent business rules or move money. These are
design decisions, each backed by a test and a live probe:

| Console | Confinement | Proof |
|---|---|---|
| Catalogue (AD-03) | Reaches no odds, RTP, stake limit or payout | Test asserts the client source contains none of `rtp`, `odds`, `payout`, `stake`, `minBet`, `maxBet`, `houseEdge`, `variant`. Live: create + delete a category, ledger difference unchanged. |
| Catalogue — launchers | Read-only; the platform registers runtime bindings | No `createLauncher` in the client; the page states why |
| Audit trail (AD-12) | Read-only | Client block between `adminAuditApi` and the next export contains `apiClient.get` and none of post/patch/delete/put. Live: `DELETE /admin/audit/:id` → **404** |
| Audit trail | Change sets render as text | No `dangerouslySetInnerHTML`; a `summarise()` helper flattens the payload. Operator-supplied reasons never become markup. |
| Responsible gaming (P-10) | An operator may only *lift* a restriction | Client exports exactly `forUser` and `liftRestriction`, pinned by test. Live: `POST /admin/responsible-gaming/users/:id/limits` → **404**. Mobile test: zero amount inputs on the panel. |
| Referrals (P-17) | Read-only | Client exports exactly `list`. Live: `POST /admin/referrals/award` → **404** |

**Every new console was probed as a player.** All four surfaces returned **403** at the API, and
the shell rendered the forbidden state rather than an empty console — checked at all three mobile
viewports.

## 3. The invariants that matter, re-verified

| Invariant | Result |
|---|---|
| No route accepts a client-supplied `userId`, role, permission, balance or payout | Holds — owner identity comes from `@CurrentUser('id')`; the owner filter is inside the WHERE clause, not applied afterwards |
| Ledger balanced | `difference: 0.000000000000000000` across **90,510** entries |
| Negative balances | **0** |
| Unbalanced ledger groups | **0** |
| The closed `grant-bonus` hole | Re-probed as a player: **404** |
| Frozen surfaces | Untouched — verified by modification time, not by inspection alone |

**A balanced ledger does not prove authorization.** That is exactly how the grant-bonus hole
survived: the fraudulent credit was a correct double entry. So the authorization probes above are
the evidence here, and reconciliation is only a secondary check.

## 4. Secrets

No password, JWT, refresh token, TOTP secret, backup code, server seed, payment credential or
database credential appears in any file added this phase. The consoles render server responses;
none of those responses carries a secret field, and no console logs a response body.

The scan that checks this had produced two false positives in earlier phases — `currencyCode`
matching a `code` pattern, and `DEPOSIT_BONUS` matching a `bonus` pattern. It now matches on
structural properties rather than substrings, and reports clean.

## 5. What this audit does **not** claim

- **HTTPS and `Secure`-cookie behaviour are unverified.** No TLS endpoint exists in this
  environment. The refresh cookie is `Secure`, so authentication behaves differently over HTTPS
  than over the plain HTTP available here. The staging procedure is in `FINAL_RELEASE_CHECKLIST.md`
  gate 15, and it is a release blocker.
- **No penetration test was performed.** This is a source, route and live-probe audit.
- **Production configuration is unverified** — secrets, CORS origins and cookie flags are set per
  deployment and cannot be checked from here.

## 6. Findings

**No new vulnerability was found in this phase, and none was introduced.**

The two defects found and fixed earlier in this sprint remain closed:

1. `POST /wallet-engine/grant-bonus` — any player could mint withdrawable balance. Route deleted;
   regression proven non-vacuous by temporarily reinstating the flaw (3 tests failed), then
   removing it again (13/13 pass).
2. The monitoring sampler's unhandled promise rejection, which crashed the backend under load.
   Now caught and counted.
