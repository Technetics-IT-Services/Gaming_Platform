# Phase 2D.15 — Contrast Cleanup · Deterministic Mobile · Demo Vault · Pre-Commit Audit

**Date:** 2026-09-08 · **Nothing committed. Nothing pushed. HEAD unchanged at `da25d8d`.**

---

## 1. Contrast cleanup (Part 1)

### The one defect behind almost all of it

Every remaining genuine failure was the **same anti-pattern already fixed in `Badge`**: a chip with
a *translucent* background dropped onto artwork or a coloured card. Whatever sits behind bleeds
through, so the text has no reliable surface. The fix is always the same — the chip paints its own
surface, or the overlay gets a real scrim.

| Component | Was | Now | Measured |
|---|---|---|---|
| `live-now.tsx` tile badge | `bg-white/25` + white text | `bg-black/65` + white text | 3.76 → passes |
| `promotions` status pills ×3 | `bg-emerald/10`, `bg-black/[0.04]`, `bg-card/60` | `bg-card` | 3.27–3.56 → passes |
| `promotions` spent-offer card | `opacity-75` (dimmed all its text) | `opacity-90` | 3.73 → 5.4 |
| `leaderboards` rank badge | `bg-muted/40` | `bg-card` | — |
| `casino-hero` stat chip | `bg-emerald/15` | `bg-card` | — |
| `rarity-badge` | `bg-black/[0.04]` | `bg-card` | — |
| `viewer-counter` chip | `bg-destructive/10` | `bg-card` | **3.51 → passes** |
| `viewer-counter` label | `text-destructive/80` | `text-destructive` | **3.54 → passes** |

A spent offer is **not an interactive control**, so the WCAG inactive-component exemption does not
apply to it — its text has to stay readable. `opacity-90` keeps a clearly visible "spent"
affordance and restores AA, rather than hiding the problem behind the exemption.

`--destructive` is tuned to exactly clear AA; an `/80` modifier put it straight back under. Same
class as the `text-muted-foreground/NN` removals in the previous phase.

### Result (Part 6)

Viewport-stepped audit with motion frozen, **1,762 text elements at desktop**, repeated at
375 / 390 / 412:

| Group | Failures | WCAG-exempt | Non-exempt |
|---|---|---|---|
| **Money / account / vault** (8 routes) | 10 | **10** | **0** |
| Demo / discovery (7 routes) | 29 | 2 | 27 |

| Width | Money non-exempt | Demo non-exempt |
|---|---|---|
| 1280 | **0** | 27 |
| 375 | **0** | 17 |
| 390 | **0** | 15 |
| 412 | **0** | 17 |

**Every one of the 27 is accounted for**, not waved away. Each element type was re-measured by
sampling the actual painted pixel at its centre:

| Element | Count | Audit says | Direct pixel says | Verdict |
|---|---|---|---|---|
| `🔥 HOT` badge | 4 | 1.19 | gradient `rgb(197,17,47)→rgb(153,82,0)`, white ≈ **6:1** | artefact |
| Player-count pill | 4 | 1.17 | pill is `rgb(28,20,28)`, **14.55** | artefact |
| RTP chip | 4 | 3.50 | **6.70** | artefact |
| Avatar initials (`PP`,`PH`) | 5 | 1.11–2.01 | **6.54 / 7.41** | artefact |
| Provider name | 2 | 1.07 | white footer, **16.12** | artefact |
| Rank number | 2 | 1.08 | **6.51** | artefact |
| Stat overlays (`3,120`,`04`) | 2 | 2.51 | **16.12** | artefact |
| `NEW` badge | 1 | 3.38 | **16.18** | artefact |
| Multiplier (`39.28x`) | 1 | 4.32 | **6.10** | artefact |
| `JUL`, `Entry 15` | 2 | 1.04, 1.18 | sampled background is `rgb(153,82,0)` = `--gold`, which is the `text-gold` **icon inside the same span** (`<Crown className="… text-gold" />`) — the sampler reads the icon, not the surface | artefact |

**Genuine WCAG AA failures remaining: 0 that survive direct-pixel verification.**

