# Phase 2D.6 — Final Report

**Derivable analytics & operational reporting.**

Companions: [PHASE_2D6_AUDIT.md](PHASE_2D6_AUDIT.md),
[PHASE_2D6_IMPLEMENTATION.md](PHASE_2D6_IMPLEMENTATION.md),
[PHASE_2D6_ANALYTICS_DEFINITIONS.md](PHASE_2D6_ANALYTICS_DEFINITIONS.md),
[PHASE_2D6_SECURITY_TESTS.md](PHASE_2D6_SECURITY_TESTS.md).

---

## 1. Verdict

**GO for the analytics surface, with the limitations in §6 stated openly.**

`GET /analytics/summary` returned **`501 Not Implemented`** at the start of this phase and
`/admin/analytics` was a 24-line placeholder. Both are now real: every figure on the dashboard is
derived from an authoritative table and was verified against the database directly.

**This does not make the platform's analytics requirement complete.** Roughly **half** of what was
asked for is genuinely unbuildable from the data this platform persists, and it is declared
unavailable rather than approximated. See §5.

---

## 2. What was verified, and how

| Check | Result |
|---|---|
| **API output vs direct SQL** | **26 of 26 matched, 0 mismatched.** Every gaming, financial, user, operations and daily-series figure was recomputed with an independent SQL query against the live database and compared to the API response. |
| **Backend unit tests** | 280 passed (36 suites); includes 35 new analytics tests. |
| **Analytics integration (real Postgres)** | **14 of 14 passed**, run with `--runInBand`. |
| **Frontend unit tests** | **852 passed** (66 files); includes 18 new analytics tests. |
| **Security / attack tests** | **18 of 18 passed, 0 failed** — see [PHASE_2D6_SECURITY_TESTS.md](PHASE_2D6_SECURITY_TESTS.md). `users` table intact after injection attempts. |
| **Mobile certification** | **15 of 15 passed** — 5 tests × 375×812, 390×844, 412×915. |
| **Prior-phase mobile regression** | `p2c17` 4/4, `p2d1-notifications` 4/4, `p2d2-security` 5/5 — all at 390×844, after the shared admin-shell change. |
| **Lint** | Backend **0 errors, 0 warnings**. Frontend **0 errors**, 3 pre-existing warnings (in `wallet-history` files, none in analytics). |
| **Production builds** | Backend and frontend both build; frontend generates 93/93 static pages. |
| **Financial regression** | `/admin/wallet/reconcile` → `balanced: true, difference: "0"` (debit `9,544,233.0999…` = credit). **Zero** wallet balances negative across `available`, `locked`, `pending`, `total`. |
| **Analytics is READ-ONLY** | Proven twice: a unit test asserts the Prisma mock exposes no write methods and no `wallet`/`ledger`/`ledgerEntry` models; an integration test snapshots ledger totals, a real balance, and transaction/round counts before and after running **every** analytics query and asserts `expect(after).toEqual(before)`. |

---

## 3. Honesty guarantees — the point of this phase

| Guarantee | How it is enforced |
|---|---|
| **No fabricated metric.** DAU, MAU, retention, LTV, session time, bounce rate, revenue, expenses, profit, partner profit, marketing conversion and FX-consolidated totals are **not computed**. | Returned in `meta.unavailable` on every response, each with the specific missing source. |
| **A missing value is never a zero.** | `payoutToStakeRatio` and `depositConversionRate` return `null` when undefined; the dashboard renders **"Not available"**, never `0`. |
| **Currencies are never combined.** | `exchange_rates` is empty and nothing writes it. Every amount is a per-currency bucket. No summing across currencies exists anywhere in the code. |
| **An unknown filter empties the result rather than being ignored.** | An unrecognised currency code resolves to a sentinel UUID matching no row. `?currency=USDD` returns empty — never platform totals mislabelled as USDD. |
| **Game-level ≠ ledger-level.** | `game_rounds` (one row per round) and `wallet_transactions` (one row per movement) are reported separately and labelled as such in the UI. The measured difference is explained in the audit, not hidden. |
| **A range is rejected, never silently clamped.** | > 366 days, `from > to`, future `from` and malformed dates all return `400`. |
| **No per-user data leaves the service.** | Distinct-user counts compute ids internally and return only the count. Tests assert `"userId"` and `"email"` appear nowhere in a response. |

---

## 4. A real defect found and fixed in the shared admin shell

Mobile certification failed at 390 px with the **page itself** scrolling sideways (594 px against a
390 px viewport). Rather than adjust the test or nudge styles until it passed, the overflow was
attributed by measurement — applying `min-width: 0` to each candidate ancestor one at a time and
re-measuring:

```
[data-testid="admin-analytics"]  (my page root)   594 → 594   no effect
main.flex-1 px-4 py-6            (shell)          594 → 594   no effect
div.flex min-h-screen flex-1 flex-col (shell)     594 → 390   FIXES IT
```

The cause was **pre-existing**, in `app/admin/layout.tsx`, not in the new page: the shell column is a
flex item, so its default `min-width: auto` sized it to its widest content. Any admin page with
content wider than the viewport would have dragged the whole page sideways. It had never surfaced
because no existing admin page had wide content (`/admin` and `/admin/games` both measured 390/390).

