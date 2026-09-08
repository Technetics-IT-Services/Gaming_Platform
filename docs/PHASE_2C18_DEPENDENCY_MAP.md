# Phase 2C.18 — Dependency Map

For every major missing requirement: what must exist first. Chains are ordered — each arrow is a hard
prerequisite. `[EXISTS]` marks a prerequisite already satisfied in this repository, so the chain can
start from there.

---

## 1. Notifications (in-app, durable)

```
Notification model                                   [EXISTS — never written]
  → NotificationsService real implementation          (replaces the 501 stub)
  → user-scoped list + mark-read endpoints            (controller EXISTS, service throws)
  → EVENT EMISSION HOOKS  ← the actual missing piece
        deposit completed / rejected        (CashierService  [EXISTS])
        withdrawal approved / rejected      (CashierService  [EXISTS])
        bonus granted                       (BonusWalletService [EXISTS])
        reward claimed                      (RewardService   [EXISTS])
        large-withdrawal escalation         (CashierService  [EXISTS])
  → frontend list + unread badge            (page EXISTS, static array today)
  → NotificationPreference honouring         [MODEL EXISTS]
```

**Shortest chain in the whole backlog.** Every hook point already exists and already runs; only the
service body, the emit calls and the UI binding are missing. **No external provider required.**

External delivery is a *separate* chain and must not block the above:

```
Email → SMTP provider → credentials → template rendering → delivery status → retry/backoff   [BLUE]
SMS   → provider (e.g. gateway account) → credentials → cost controls → opt-in consent        [BLUE]
Push  → FCM/APNs project → device-token registry → per-device targeting                        [BLUE]
```

## 2. Responsible gaming (real enforcement)

```
Limits model  (deposit / loss / wager / session / cooling-off / self-exclusion)   ← MISSING
  → per-user limit storage + effective-date semantics
  → enforcement point A: CashierService.createDeposit      (deposit limit)
  → enforcement point B: WalletEngine debit path            (loss/wager limit)  ← FROZEN SURFACE
  → enforcement point C: GameMoneyBridge play entry         (wager/session)      ← FROZEN SURFACE
  → enforcement point D: login / session guard              (self-exclusion, cooling-off)
  → player self-service UI  (page EXISTS — disclosure only today)
  → admin RG surface
  → audit of every limit change                              (AuditService [EXISTS])
```

**Critical design note:** enforcement points B and C sit on **frozen** surfaces. The safe pattern is a
*pre-check service* invoked **before** the bridge/engine is entered — never a modification inside
WalletEngine. This must be designed explicitly before any code is written.

## 3. KYC

```
Document storage decision  (local vs object store)      ← BUSINESS + INFRA DECISION
  → KycVerification model                                [EXISTS — read only]
  → submission endpoint (upload + metadata)
  → admin review queue + approve/reject + audit          (AuditService [EXISTS])
  → verification status read                             [EXISTS]
  → tier/limit linkage (optional)                        → depends on RG limits model
```

## 4. Referral / affiliate attribution

```
referralCode generated at registration                  [EXISTS — users.service.ts:114]
  → ReferralProgram / ReferralHistory / ReferralReward   [MODELS EXIST — unused]
  → capture referral code at registration  (link/param → persisted attribution)
  → qualifying-deposit trigger              (hook in CashierService.completeDeposit [EXISTS])
  → reward calculation rules                ← BUSINESS DECISION (amount, qualification)
  → idempotent ledger-backed payout         (WalletEngine.credit [EXISTS])
  → referral dashboard / earnings / history
  → leaderboard
```

**Note:** referral attribution is a *prerequisite of the partner chain*, and is far cheaper. It is the
correct place to start if partner functionality is wanted.

## 5. Partner portal → partner profit distribution (the longest chain)

```
Partner model                                                      ← MISSING
  → `partner` role in RBAC catalog                                 (ROLE_DEFINITIONS [EXISTS])
  → partner authentication + partner-scoped guards
  → PLAYER ATTRIBUTION            ← requires chain 4 (referral) first
  → REVENUE SOURCE                 (derivable from WalletTransaction / GameRound [EXIST])
  → EXPENSE / ACCOUNTING SOURCE    ← **MISSING ENTIRELY — no expense model in the schema**
  → net profit = revenue − expenses                                ← BLOCKED by the line above
  → ownership-percentage store + `sum == 100%` invariant           ← BUSINESS DECISION
  → commission rules
  → partner ledger accounts        (must not reuse player wallets)
  → idempotent daily distribution job (restart-safe, auditable)
  → partner balance + payout request workflow
  → partner reports
  → partner isolation tests (A cannot see B)
```