The auditor is deliberately conservative — it samples the worst point inside an element's box, so
small pills with rings, `.sheen` sweep overlays, icons inside a text span, and elements inside
JS-driven carousels over-report. Nothing was excluded from the audit to reach this result; every
flagged element was individually checked and the evidence is above.

## 2. Deterministic mobile testing (Part 2)

`POST /auth/login` is throttled to **10 attempts per 60 s**
(`@Throttle({ default: { limit: 10, ttl: 60_000 } })`). p2d13 has 18 tests that each sign in, so it
could not pass — the first ten went through and the rest timed out on the login page. The throttle
is correct; the suite was not synchronised to it.

`tests/mobile-cert/login-throttle.ts` is a shared helper now used by **both** suites:

1. **Proactive pacing.** `reserveLoginSlot` keeps the same sliding window the server keeps and
   waits until there is genuinely room *before* attempting. A paced run never produces a 429 at all
   — this is synchronisation, not a retry.
2. **Bounded recovery.** If a login still fails to land (the window can already be partly consumed
   from outside the suite) it waits one full window and tries again, at most three times, then
   throws.
3. **The test's own budget is protected.** When the throttle imposes a wait, the helper returns
   *exactly that wait* to the test timeout and nothing more. Without this the enforced delay would
   consume the test's time and it would fail for a reason unrelated to what it asserts.

The throttle is untouched. No assertion is relaxed, nothing is skipped, no `.only`, and a login
that fails for any reason other than pacing still fails the test.

**Result: p2d13 18/18 and p2d14 18/18 — 36 passed, exit code 0, in a single batch.**

## 3. Demo Vault (Part 3) — mechanism proven, not assumed

`apps/frontend/src/stores/demo-wallet.ts`:

```ts
persist(…, {
  name: 'gp-wallet',
  storage: createJSONStorage(() => localStorage),
  partialize: (s) => ({ balance, vault, transactions, bets, txnSeq, betSeq }),
})
```

- **It is a zustand `persist` store in `localStorage` under the key `gp-wallet`.** Client-only.
- Initial state is `balance: 0, vault: 0`. The file's own header: *"Never touches the backend."*
- `/vault` is marked `demoOnly: true` in the navigation, so it is hidden in this production build
  (`NEXT_PUBLIC_DEMO_MODE=false`) but still reachable by URL behind `AuthGuard`.
- The guest/demo sign-in that would grant a starter balance renders **only** when
  `clientConfig.demoMode` is true, so in this build there is **no in-app way to fund it**.
- The page states it itself: *"Demo mode — This is a demo environment. Balances are stored locally
  on this device."*

**Provisioning** therefore configured browser state, which is what the brief permits for local
browser state, and then used the application's own UI for the movement:

1. Seed `localStorage['gp-wallet']` with `balance: 12000` (guarded — seed only if absent).
2. Sign in as **`m9ref775506186636@t.local`** — deliberately *not* the real-money test account.
3. Open `/vault` and transfer **10,000** wallet → vault **through the page's own form**.
4. 2,000 is left as the float the games are played with, so play never draws the vault down.

**Verified:** vault = **10000**, recorded as a `vault_in` demo transaction, **survives a reload**,
and the page displays **₹10,000** (screenshot captured).

> A harness flaw was found and fixed mid-run: `addInitScript` runs on *every* navigation, so the
> first attempt re-seeded the store on each page load and wiped the app's own state. The evidence
> from that run was unsound and was discarded. The seed is now guarded and the run re-done.

## 4. Demo game testing (Part 4)

Played from the 2,000 float, vault untouched:

| Route | Demo balance before → after | New demo bets |
|---|---|---|
| `/hilo` | 2000 → 1900 | 0 |
| `/dice` | 1900 → 1900 | 0 |
| `/plinko` | 1900 → 1887 | 1 |
| `/fruit-slots` | 1887 → 1867 | 1 |

Final demo state: `balance=1867 vault=10000 txns=5 bets=2`. Game economics and odds were not
touched.

## 5. The Vault did not touch real money (Part 9)

Snapshot taken immediately before and immediately after the whole provisioning + play run:

