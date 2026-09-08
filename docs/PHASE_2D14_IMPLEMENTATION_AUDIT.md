# Phase 2D.14 — Super Admin Access · Light Theme · Home/Promotions · ₹10,000 Test Credit

**Date:** 2026-09-08 · **Nothing committed. Nothing pushed. HEAD unchanged at `da25d8d`.**

---

## 1. Super Admin access verification (Part A)

No credential was invented. The account comes from the repository's own bootstrap path:
`packages/database/prisma/seed.ts` upserts `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`
and grants `super_admin`. It never prints the password (`// no password printed`).

| Question | Answer |
|---|---|
| Email | `admin@money.local` (username `moneyadmin`) |
| Password exists | Yes — bcrypt hash present |
| 2FA enabled | **Yes** — mandatory, see below |
| Status | `ACTIVE`, email verified |
| Roles | **Super Admin** |
| Resolved permissions | **31 of 31** — the complete set |
| Authenticates through the real frontend | **Yes**, verified in a real browser including the TOTP challenge |
| Reaches the admin portal | **Yes** |

**Every admin surface was opened in a browser as this account.** All 16 loaded with real data, no
forbidden state, no same-colour text, zero page errors:

```
/admin  /admin/users  /admin/cashier  /admin/partners  /admin/catalog  /admin/audit
/admin/referrals  /admin/settings  /admin/expenses  /admin/finance  /admin/kyc
/admin/bonuses  /admin/promotions  /admin/reports  /admin/analytics  /admin/support
                                                                  flagged routes: 0
```

**A second super-admin exists and cannot be used.** `seedtest_admin@casino.local` also holds
Super Admin and all 31 permissions, but `twoFactorEnabled = false`. `AdminTwoFactorGuard` reads that
flag fresh from the database and refuses **every** request under the admin prefix, so this account
gets 403 on all admin functions until it enrols at `/auth/2fa/setup`. That is the guard working as
designed, not a defect — recorded so nobody mistakes it for a broken login.

**Permission is not sufficient where a domain relationship is required.** Super Admin holds
`partners:read_own`, yet `GET /partner/dashboard` returns **403 — "This account is not linked to a
partner."** The organisation is resolved from `PartnerUser.userId`, so holding the permission
without the relationship gets you nothing.

**A player is denied everywhere**: `/admin` and `/partner` render "Not authorised" in the shell, and
all seven probed admin APIs return 403/404.

## 2. UI theme (Parts B and C)

### The actual defect

The design system in `packages/ui` has been **light-first from the start**. The dark screens were
not branding — a run of inline-styled screens set a DARK-theme foreground (`#e5e7eb`) on their root
element and painted `#111827` panels. Inside a panel that reads fine. Every heading, helper line and
empty state sitting directly on the light app shell rendered light grey on near white:

```
/deposit   #e5e7eb on rgb(238,247,255)  ratio 1.14   "Deposit", "Min ₹10 · Max ₹100000"
/profile   #e5e7eb on rgb(238,247,255)  ratio 1.14   account name, email, "ACTIVE"
/admin/*   #e5e7eb on rgb(238,247,255)  ratio 1.14   every page heading
```

That is the invisible text. It was measured, not guessed.

### How it was measured

A pixel-sampling audit drives the real app: it makes every glyph transparent, screenshots the page
to get a pure **background plate**, then samples the actual painted pixels behind each text element
and scores WCAG AA (4.5:1 normal, 3:1 large). Computed-style compositing cannot see
`background-image`, so it reports white text on a purple gradient chip as white-on-white — that
approach was discarded after it produced 143 such false positives on one page.

Three measurement corrections were made along the way, each verified against a screenshot of the
real page: sample the inner box (rounded corners leave page background in the outer band), model
cumulative element opacity, and avoid the extreme percentile tails (they pick up a glow halo or a
parked sheen band and report a dark purple gradient button as light lilac).

### What changed

**Shared tokens first** (`packages/ui/src/styles/globals.css`). Each accent is used *both* as text on
a light surface and as a background under white text, so its lightness has to satisfy both. Hue and
saturation — the brand — are untouched; only lightness moved:

