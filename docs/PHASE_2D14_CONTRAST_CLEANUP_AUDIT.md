# Phase 2D.14 — Demo/Discovery Contrast Cleanup & Pre-Commit Audit

**Date:** 2026-09-08 · **Nothing committed. Nothing pushed. HEAD unchanged at `da25d8d`.**

---

## 1. The measurement had to be fixed before the UI could be

The prior pass reported 297 AA failures on the demo/discovery pages, 170 of them on `/games`. Those
numbers were **not trustworthy**, and acting on them would have damaged the design.

The auditor took one `fullPage` screenshot to get a background plate. Capturing full-page **scrolls
the document**, which triggers this app's lazy rails and `whileInView` reveals and changes layout
*after* element coordinates were read. The stored rectangles then pointed at empty page background,
so white-on-purple game tiles scored a uniform **1.05** against the page colour. A direct pixel
probe proved it: the live-players pill measures `rgb(28,20,28)` — nearly black — while the audit
insisted its background was `rgb(230,224,227)`.

The auditor was rebuilt to walk the page **one viewport at a time**: scroll, let reveals settle,
freeze CSS motion, hide glyphs, read coordinates and capture in the *same* rendered state, score
only what is on screen. Nothing is excluded — every text element is still scored exactly once, in
the state a user actually sees.

Three further corrections, each verified against a screenshot of the real page: sample the inner box
(rounded pills leave page background in the outer band), model cumulative element opacity, and avoid
the extreme percentile tails (they pick up a glow halo or a parked `.sheen` band and report a dark
purple gradient button as light lilac).

**On `/games` the same tool measured 170 → 72 before a single line changed.** That 98-failure
difference was measurement error, and it is reported as such rather than claimed as a fix.

## 2. Inventory — causes, not symptoms

With trustworthy numbers, every failure grouped into a small number of real causes:

| Cause | Where | Evidence |
|---|---|---|
| **Translucent chip over artwork** | `Badge` variants `new`/`neon`/`live` (`bg-emerald/15`), the RTP chip (`bg-white/80`) | The tile shows straight through, so the text has nothing to sit on — 1.36:1 on `/games` |
| **Light stop in a gradient carrying white text** | `--warning` in `Badge` `hot`/`jackpot`, avatar palettes, VIP tier plates, `bg-gradient-gold` | `--warning` is a *surface* token paired with a dark foreground; under white text it measured 2.24:1 |
| **Duplicated, occluded text** | `GameCover` painted the game name on the tile while the card footer painted it again | The tile copy sat behind the live-players pill and rendered as clipped fragments (`467 'ot`) |
| **Opacity-dimmed readable text** | 69 table cells and labels, plus 11 `text-muted-foreground/NN` | `#1b1f37` at 0.6 alpha over white measures **4.33** — just under AA |
| **Pale literal palettes** | lucky-wheel segments, Bronze/Silver metal plates | White labels on `#22d3ee`, `slate-100`, `amber-400` |
| **Measurement artefact** | small pills with rings, `.sheen` sweeps, JS-driven carousels | Verified individually by direct pixel sampling |
| **WCAG-exempt** | disabled paging, claim and submit buttons | WCAG 1.4.3 exempts inactive components |

## 3. What changed — shared tokens and components, not per-page patches

| Change | Scope |
|---|---|
| `Badge`: `neon`/`live`/`new` paint `bg-card` instead of a `/15` tint | one component, every tile in the app |
| `Badge`: `hot`/`jackpot` gradients no longer contain `--warning` | one component |
| `--warning` `36 94% 50%` → `30 90% 32%`, foreground → white | fixed **83** gradient stops at once |
| RTP chip `bg-white/80` → `bg-card` | `game-card.tsx` |
| `GameCover` title suppressed inside `game-card` (the footer already shows it) | removes duplicated, occluded text |
| 69 opacity-dimmed text declarations → explicit readable colours | 26 inline-styled screens |
| 11 `text-muted-foreground/NN` → `text-muted-foreground` | app-wide |
| Lucky-wheel: 8 segment colours darkened | one data table |
| Bronze/Silver plates: `amber-400`/`slate-100` → `amber-700`/`slate-500` | `vip.ts`, `cosmetics.ts`, hall of fame |

Hue and saturation — the brand — are untouched throughout; only lightness moved. No text shadows,
no `!important`, no element excluded from the audit.

## 4. Contrast: before → after

Same tool, same methodology, both columns:

| Surface group | Before | After | Genuine after |
|---|---|---|---|
| `/games` (apples-to-apples) | **72** | **11** | **0** |
| Money / account (11 routes, 512 elements) | 3 | **4** | **0** — all 4 are disabled controls |
| Admin + partner (12 routes, 2,909 elements) | 31 | **6** | **0** — all 6 are disabled controls |
| Demo / discovery (10 routes, 1,500 elements) | 72+ | **40** | ~18 |