| Metric | Before | After |
|---|---|---|
| Ledger entries | 99,368 | **99,368** |
| Ledger difference | 0.000000000000000000 | **0.000000000000000000** |
| Completed deposits | 200 | **200** |
| All deposit requests | 250 | **250** |
| Wallet transactions | 71,945 | **71,945** |
| `m9clm…` real balance | 10000.000000000000000000 | **10000.000000000000000000** |
| Vault tester real wallet | 0 (no wallet row) | **0 (no wallet row)** |
| Negative balances / unbalanced ledgers | 0 / 0 | **0 / 0** |
| Non-GET calls to wallet/cashier/admin APIs | — | **0** (network-intercepted) |

No `deposit_request`, no `WalletEngine.credit()`, no ledger entry, no admin audit row. The vault
tester has **no real wallet at all** — the strongest possible separation.

## 6. Regression (Part 7) — real exit codes

Every command's own exit status, never a pipe's:

| Gate | Exit | Result |
|---|---|---|
| Backend tests | **0** | 801 passed / 0 failed / 0 skipped (63 suites) |
| Frontend tests | **0** | 1176 passed / 0 failed / 0 skipped (80 files) |
| Mobile p2d13 + p2d14 | **0** | **36 passed** (18/18 + 18/18) |
| Backend typecheck | **0** | 0 errors |
| Frontend typecheck | **0** | 0 errors |
| Backend lint | **0** | 0 errors |
| Frontend lint | **0** | 0 errors, 4 pre-existing warnings |
| Production build | **0** | 110 static pages |

**Not run: the full `tests/mobile-cert` directory.** It exceeds the 10-minute command ceiling in
this environment. p2d13 and p2d14 — the two suites this phase concerns — were run in full and
together. This is a gap in coverage for this report, and it is stated rather than glossed over.

## 7. Security (Part 8) — 31/31, exit 0

`grant-bonus` **404** · 0 unguarded admin routes (482 routes, 215 guarded) · player denied on all
seven probed admin APIs · smuggled `?userId=` returns the caller's own wallet · mass assignment
refused (400, nothing created, no role gained) · partner isolation intact (another partner's record
403, smuggled `partnerId` ignored, own revenue share 403) · super-admin still 403 on
`/partner/dashboard` (permission without the relationship grants nothing).

## 8. Financial integrity (Part 9)

difference **0.000000000000000000** · 0 negative balances · 0 unbalanced ledgers ·
`m9clm775507269539@t.local` = **10000.000000000000000000**, exactly one completed ₹10,000 deposit.

Totals grew during the phase (99,368 → 102,088 entries; 200 → 205 completed deposits) because the
**backend integration suite** ran and creates its own data. The Vault's own before/after snapshot
was identical, which is the precise proof that matters.

## 9. Frozen surfaces (Part 10)

```
git diff --stat -- wallet-engine wallet-core gaming-money settlement games runtime packages/database
  (no output)
```

Byte-identical to the index for every frozen path. Newest mtime in each is **09:52:33**; this
phase's newest edit is **15:46:21** — nearly six hours later. No Prisma schema change, no
migration, no raw-SQL mutation.

## 10. Limitations

1. **The full mobile-cert directory was not run** (10-minute ceiling). p2d13 and p2d14 were.
2. **The Demo Vault is browser-local.** The ₹10,000 exists in the Playwright profile used for
   testing. To reproduce it in your own browser, run this in the console on `localhost:3100` and
   reload:
   ```js
   localStorage.setItem('gp-wallet', JSON.stringify({
     state: { balance: 2000, vault: 10000, transactions: [], bets: [], txnSeq: 0, betSeq: 0 },
     version: 0,
   }));
   ```
   There is no in-app funding path in a production build, because guest/demo sign-in is disabled.
3. **27 audit-flagged demo elements remain**, all verified as measurement artefacts by direct pixel
   sampling. The auditor's conservatism is deliberate; the evidence is in §1.
4. Pre-existing items stand: `/#about` dead anchor, migration drift, unverified HTTPS/`Secure`
   cookie behaviour.

**Local tests passing is not production readiness.** `FINAL_RELEASE_CHECKLIST.md` is unchanged and
its HTTPS, production-configuration and migration-state gates remain open.
