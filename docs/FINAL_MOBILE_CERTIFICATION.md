# Final Mobile Certification

Playwright device emulation against the **production build** (`next build` + `next start`) with the
real backend. Viewports: **375×812**, **390×844**, **412×915**.

---

## 1. Results

| Suite | 375×812 | 390×844 | 412×915 | Total |
|---|---|---|---|---|
| Responsible-gaming controls (new) | **5/5** | **5/5** | **5/5** | **15/15** |
| Reports & CSV export (2D.7) | **7/7** | **7/7** | **7/7** | **21/21** |
| Analytics dashboard (2D.6) | 5/5 | **5/5** | 5/5 | 15/15 |
| Phase 2C.17 P0 regressions | — | **4/4** | — | 4/4 |
| Phase 2D.1 notifications | — | **4/4** | — | 4/4 |
| Phase 2D.2 security UX | — | **5/5** | — | 5/5 |

Suites marked "—" were certified at all three viewports in their own phase and re-run at 390 here as
a regression check.

---

## 2. What was verified on the new surfaces

### 2.1 Responsible-gaming controls

| Check | Result |
|---|---|
| Controls render and are **server-backed** (a `/responsible-gaming` request is observed) | pass |
| No horizontal overflow at any viewport | pass |
| Every control ≥ 44 px and not clipped (`rg-type`, `rg-period`, `rg-amount`, `rg-save-limit`, `rg-cooloff-days`, `rg-cooloff`) | pass |
| **A limit set in the UI survives a reload** — proving it is server state, not client state | pass |
| Real usage (`Used` / `Remaining`) rendered from the server | pass |
| Self-exclusion requires **explicit confirmation**, states it is indefinite, and states withdrawals stay open | pass |
| Confirm button ≥ 44 px | pass |
| The page no longer claims these controls are unavailable | pass |
| Session-time limits are **still** honestly marked unavailable | pass |

The persistence test is the important one: a client-only limit would vanish on reload. It does not.

### 2.2 Reports & CSV export

| Check | Result |
|---|---|
| Server-built report renders; metadata envelope shown with UTC basis | pass |
| All six report types render with no page-level sideways scroll | pass |
| Wide tables scroll **inside their own container**, never the page | pass |
| Filters and the export control ≥ 44 px and reachable | pass |
| **Export downloads a real CSV through an authenticated request** (download event captured; filename has no separator or `..`) | pass |
| Non-admin refused, with no admin chrome painted | pass |
| The Phase 2D.6 admin-shell `min-w-0` fix is **not regressed** on `/admin/analytics` and `/admin/reports` | pass |

---

## 3. The shared admin-shell fix is protected

Phase 2D.6 found that the admin shell's flex column lacked `min-w-0`, so any admin page with wide
content dragged the **whole page** sideways (measured 594 px against a 390 px viewport). That fix is
now guarded by an explicit assertion in the 2D.7 mobile suite, which reads the computed style of the
shell column and fails if `min-width` is not `0px`, plus a frontend unit test asserting the class is
present in `app/admin/layout.tsx`.

---

## 4. Notes on flakiness

Two mobile runs failed during this session and were investigated rather than retried blindly:

| Observation | Cause | Resolution |
|---|---|---|
| `p2d1-notifications` 2 failures, run took 1.6 min | **Login throttle** (`@Throttle({limit:10, ttl:60_000})` on `/auth/login`) exhausted by back-to-back suites | Waited the window out; re-ran — passed. Throttle **never** weakened |
| `rg-controls` at 412: 2 failures, run took 1.1 min | Same | Waited; re-ran — **5/5** |

A third case was a genuine data-state skip: `p2d1`'s mark-read test skips when the account has
nothing unread. Rather than accept a skip, real unread notifications were generated through a genuine
cashier action, and the suite then ran **4/4 with no skip**.

---

## 5. Limitations

- **MC-L1 — Device emulation, not physical handsets.** Playwright emulation is not the same as a real
  phone (touch latency, real keyboards, OS chrome, safe-area insets on notched devices).
  **NOT VERIFIED** on physical hardware.
- **MC-L2 — HTTP only.** No HTTPS/TLS run (environment limitation, unchanged since 2C.15).
- **MC-L3 — No operator RG screen** exists to certify; the admin RG surface is API-only.
- **MC-L4 — Not every player route** was re-certified this session; only the surfaces built or
  changed here, plus the prior-phase regression suites listed in §1.
