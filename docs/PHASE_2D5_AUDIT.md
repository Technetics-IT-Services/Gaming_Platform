# Phase 2D.5 — Audit (before code)

Starting matrix: **GREEN 23 · AMBER 9 · RED 9 · BLOCKED 11.**

## 1. Candidate-by-candidate findings (repository evidence)

| Req | Existing model | Backend usage | Live rows | Verdict |
|---|---|---|---|---|
| **F-03 Expense** | **NONE** — no `Expense`, `AccountingEntry` or `FinancialPeriod` anywhere in 20 schema files | — | — | **BUILD from scratch. Implementable.** |
| **AD-09 Settings** | `SystemSetting` (unused, 0 rows) **and** `ApplicationSetting` (**37 non-spec usages**, 0 rows) | see §2 | 0 / 0 | **Implementable, but with a hard constraint (§2)** |
| **AD-08 Promotions** | `Promotion` (code, name, type, status, priority, maxRedemptions, startsAt/endsAt, terms), `Coupon` | **0 usages** | 0 | Admin CRUD implementable; **monetary awarding BLOCKED** |
| **P-17 Referral** | `User.referralCode` (**already generated at signup**), `ReferralHistory` (referrer/referred/status/qualifiedAt/rewardedAt), `ReferralProgram`, `ReferralReward` | **0 usages** | 0 | **Attribution implementable; reward crediting BLOCKED (§4)** |
| **PA-08 Partner notifications** | 2D.1 `NotificationEventsService` + `Notification` model | live | live | **Implementable for events that exist (§5)** |

## 2. AD-09 — a real hazard found, and the constraint it imposes

`ApplicationSetting` is **not** an unused table. It is already the generic scope/key store behind:

- `dice-variant.service.ts`, `crash-variant.service.ts`, `roulette-variant.service.ts`,
  `card-variant.service.ts` — **the real-money game variant configurations**
- `alert.service.ts`, `mission.service.ts`, `season.service.ts`, `tournament.service.ts`

**A generic settings CRUD over `ApplicationSetting` would hand an admin a UI to edit live game
variant configuration — a money-affecting surface.** The brief is explicit: *"If a setting affects
money movement or responsible-gaming enforcement: STOP before changing behavior."*

**Decision:** settings CRUD is built over **`SystemSetting`** (genuinely unused) with an explicit
**key whitelist**. `ApplicationSetting` is deliberately NOT exposed. Game-variant and
responsible-gaming configuration remain out of scope and are documented as such rather than silently
made editable.

## 3. F-03 — what is and is not implementable

**Implementable now:** the expense *record* — category, description, amount (Decimal), currency,
date, status, reference, created-by, audit.

**Explicitly NOT implemented:**
- **No ledger posting.** An accounting expense and a player wallet movement are not the same thing.
  The requirement defines no money movement for an expense, so none is created. `WalletEngine` and
  the ledger are untouched.
- **No profit calculation.** Profit needs `revenue − expenses`, and **revenue has no definition**
  (F-02, a client decision). The expense model is built to be *deterministically aggregatable* so
  profit becomes a small step once that definition exists.

## 4. P-17 — the honest split

| Layer | Status |
|---|---|
| Referral **code** | already exists (`User.referralCode`, generated at signup) |
| Referral **attribution** (code → referrer↔referred relationship, unique, self-referral blocked) | **IMPLEMENTABLE** |
| Referral **status** lifecycle + listing/history | **IMPLEMENTABLE** |
| Referral **reward crediting** | **BLOCKED** — the requirement says "qualifying deposit", but **no qualifying threshold is defined anywhere**, and crediting a wallet without a defined trigger and amount would fabricate money |

`ReferralProgram.referrerRewardAmount` is a configurable field, but the *qualifying condition* that
triggers it is undefined. Attribution ships; crediting does not.

## 5. PA-08 — only events that exist

Real partner events available today: **status changed**, **revenue share changed**, **member added**.
These are wired to the existing 2D.1 notification system.

**BLOCKED:** partner *daily profit* notifications — they depend on PA-03 partner profit, itself
blocked on the revenue definition.

## 6. Execution order (deadline-optimised)

Preferring **complete small features** over partial large ones:

1. **F-03 expense** — full vertical slice (highest priority, foundational for finance).
2. **PA-08 partner notifications** — smallest, reuses existing infrastructure entirely.
3. **P-17 referral attribution** — medium, no new financial semantics.
4. **AD-09 settings** — needs the whitelist care described in §2.
5. **AD-08 promotions admin** — only if time genuinely permits; documented otherwise.

## 7. Frozen surfaces

Nothing in this phase requires touching `WalletEngine`, wallet-core, the ledger, settlement,
`GameMoneyBridge`, the game engines, provably-fair or the runtime. **No `FROZEN_CHANGE_PROPOSAL` is
needed.** An expense creates no ledger entry; referral attribution moves no money; notifications and
settings move no money.
