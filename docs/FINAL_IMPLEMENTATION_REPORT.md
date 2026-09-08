# Final Implementation Report — Client Completion Sprint

Companion to [FINAL_CLIENT_REQUIREMENT_MATRIX.md](FINAL_CLIENT_REQUIREMENT_MATRIX.md).

**This report covers what was actually built and verified in this sprint. It is not a completion
claim for the whole client system — §5 states plainly what remains.**

---

## 1. What this sprint delivered

| # | Requirement | Before | After |
|---|---|---|---|
| **P-10** | **Responsible gaming — server enforcement** | Informational page. No model, no service, no enforcement. A limit a player "set" could not stop anything. | **Fully implemented and enforced**: persisted limits and restrictions, enforced before every money and game action, with player UI, operator controls, audit trail, 44 unit + 14 integration + 24 live HTTP + 15 mobile checks. |

Phase 2D.7 (analytics hardening, reports, CSV export) was also completed and verified in this
session; its evidence is in `PHASE_2D7_*.md`.

---

## 2. Responsible gaming — how it works

### 2.1 Persistence (additive; no financial table touched)

Two new tables in a new schema file, `responsible-gaming.prisma`:

| Table | Purpose |
|---|---|
| `responsible_gaming_limits` | `DEPOSIT` / `WAGER` / `LOSS` caps per `DAILY` / `WEEKLY` / `MONTHLY` period, per currency. `Decimal(20,8)` — never a float. `effective_from` + `superseded_at` give a full history and make a delayed increase expressible. |
| `account_restrictions` | `SELF_EXCLUSION` (may be permanent) and `COOLING_OFF` (always time-boxed), with lift attribution. |

A partial unique index (`WHERE superseded_at IS NULL`) guarantees exactly one live limit per
(user, type, period, currency), so a player can never hold two conflicting caps with no defined winner.

### 2.2 Enforcement — an ADDITIVE layer, leaving the frozen core alone

The requirement is that enforcement happen **before** money moves. The brief also requires proving a
frozen-surface change is unnecessary before making one. It is unnecessary:

> A NestJS **guard runs before the route handler**, therefore before `GameMoneyBridge` or
> `CashierService` is ever entered — upstream of every reservation, debit and ledger write.

So `ResponsibleGamingGuard` is applied to the money/game controllers, and
**`WalletEngine`, wallet-core, the ledger, settlement, `GameMoneyBridge`, the game engines, the
provably-fair engines and the runtime were not modified by this work.** Outside the new module this
session changed only two controllers (decorator lines), two module files (imports), `app.module.ts`,
the analytics service/controller/DTO, and the config files for the two new env knobs.

(`wallet-transaction.service.ts` appears modified in `git status`, but that is a **pre-existing
uncommitted Phase 2C change** already present at session start — see
[FINAL_FINANCIAL_VERIFICATION.md §3](FINAL_FINANCIAL_VERIFICATION.md).)

Applied at **controller level** on `@Controller('games')`, so a play route added later is protected
by default — the failure mode of an opt-in marker is the route someone forgets to annotate, which is
exactly the gap this control exists to close.

### 2.3 Usage is measured, never counted

There is no "spent so far" column, because a second source of truth would drift from the ledger.
Usage is aggregated from authoritative tables at check time:

| Limit | Source | Definition |
|---|---|---|
| `DEPOSIT` | `deposit_requests` | `SUM(amount)` in period where status ∈ (PENDING, PROCESSING, COMPLETED) — everything the player has **committed** to. Counting only COMPLETED would let the cap be walked past by queueing requests an operator has not yet credited. |
| `WAGER` | `game_rounds` | `SUM(stake)` in period over all statuses in which a stake was actually taken. |
| `LOSS` | `game_rounds` | `SUM(stake) − SUM(payout)` over settled rounds, **floored at zero**. A player who is up has lost nothing; a negative "loss" must not create headroom above the cap. |

Because usage is derived, a limit set **mid-period counts play already made** — it is not a fresh
counter (proven by integration test).

### 2.4 Decisions that protect the player

| Decision | Reasoning |
|---|---|
| **Withdrawals are never blocked.** | A self-excluded player must still be able to take their own money out. Trapping funds is the opposite of player protection. The service exposes no withdrawal assertion at all — a test asserts `assertCanWithdraw` is `undefined`. |
| **A decrease applies immediately; an increase may be delayed.** | Tightening your own protection must never be made to wait. The delay is `RG_LIMIT_INCREASE_DELAY_HOURS`, **default 0**. No cooling-off duration is invented. |
| **A first-ever limit applies immediately**, even with a delay configured. | It is new protection being added, not protection being weakened. |
| **An active restriction cannot be shortened** through the player path — only extended. Lifting is an operator action, attributed and audited. |
| **Restrictions are checked before limits.** | An excluded player is blocked regardless of remaining headroom. |
| **Absence of a limit means unlimited.** | No default limit is invented; behaviour without a limit is exactly as before this module. |

### 2.5 A real bug this work exposed

The first live run showed self-exclusion blocking gameplay (**403**) but **deposit limits not
enforced at all** (200 where 403 was required).

Cause: `RgProtected` was built on `Reflect.metadata`, which attaches method metadata to
`(prototype, propertyKey)`, while Nest's `Reflector` reads a handler's metadata from the **function
object**. The class-level marker on the games controller worked; the method-level marker on
`POST /cashier/deposits` was silently invisible — deposit caps were unenforced.