**Total measured: 44 failures across 2,012 player-side text elements**, plus 6 on 2,909 admin
elements.

Classification of the 44:

| Class | Count | Basis |
|---|---|---|
| **WCAG-exempt** (disabled controls) | 6 | `disabled` attribute present |
| **Measurement artefact** | ~20 | Verified individually by direct pixel sampling — HOT badge `rgb(197,17,47)→rgb(153,82,0)` (≈6:1), player-count pill 14.55, RTP chip 6.70, NEW badge 16.18, avatar initials 6.54–7.41, rank numbers 6.51, card titles 16.12 |
| **Genuine, remaining** | ~18 | Single-instance demo chips: `● Live` (4.30, needs 4.5), `JUL` pink-on-gold, `Entry 15`, tournament counters (3.0–3.6), promo status pills (3.27–3.56) |

**Every genuine remaining failure is on a fictional demo/discovery surface.** Money, account,
cashier, admin and partner surfaces have **zero** genuine failures.

Mobile (money + `/games`): 375px **10**, 390px **8**, 412px **9** — money routes **0** at all three.

Numbers move a little between runs because these demo pages render deterministic-by-hash content and
horizontally-scrollable rails; the classification does not.

## 5. Regression

| Gate | Result |
|---|---|
| Backend | **801 passed / 0 failed / 0 skipped** (63 suites) — no backend file changed this phase |
| Frontend | **1176 passed / 0 failed / 0 skipped** (80 files, **+49** new) |
| Typecheck | backend **0 errors**, frontend **0 errors**, ui **0 errors** |
| Lint | backend 0 errors · frontend 0 errors (4 pre-existing warnings) · ui 0 errors |
| Production build | PASS — 110 static pages |
| Mobile `p2d14-light-theme` | **18 / 18** at 375/390/412 |
| Mobile `p2d13-oversight-consoles` | **16 / 18** in a single batch — see below |
| Reconciliation | difference **0**, 99,364 entries, 0 negative balances, 0 unbalanced ledgers |

**An earlier typecheck claim in this phase was wrong and is corrected here.** The command read the
exit code of `tail`, not of `tsc`; the frontend actually had 8 type errors in the new mobile spec.
They are fixed and the check is now genuine.

**`p2d13` mobile, honestly:** 16 of 18 in one batch, and every failing test **passes in isolation**
(verified individually). The cause is the `/auth/login` throttle — 10 attempts a minute, and 18
tests each sign in, on top of the logins my contrast auditor consumes. `p2d14`'s login helper waits
the window out; `p2d13`'s does not. Adding that wait would be a retry, which this phase's brief
forbids, so **the spec was left untouched and the result is reported as it stands.**

**New tests added (49), none weakened:**
- `overlay-contrast.test.ts` — badges must paint their own opaque surface; every accent token must
  clear AA both *as* white-backed text and *under* white text; no opacity modifier on
  `text-muted-foreground`; metal plates and wheel segments must carry their white labels.
- **Proven non-vacuous:** restoring the old `--warning: 36 94% 50%` makes it fail with
  *"white on --warning: expected 2.24 to be greater than or equal to 4.5"* — the exact defect.

## 6. Frozen surfaces

```
git diff --stat -- wallet-engine wallet-core gaming-money settlement games runtime packages/database
  (empty)
```

Byte-identical to the index for every frozen path. Newest mtime in each frozen path is
**09:52:33**; this phase's earliest edit is **12:20:44** — no frozen file has been written since
hours before the work began. No Prisma schema change, no migration, no raw-SQL mutation.

## 7. Test wallet — unchanged, as required

| | |
|---|---|
| Account | `m9clm775507269539@t.local` |
| Balance | **10000.000000000000000000 INR** |
| Completed ₹10,000 deposits | exactly **1** |
| Reconciliation difference | **0** |
| Negative balances / unbalanced ledgers | 0 / 0 |

No credit was created, altered or repeated. `/vault` remains a `useDemoWallet` demo surface and
holds no real balance.

## 8. Limitations

1. **~18 genuine AA failures remain**, all single-instance chips on fictional demo/discovery pages
   (`● Live` at 4.30 is the closest to passing). None is on a money, account or operator surface.
2. **The auditor is deliberately conservative** and still over-reports on small pills with rings and
   inside JS-driven carousels. Each such case in this report was individually verified by direct
   pixel sampling rather than dismissed.
3. **`p2d13` mobile is rate-limit sensitive** when all 18 tests run in one batch.
4. The pre-existing items from the earlier 2D.14 pass stand: the `/#about` dead anchor, migration
   drift, and unverified HTTPS/`Secure`-cookie behaviour.

**Local tests passing is not production readiness.** The release gate in
`FINAL_RELEASE_CHECKLIST.md` is unchanged, and its HTTPS, production-configuration and
migration-state gates remain open.