| Token | Before | After | Why |
|---|---|---|---|
| `--primary` | 263 80% 60% | 263 80% 54% | `text-primary` was 4.24 on tinted chips |
| `--accent` / `--neon` | 190 92% 46% | 190 92% 26% | cyan text measured 2.00 on white |
| `--success` / `--emerald` | 152 64% 42% | 152 64% 25% | 2.78 on white |
| `--gold` | 38 94% 50% | 32 100% 30% | amber text 1.97; foreground flipped to white |
| `--violet` | 268 78% 62% | 268 78% 52% | |
| `--pink` | 326 82% 60% | 326 82% 40% | |
| `--destructive` | 350 84% 56% | 350 84% 42% | **error text was 4.07 on white — below AA** |
| `bg-gradient-gold` far stop | hard-coded `hsl(38 95% 55%)` | `hsl(28 95% 34%)` | the stop never followed the token, so the VIP button stayed white-on-light-amber (2.66) on *every* page |

`text-gold` (178 uses), `text-emerald` (204), `text-primary` (188) and `text-accent` (134) all
inherit these, which is why a token change was preferred to patching pages.

**Then the inline-styled screens.** A new `apps/frontend/src/lib/surface.ts` holds the light
equivalents derived from the same tokens, with each value's measured ratio documented. 680 colour
literals across 33 screens were remapped in one simultaneous pass (so a remapped value is never
remapped again), and 173 `opacity: 0.5–0.6` dimmed-text declarations were replaced with an explicit
readable colour — dimming `#1b1f37` to 60% lands at 4.33, just under AA.

**Deliberately excluded**, because this is real branding rather than a bug:

- **Game boards and table artwork** (`components/games/**`, `components/roulette/**`) — a casino
  table is dark by design and self-consistent (dark felt, light chips).
- **`player-card.tsx`** — SVG avatar artwork where `#1f2937` draws eyes and eyebrows and `#111827`
  is hair. Recolouring it would destroy the drawing.

**Two regressions I introduced and then fixed**, both caught by measurement rather than by eye:
the profile's secondary buttons became white-on-light-grey (1.80:1) when their dark background was
remapped, and three disabled buttons kept `color: white` over a newly light surface.

### Result

| Surface group | Before | After |
|---|---|---|
| **Money / account / cashier** (13 routes, 537 text elements) | **694** AA failures | **3** |
| Demo / discovery pages (10 routes, 1,536 elements) | — | **297** |

Ten of the thirteen money/account routes now measure **zero**. The three residuals are:

| Route | Element | Reading |
|---|---|---|
| `/wallet` | "Transfer" button | Measurement artefact — the button is a dark purple gradient (`rgb(116,44,232)`), confirmed in the DOM and in a screenshot |
| `/responsible-gaming` | "Save limit" | A **disabled** control. WCAG 1.4.3 explicitly exempts inactive components |
| `/verification` | "Submit for review" | Same |

**The demo/discovery residual is real and is not fixed.** It is dominated by `/games` (170), and is
white overlay text on pastel game-tile gradients. Nine scrims were strengthened (`bg-black/25–45` →
`bg-black/65`, and the cover title plate now holds its scrim where the title actually sits), which
helped but did not clear it. These are the fictional demo surfaces; the real lobby is `/lobby`.
Recorded as an open item, not as done.

No text shadows and no `!important` were added. Existing gradients, the purple/blue/pink accent
language, component structure, responsive behaviour and the accessibility controls are unchanged.

### Mobile

`tests/mobile-cert/p2d14-light-theme.spec.ts` — **18/18 at 375 / 390 / 412**. It asserts the body is
light, the amount field is dark-on-light, the heading clears 4.5:1 against the page, the credited
balance matches the database, the profile quick actions clear AA, no Promotions link is a home
fragment, and no page overflows horizontally. Its login helper *waits out* the 10-per-minute login
throttle rather than weakening it.

## 3. Home vs Promotions (Part D)

