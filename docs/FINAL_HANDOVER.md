# Final Handover

**Gaming platform · prepared 2026-09-08 · for the client / CTO**

---

## 1. What this is

A real-money gaming platform: player portal, fifteen games, a double-entry wallet and ledger, a full
operator console, a partner portal, and the compliance workflows around them. Nothing in it is a
mock-up — every figure on every screen comes from the server.

**38 of 58 requirements are complete and independently verified. 4 are working with one named part
missing. 16 wait on a decision from you or on a vendor account.** No requirement is waiting on more
engineering.

## 2. What is implemented and production-ready

**Players can:** register and sign in (with optional two-factor), request a deposit, play fifteen
real-money games, view wallet and game history, request a withdrawal, set their own deposit / wager /
loss limits or self-exclude, submit identity verification, raise support tickets, see notifications
and published offers, and share a referral code.

**Operators can:** review and credit deposits, approve/pay/reject withdrawals, manage users
(lock, unlock, verify, roles, sessions), review identity checks, run the support queue, manage games,
promotions, bonuses and partners, record business expenses, search every transaction, investigate
failures, read analytics and export reports, and change platform settings.

**Partners can:** sign in to their own portal, see their organisation, ownership share, team and a
full activity history, downloadable as a spreadsheet — and can never see another partner's data.

## 3. What was tested

| Area | Result |
|---|---|
| Backend automated tests | **801 passed / 0 failed / 0 skipped** (63 suites) |
| Frontend automated tests | **1074 passed / 0 failed / 0 skipped** (76 files) |
| Live security probes against the running system | **218 / 218 passed** |
| Mobile certification at 375 / 390 / 412 px | **24 / 24** |
| Typecheck · Lint · Production build | **All pass** |
| Financial reconciliation | **Exactly zero difference** across 87,756 ledger entries |

We attempted, and the system correctly refused: reading another player's data, reading another
partner's organisation, granting ourselves a role or money, submitting hidden extra fields, replaying
a payment, running conflicting changes simultaneously, and reaching an admin screen as a player.

## 4. Financial integrity

Checked directly against the database at handover:

- Total money in = total money out, to eighteen decimal places (**difference: 0.000000000000000000**)
- **Zero** accounts with a negative balance
- **Zero** duplicate payments, credits or refunds
- **Zero** individually unbalanced account books
- Every operator money action recorded against the person who made it (149 audited admin actions)

## 5. Two defects found and fixed during this work

**A critical one.** A web address existed that let any signed-in player give themselves unlimited
money and withdraw it. We reproduced it — a new account created ₹1,000,000 in two steps. The books
balanced perfectly throughout, which is exactly why routine accounting checks never caught it: the
fraud was recorded *correctly*. It is now closed, re-tested, and guarded by a test we proved can
detect it (we temporarily put the flaw back to confirm the test goes red).

**A second one.** The monitoring component could crash the entire backend if the database hiccuped
for a moment. Fixed.

## 6. What is blocked, and by what

### Decisions only you can make (8)

| # | Decision | What it unblocks |
|---|---|---|
| **D-01** | **What counts as "revenue"** | Six requirements: profit, partner profit, partner balances, partner payouts |
| **D-02** | **The large-withdrawal approval threshold** | A compliance control that is built but switched off |
| D-03 | VIP tiers and how a player qualifies | VIP levels and progression |
| D-04 | Referral qualification and reward | Referral payouts and leaderboard |
| D-05 | Reward amounts (daily/weekly/monthly) | Periodic rewards |
| D-06 | Retention definition; promotion award rule | One analytics chart; automatic promotion crediting |
| D-07 | What a daily financial "close" means | Daily settlement |
| D-08 | What a gift code gives, and into which wallet | Gift-code redemption |

The full multiple-choice sheet is `CLIENT_DECISION_QUESTIONNAIRE.md` — designed so you can answer
without a developer.

### Accounts you need to arrange (6)

Payment gateway · **SMTP (email)** · document storage · SMS/push · FX rates · banking.

**We have built no fake versions of any of these.** The email system is complete and will send the
moment you provide a mail server.

## 7. Intentionally deferred

> **Payment gateway, UPI, bank transfer, payout, banking and external FX integration are
> intentionally deferred and are not part of this phase.**

Until a gateway is connected, deposits are **operator-credited**: the player requests, your staff
approve, and the wallet is credited through the ledger. That workflow is complete, audited and
usable — the console for it was built in this phase.

## 8. Known limitations

- **No outbound email** until SMTP is supplied — including password resets. Operators can manually
  verify an address in the meantime.
- **Deposits need manual confirmation.** Fine at low volume; a gateway is the fix.
- **Identity document images are not stored** (no storage account). The review workflow is complete;
  reviewers must see documents through your existing process. The screen says so plainly.
- **Large-withdrawal escalation is off** until you give us the threshold. Any admin can currently
  approve any amount.
- **DAU/MAU history begins 7 September 2026** — there is no backfill, and every screen states it.
- **Physical-device testing was not performed** — emulation at three widths only.
- **HTTPS with secure cookies could not be verified here** — this environment has no HTTPS. It must
  be checked on staging before go-live.
- Four admin catalog sub-screens (game categories, collections, launchers, providers) still have no
  UI; the main game console does.
- Two automated tests are statistically flaky (random card/ball outcomes). Reproduced, measured,
  documented and deliberately left unweakened.

## 9. Deployment requirements

**Runtime:** Node.js · PostgreSQL · Redis.

**Database:** there are no migration files — the schema is applied with `prisma db push`. **Rollback
therefore requires a database restore**; take a backup before every deploy.

**Redis:** required for sessions, authorization caching and rate limiting. Not optional.

**Environment variables that must be set for production:**

| Variable | Why |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | Data tier |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Must be strong production values, not dev defaults |
| `AUTH_COOKIE_SECURE=true` | **Required**, and only valid over HTTPS |
| `CORS_ORIGINS` | Your real domain only |
| `BACKEND_ORIGIN` | Same-origin API proxy for the cookie flow |
| `NEXT_PUBLIC_DEMO_MODE=false` | Already set in the production build |
| `CASHIER_LARGE_WITHDRAWAL_THRESHOLD` | Until set, escalation is off (decision D-02) |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM` | Enables email |
| `SESSION_IDLE_TIMEOUT_MINUTES` | Idle logout |

**HTTPS is mandatory.** The refresh-token cookie is `Secure`, so authentication will not work
correctly over plain HTTP. Verify the full login → refresh → logout cycle on staging over HTTPS
before going live; this is the one gate we could not close in this environment.

**Also required:** route the `RECOVERY_FAILED` alert log line to a human, monitor
`/api/v1/health`, enrol every admin account in two-factor authentication, and schedule automated
database backups.

## 10. Rollback procedure

1. Keep the previous application build available.
2. Take a database backup immediately before deploying.
3. To roll back: redeploy the previous build **and** restore the database backup — because the schema
   is pushed rather than migrated, application rollback alone may leave a schema newer than the code.
4. After any rollback, run the reconciliation check (`GET /admin/wallet/reconcile`) and confirm
   `difference: "0"` before reopening to players.

## 11. Our recommendation

The platform is ready to operate. Before go-live, we would want: HTTPS verified on staging, the
withdrawal threshold set, and SMTP credentials supplied — a few hours of work between us, mostly
waiting on you.

The single highest-value thing you can send is the **revenue definition (D-01)**. One answer unblocks
six requirements, including the entire partner-profit chain.