Fixed by using Nest's `SetMetadata`. **A unit test would not have caught this**; only driving the
real HTTP stack did.

---

## 3. Evidence

| Check | Result |
|---|---|
| Unit tests (`responsible-gaming.service.spec.ts`) | **44 passed** — period maths, restriction logic, cap boundaries, net-loss flooring, decrease-vs-increase, read-only proof |
| Integration vs real Postgres (`responsible-gaming.integration.spec.ts`) | **14 passed** — real rounds through the **frozen bridge** move usage; usage matches direct SQL; restart persistence; blocked wager moves no money; ledger stays balanced |
| **Live HTTP verification** | **24 passed, 0 failed** — see §4 |
| Frontend unit (`responsible-gaming-api.test.ts`) | **19 passed** |
| Mobile certification | **15/15** — 375: 5/5 · 390: 5/5 · 412: 5/5 |
| **Full backend suite** | **613 passed, 54/54 suites, ZERO skipped** (previous baseline: 545 passed, 10 skipped, 1 suite skipped) |
| **Full frontend suite** | **895 passed** (previous 876) |
| Lint | backend **0 errors 0 warnings**; frontend **0 errors** |
| Production builds | backend OK; frontend **94/94 static pages** |
| Financial reconcile after all work | **`balanced: true, difference: "0"`**, zero negative balances |

### 3.1 The stress and integration suites now actually run

The previous baseline reported "545 passed, 10 skipped". Those 10 were the **WalletEngine
concurrency stress suite**, gated behind a second flag (`RUN_STRESS=1`) that the standard run did not
set. It is now executed: **10/10 pass**, and the full run reports **zero skipped tests**.

---

## 4. Live HTTP verification (24/24)

Every call went over the wire to the running backend, through the real auth chain and the real money
controllers. Fixture money was funded through the **real deposit → operator-credit path**, so every
rupee is ledgered and the reconcile stays valid.

| Group | Result |
|---|---|
| Control: play works with no limit | 200 |
| Wager cap: plays up to the cap succeed | 200/200 |
| **Play that would CROSS the cap** | **403**, message names the limit |
| Blocked play moved **no money** | balance identical (4990 → 4990) |
| Player still had funds — refused by the **limit**, not by balance | confirmed |
| Overview shows real usage / remaining | 30 / 0 |
| Deposit below cap / crossing cap | 200 / **403** |
| Self-excluded player: play / deposit | **403 / 403** |
| **Self-excluded player withdrawing** | **NOT blocked by RG** |
| Unauthenticated → RG state | 401 |
| Player → admin RG surface | 403 |
| Player lifting their own restriction | 403 |
| Player A sees only A's limits, not B's | confirmed |
| Negative limit / unknown type / cooling-off with no end | 400 / 400 / 400 |
| RG actions written to the audit trail | confirmed |

---

## 5. What this sprint did NOT deliver — stated plainly

The brief asked for the complete client system. **It was not completed.** One P0 requirement was
implemented end-to-end; the rest of the RED set remains, and the matrix is the roadmap.

**Still RED (internally implementable, not started this sprint):**
P-11 support ticketing · P-12/AD-11 KYC lifecycle · P-14 reward sub-features · P-15/P-16 VIP ·
P-17/P-18 referral · PA-01…PA-10 the entire partner portal · AD-08 promotions admin ·
AD-09 settings CRUD · AD-10 partner management · F-03 expenses · F-04 profit · F-05 daily settlement ·
X-02 the DAU/MAU event pipeline.

**Still BLOCKED (external dependency, cannot be honestly built here):**

| ID | Blocker |
|---|---|
| F-02 revenue | **A business decision.** Nobody has defined what "revenue" means for this platform. Implementable the moment that definition exists. |
| F-09 FX totals | No FX rate source. `exchange_rates` is empty. |
| F-10 bank settlement | External banking provider + credentials. |
| X-03 email | SMTP credentials. `MailService` is log-only and says so. |
| X-04 SMS / push | Provider + credentials. |
| X-05 payment gateway | Provider + credentials. Operator-credit is **not** called gateway integration. |
| AD-06 large-withdrawal threshold | One number from the client. The mechanism exists and is disabled while unset. |

**Not fabricated, deliberately:** no revenue, no expenses, no profit, no partner profit, no FX, no
DAU/MAU/retention/LTV, no payment success, no KYC verification, no external notification delivery.

---

## 6. Known limitation of this implementation

- **RG-L1 — No session-time limit.** Session duration is not measured accurately enough to enforce
  one honestly (`sessions.last_activity_at` advances on token rotation, not on user activity). The
  page says so rather than offering a control the server cannot enforce.
- **RG-L2 — Limits are per-currency.** A player with balances in two currencies sets a cap in each.
  A combined cap would need FX, which does not exist.
- **RG-L3 — Blackjack/crash continuation actions are not re-charged** against the wager cap; the
  stake was checked when the round started. Re-charging would double-count. Restrictions still apply
  to those actions.
- **RG-L4 — No operator UI** for RG. The admin **API** exists and is permission-guarded and audited;
  no admin screen was built this sprint.
- **RG-L5 — Increase delay defaults to 0**, i.e. increases are immediate unless the operator
  configures `RG_LIMIT_INCREASE_DELAY_HOURS`. This is **BUSINESS-CONFIG REQUIRED**, not an oversight.