**Root cause — they were literally the same page.** Every "Promotions" link in the chrome (premium
top bar, marketing bar, footer) pointed at **`/#promotions`**: the home page with an anchor. And the
`Promotions()` section that would have provided that anchor **is not rendered anywhere** — no import,
no usage — so the fragment had no target either. For a signed-in player `/` additionally redirects to
`/dashboard`. Clicking Promotions simply landed you on Home.

The route architecture was already correct and needed no change:

| Route | What it is |
|---|---|
| `/` | Public marketing landing; authenticated players are redirected to `/dashboard` |
| `/dashboard` | Authenticated HOME — the gaming hub (hero, wallet summary, quick actions, shelves) |
| `/offers` | **The canonical promotions surface** — real `Promotion` rows the operator published, honest about the blocked award rule |
| `/promotions` | The fictional demo showcase (demo wallet, lucky wheel, mystery chest) — already `demoOnly`, hidden in production |

**What changed:** four `href` values now point at `/offers`. No component was renamed, no page
rebuilt, no promotion data invented. `/offers` continues to show the server's own blocked reason
where a reward value would sit — never a fabricated amount, never ₹0.

Verified: `/dashboard` and `/offers` are different routes with different content, and the mobile
spec asserts no Promotions link resolves to `/#promotions` at any viewport.

**A related pre-existing defect, reported not fixed:** `marketingNav` still has
`{ label: 'About', href: '/#about' }`, and `id="about"` does not exist either. It is the same dead
anchor, but there is no About page to point it at — inventing one is out of scope, so the test pins
the current state and names it.

## 4. ₹10,000 local test credit (Part E)

**Not a database write. Not a payment provider.** It went through the real, audited workflow:

```
player  POST /cashier/deposits                     -> PENDING, no money moves
super admin  POST /admin/cashier/deposits/:id/complete
     -> WalletEngine.credit()  ->  wallet transaction + double-entry ledger + audit trail
```

| | |
|---|---|
| Account | `m9clm775507269539@t.local` (user `01a07b54-2655-7281-aec7-13dbe8545701`) |
| Balance before | **0** (no wallet existed; the cashier created it) |
| Amount | **₹10,000.00** |
| Balance after | **10000.000000000000000000** |
| Deposit id | `01a07fab-e6a4-7f32-b496-c22d3ccbca39` |
| Reference | `dep_p2d14-1788848367238` |
| Transaction id | `01a07fab-e942-76c3-8c18-1b92fea620a4` |

**Choice of account, stated honestly:** there is **no canonical wallet-test player documented in the
repository**. Candidates were either `it_*` integration accounts with generated passwords, or
ephemeral per-run harness users. `m9clm775507269539@t.local` was chosen as the most recently
established persisted browser-certification player with a known password — a real registered player,
already used in mobile cert runs.

**"Vault" is a demo surface.** `/vault` uses `useDemoWallet` and moves fictional funds; it touches no
real balance. Nothing was credited there.

**Verification — 27/27 passed:**

| Check | Result |
|---|---|
| Deposit status | COMPLETED |
| Wallet transaction amount | 10000.00 |
| Ledger bound to the transaction | 1 |
| Entries (double entry) | ≥ 2 |
| Credit side / debit side | 10000.00 / 10000.00 |
| Those entries net to | **0** |
| Player balance | 10000.00 |
| **Global reconciliation difference** | **0** |
| Negative balances | 0 |
| Unbalanced ledgers anywhere | 0 |
| Completed ₹10,000 deposits for this player | exactly **1** |
| Audit row + acting administrator + action | present · present · `APPROVE` |
| Player sees it via `GET /wallet`, `/wallet/history`, `/cashier/deposits` | yes · yes · COMPLETED |
| Player could self-approve | **no — 403** |
| Player could credit via `/admin/wallet/credit` | **no — 403** |
| `grant-bonus` still closed | **404** |
| Balance after all probes | unchanged |

Also verified visually on a phone at all three viewports.

## 5. Security regression (Part F) — 31/31

