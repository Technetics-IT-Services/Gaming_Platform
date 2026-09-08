# Phase 2D.12 — Forensic Gap Audit

**2026-09-07.** Requirement IDs recounted independently from source: **P-01…P-18 (18) + PA-01…PA-10
(10) + AD-01…AD-12 (12) + F-01…F-10 (10) + X-01…X-08 (8) = 58** ✓

---

## The finding that changes the delivery picture

A machine audit mapped **every** admin/operator backend controller to its frontend caller. Result:

**11 operator surfaces — 48 permission-guarded routes — have no frontend at all.**

| Surface | Guarded routes | Requirement | Was | **Actually** |
|---|---|---|---|---|
| `/admin/cashier` | 5 | **P-05, P-06, F-01** | GREEN | **AMBER — P0** |
| `/admin/users` | 10 | **AD-02** | GREEN | **AMBER** |
| `/admin/game-*` (categories, collections, launchers, providers) | 18 | **AD-03** | GREEN | **AMBER** |
| `/admin/kyc` | 3 | **AD-11** | GREEN | **AMBER** |
| `/admin/finance/expenses` | 8 | **F-03** | GREEN | **AMBER** |
| `/admin/audit` | 1 | **AD-12** | GREEN | **AMBER** |
| `/admin/responsible-gaming` | 2 | **P-10** | GREEN | **AMBER** |
| `/admin/referrals` | 1 | **P-17** | AMBER | AMBER |

### Why this matters more than a percentage

**The whole deposit model is operator-credited.** A player requests a deposit; it sits `PENDING`;
an operator calls `POST /admin/cashier/deposits/:id/complete`, which credits the wallet through the
ledger. With the payment gateway deliberately on hold, **that is the deposit mechanism** — not a
fallback.

There is no screen for it. Today an operator cannot credit a deposit or pay a withdrawal without
hand-crafting an authenticated request with an admin bearer token and a TOTP second factor.

The same is true for approving KYC, locking a user, assigning a role, revoking a session, or
recording an expense. Each has a correct, guarded, audited backend that no human can reach.

### Why the earlier audits missed it

Previous phases verified *"backend + API + authorization + tests + live HTTP"* and marked the
requirement complete. They did not ask the one question that matters for delivery: **can an operator
actually do this in the product?** A guarded endpoint reachable only by curl is not a delivered
feature — a point this phase's brief makes explicitly ("A page that loads does NOT prove the feature
works").

This is a **correction, not a regression**. Nothing broke; the classification was too generous.

---

## Corrected status

| Status | Count | Change |
|---|---|---|
| **GREEN** | **31** | −7 |
| **AMBER** | **11** | +7 |
| **RED** | **0** | — |
| **BLOCKED** | **16** | — |
| **TOTAL** | **58** ✓ | — |

`31 + 11 + 0 + 16 = 58` ✓

The seven reclassified: P-05, P-06, AD-02, AD-03, AD-11, AD-12, F-03. (P-10 and F-01 also lose an
operator surface but retain enough elsewhere to stay GREEN — P-10's *enforcement* is real and
player-facing; F-01's finance console exists. Both are noted below.)

---

## What is genuinely unblocked

Every item below needs **no client decision, no invented business rule and no external provider**.
The backends already exist, guarded and audited — only the operator interface is missing.

| Pri | Work | Requirement | Routes | Why unblocked |
|---|---|---|---|---|
| **P0** | **Cashier console** — complete/reject deposit, approve/complete/reject withdrawal | P-05, P-06, F-01 | 5 | The operator *is* the payment rail while the gateway is on hold. Amounts come from the player's own request; the operator only decides yes/no |
| **P1** | **KYC review queue** — list, detail, approve/reject with reason | AD-11 | 3 | Approve/reject-with-reason *is* the requirement. No threshold to invent |
| **P1** | **User management** — list, lock/unlock, verify, roles, sessions, security events | AD-02 | 10 | Pure operational RBAC |
| **P1** | **Expenses admin** — categories, record, confirm, void, totals | F-03 | 8 | Categories and amounts are operator-entered accounting records. The service already creates no ledger entry |
| **P2** | **Audit log viewer** | AD-12 | 1 | Read-only |
| **P2** | **Responsible-gaming operator view** | P-10 | 2 | Read-only; enforcement already works |
| **P2** | **Referral admin list** | P-17 | 1 | Read-only |
| **P2** | **Game catalog admin** | AD-03 | 18 | Catalog configuration; `/admin/games` already exists |

## What remains genuinely blocked (unchanged — 16)

Confirmed still blocked, and **explicitly out of scope for this phase**:

- **Client business decisions (8):** D-01 revenue definition · D-02 withdrawal threshold ·
  D-03 VIP tiers · D-04 referral reward · D-05 reward amounts · D-06 retention cohort + promotion
  award · D-07 financial close · D-08 gift-code destination
- **External providers (6):** payment gateway · SMTP · SMS/push · object storage · FX feed · banking

> **Payment gateway, UPI, bank transfer, payout, banking and external FX integration are
> intentionally deferred and are not part of this phase.**

## Method

Not grep alone. The audit enumerated every `@Controller` under `admin/` and `partner/`, counted its
routes, then searched all non-test frontend source for a caller of each base path. Findings were
then confirmed by direct source inspection of the controllers and the corresponding pages, and by
live HTTP against the running server.