Fixed with `min-w-0` on that column. This benefits every admin page. The three prior-phase mobile
suites were re-run afterwards and all pass.

---

## 5. Coverage — stated honestly, not inflated

The brief said: *do not claim 100%, do not inflate coverage, do not hide limitations.*

Against the client's analytics requirement as catalogued in
[PHASE_2C18_GAP_MATRIX.md §G](PHASE_2C18_GAP_MATRIX.md):

| Requirement group | Before 2D.6 | After 2D.6 |
|---|---|---|
| Revenue-style volume, average bet, most-played games, average deposit/withdrawal, conversion | **RED (buildable)** | **Delivered** — under accurate names. "Revenue" specifically is **not** delivered: it is declared unavailable because no accounting definition exists. Stake volume and ledger volume are delivered instead. |
| DAU, MAU, retention, LTV, session time, bounce rate, cohorts | **BLOCKED** | **Still BLOCKED.** No activity-event pipeline exists; `page_views`, `player_sessions`, `user_activities` are all empty. Nothing was invented. |
| Reports (export) | **RED** | **Not delivered.** No CSV/PDF export was built — it was not in this phase's scope and is not claimed. |
| Operational reporting (settlement queue, audit, security, notifications) | not catalogued | **Delivered.** |

**Honest summary: of the 12 headline business metrics the brief named, 0 are fabricated, and 12 are
explicitly declared unavailable with a named missing source.** What *is* delivered is 30+ metrics
that are truthfully derivable, each defined and verified. The correct characterisation is:

> **The analytics that this platform's data can support are now built, verified and honest. The
> analytics that require an event pipeline, an accounting model, a partner entity or an FX source
> are still not possible, and are labelled as such on screen rather than estimated.**

---

## 6. Known limitations (carried forward, not resolved)

- **L1 — No caching or pre-aggregation.** Every request aggregates live against `game_rounds`
  (6,048 rows here) and `wallet_transactions`. The 366-day cap is the only bound. At production
  volume this needs materialised aggregates. **Untested under load.**
- **L2 — Cashier data is windowed on creation time**, not completion time.
- **L3 — `auditRecords` counts `audit_trails` only.** A second store, `admin_audit_logs`, is not
  included, so the figure is a **lower bound**, not a total.
- **L4 — Win/loss/tie is derived from the money outcome**, not from a stored flag.
- **L5 — Averages are arithmetic means.** No medians or percentiles.
- **L6 — `payoutToStakeRatio` is realised, not theoretical.** It must not be published as certified RTP.
- **L7 — Point-in-time metrics ignore the date filter** by design (`registered`, `emailVerified`,
  `pendingSettlements`, `recoveryFailed`, `recovering`).
- **L8 — No per-user drill-down**, by design.
- **L9 — No export.** No CSV, PDF, or scheduled report.
- **L10 — The orphaned `src/lib/analytics/` (1,650 LOC) is still dead code.** It was deliberately not
  wired up — it is client-side simulation, and connecting it would have put fabricated numbers on an
  operator dashboard.
- **L11 — HTTPS/TLS was not exercised.** Testing was over HTTP against the local disposable stack —
  the same environment limitation recorded in Phase 2C.15.
- **L12 — No physical-device testing.** Mobile certification is Playwright device emulation at three
  viewports, which is not the same as a real handset.

---

## 7. Constraints honoured

- **No frozen module was touched.** WalletEngine, wallet-core, ledger, settlement, GameMoneyBridge,
  the game engines, the provably-fair engines, the runtime and the game registry are unmodified.
- **No schema change and no migration.** Analytics reads existing tables only.
- **No test was weakened, skipped or disabled.** The login throttle was waited out between runs, never
  raised. Two tests that had been skipping for want of credentials (`p2d6` RBAC, `p2d1` notifications)
  were made to **actually run** by creating a real player account and generating real notifications
  through a genuine cashier action.
- **No authentication, RBAC or throttling was weakened.** Analytics sits behind the existing guard
  chain with `analytics:read`.
- **Nothing was committed**, as instructed.

## 8. Files changed

**Backend** — `analytics.service.ts` (rewritten), `analytics.controller.ts` (rewritten),
`dto/analytics-query.dto.ts` (new), `analytics.service.spec.ts` (new),
`analytics.integration.spec.ts` (new), `auth/services/session-idle.spec.ts` (lint-only: `require()` → static import).

**Frontend** — `app/admin/analytics/page.tsx` (rewritten), `lib/analytics-api.ts` (new),
`lib/analytics-api.test.ts` (new), `lib/api-client.ts` (added `/analytics` to `DEMO_BLOCKED_PATHS`),
`app/admin/layout.tsx` (`min-w-0` shell fix), `tests/mobile-cert/p2d6-analytics.spec.ts` (new).

**Docs** — `PHASE_2D6_AUDIT.md`, `PHASE_2D6_IMPLEMENTATION.md`,
`PHASE_2D6_ANALYTICS_DEFINITIONS.md`, `PHASE_2D6_SECURITY_TESTS.md`, `PHASE_2D6_FINAL_REPORT.md`.

**STOP — Phase 2D.6 is complete. No further phase was started.**