| Area | Result |
|---|---|
| `POST /wallet-engine/grant-bonus` | **404** |
| Route/guard inventory | 482 routes · 215 permission-guarded · 72 public · 195 authenticated-only · **admin routes with no guard: none** |
| Client-controlled credit | player → `/admin/wallet/credit`, `/admin/bonuses`, cashier completion: **403**, balance unmoved |
| Mass assignment | a deposit carrying `status` / `netAmount` / `userId` → **400**, nothing created; a profile update carrying `role` / `status` → refused; the player gained no role |
| RBAC | player denied on all 7 probed admin APIs |
| IDOR | another player's deposit 403/404; a smuggled `?userId=` returns **the caller's own wallet**, and the other player's balance does not appear |
| Partner isolation | another partner's record 403; the partner list 403; a smuggled `partnerId` ignored; raising own revenue share 403 |
| Relationship still enforced above permission | super admin → `/partner/dashboard` **403** |
| Money integrity after every probe | difference **0**, no negative balances |

**One IDOR check initially failed and was investigated rather than assumed.** `GET /wallet?userId=<other>`
returned a body containing the other user's id — but only in the response envelope's echoed `path`
field. The payload was the caller's own wallet and the other player's balance (1025) was absent. The
assertion was scanning the envelope; it now targets the payload.

## 6. Tests

| Suite | Result |
|---|---|
| Backend (`--runInBand`, DB + stress) | **801 passed / 0 failed / 0 skipped** (63 suites) |
| Frontend | **1127 passed / 0 failed / 0 skipped** (79 files, +30 new) |
| Mobile 375/390/412 | **18 / 18** |
| Live: Part E credit verification | **27 / 27** |
| Live: security regression | **31 / 31** |
| Live: admin / player / partner UI sweep | 16 + 18 + 6 routes, 0 unexpected flags |
| Backend typecheck · lint | PASS · **0 errors, 0 warnings** |
| Frontend typecheck · lint | PASS · **0 errors**, 4 pre-existing warnings |
| Production build | PASS — 110 static pages |

**One backend flake, reported not hidden.** The first full-serial run failed
`game-money-plinko-mines.integration.spec.ts:78` on a statistical assertion (`wins >= 1`). No backend
file was changed in this phase. It passed **3/3 in isolation** and the full suite passed **801/801**
on re-run. It is the same shared-database contention class already recorded for blackjack and the
wallet-concurrency stress. **No assertion was weakened, no retry added, no timeout inflated, nothing
skipped.**

## 7. Frozen surfaces (Part G)

Baseline recorded before any edit: 514 entries, HEAD `da25d8d`.

**No frozen surface was touched.** Filtering this phase's edits for `wallet-engine`, `gaming-money`,
`wallet-core`, `settlement`, `bridge`, `runtime`, `modules/games` and `prisma` returns **nothing**.
No Prisma schema change. No migration. No raw-SQL mutation — SQL was used only to read verification
facts.

HEAD is still `da25d8d`. **Nothing was committed or pushed.**

## 8. Limitations and pre-existing issues

1. **Demo/discovery pages retain 297 measured AA failures**, dominated by `/games` (170) — white
   overlay text on pastel game-tile gradients. Not fixed.
2. **`/#about` is a dead anchor** — the same defect as Promotions, with no About page to point at.
3. **`/partner/dashboard`, `/partner/members`, `/partner/report` are API paths, not pages.** The
   portal is a single page at `/partner` that renders all three; visiting those URLs in a browser
   correctly gives "Page not found". Nothing is missing.
4. **Migration drift (pre-existing, from 2D.13):** 5 migrations create 128 tables; the live database
   has 136. Rollback needs a restore, not a down-migration.
5. **HTTPS / `Secure`-cookie behaviour is still unverified** — no TLS endpoint exists here.
6. **The backend must be started with an explicit `DATABASE_URL`/`REDIS_URL`.** `apps/backend/.env`
   points at port 5432 / `gaming_platform`, while the disposable stack is 55432 /
   `gaming_platform_phase1`; starting without the override fails Prisma authentication at boot.
7. **Payment integration remains on hold** — no gateway, UPI, bank transfer, payout, FX, SMTP, SMS,
   push or object storage was touched.

**Local tests passing is not production readiness.** The release gate in
`FINAL_RELEASE_CHECKLIST.md` still stands, and its HTTPS, production-configuration and
migration-state gates are still open.