**Two hard blockers, both outside engineering's gift:**
1. **No expense data source exists.** Until expenses are recorded, "Daily Revenue − Daily Expenses =
   Net Profit" cannot be computed without fabricating a number.
2. **Ownership percentages are business policy**, and the `sum = 100%` rule needs an authoritative
   source.

Per the standing instruction, partner profit distribution stays **PURPLE/BLOCKED** rather than being
implemented on invented accounting.

## 6. Finance portal

```
`finance` role in RBAC                                             ← MISSING
  → finance-scoped guards + route group
  → deposits/withdrawals views      (reuse the EXISTING cashier — do NOT build a second one)
  → transaction search over WalletTransaction                      [DATA EXISTS]
  → failed-transaction view                                        [DATA EXISTS]
  → ledger reconcile view           (endpoint EXISTS, returns difference "0")
  → revenue aggregation                                            [DERIVABLE]
  → EXPENSE MODEL                                                  ← MISSING, blocks profit
  → daily financial close / settlement
  → report export (CSV/PDF)
  → bank settlement            → external banking provider          [BLUE]
```

**Note:** roughly 40% of the finance *functions* already exist inside the admin console. The missing
piece is largely a **role + a scoped portal**, not new money machinery.

## 7. Analytics

```
Derivable metrics (revenue, avg bet, most-played, avg deposit/withdrawal, conversion)
  → aggregation service over WalletTransaction / GameRound / DepositRequest / User   [ALL EXIST]
  → admin analytics endpoints (service currently throws 501)
  → dashboard charts (page EXISTS as an honest placeholder)
        ⇒ buildable today, no new infrastructure

Behavioural metrics (DAU, MAU, retention, LTV, session time, bounce, cohorts)
  → EVENT PIPELINE                                        ← MISSING ENTIRELY
        event schema + emission points (page view, session start/end, game open, deposit funnel)
        → ingestion + storage   (PageView / TrafficAnalytics / DeviceAnalytics models EXIST, never written)
        → aggregation + retention cohorting
        → LTV needs financial events + attribution (chain 4)
        ⇒ BLOCKED — cannot be computed from what is persisted today
```

**The split matters:** half of analytics is a few days of aggregation work; the other half needs an
event pipeline that does not exist. They must not be scoped as one item.

## 8. Payment gateway (deposits without an operator)

```
Provider selection                                       ← BUSINESS DECISION
  → merchant credentials                                  [BLUE]
  → PaymentGateway / PaymentMethod models                 [EXIST — unused]
  → hosted checkout or SDK integration
  → WEBHOOK ENDPOINT + signature verification             ← security-critical
  → idempotent credit on webhook   (WalletEngine.credit [EXISTS], idempotency [EXISTS])
  → payment reconciliation (provider ledger vs internal ledger)
  → failure / chargeback / refund handling
```

The internal half is already safe — the deposit path is idempotent and ledger-backed. **Only the
external half is missing.**

## 9. Support / CRM

```
Ticket model                                             ← MISSING
  → submission endpoint + player UI (page EXISTS, static)
  → agent queue + assignment + status
  → threaded messages                (InboxMessage / MessageAttachment models EXIST, unused)
  → notification on reply            → requires chain 1
  → SLA / reporting
```

---

## Dependency summary — what unblocks the most

| Build this | Unblocks |
| --- | --- |
| **Notification service + event hooks** | 12 notification types, support replies, RG alerts, partner alerts |
| **Referral attribution** | referral rewards **and** the entire partner attribution chain |
| **Expense model** | finance profit, partner profit distribution — **two D-class items at once** |
| **`finance` + `partner` roles** | both portals' authorization, and makes partner isolation testable |
| **Derivable analytics aggregation** | admin dashboard, admin reports, finance revenue |
| **RG limits model** | RG enforcement, self-exclusion, and KYC tier linkage |

**Highest leverage single item: the expense model.** It is small, it is pure data, and it is the sole
blocker on two otherwise-buildable financial features.
