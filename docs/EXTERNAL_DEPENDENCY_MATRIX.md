# External Dependency Matrix

Audited 2026-09-07 against the repository and the running deployment. **No secret value appears in
this document** — only whether one is present.

## Status vocabulary

- **MISSING IMPLEMENTATION** — no code exists; a provider must be chosen and an adapter written
- **MISSING PROVIDER** — no provider has been selected
- **MISSING CREDENTIALS** — the code is complete and will work the moment credentials are supplied
- **CONFIGURED** — provider and credentials are present and exercised

---

## 1. Email / SMTP — X-03

| | |
|---|---|
| **Requirements** | X-03; also underpins password reset and email verification |
| **Code abstraction** | ✅ `MailService` — real `nodemailer` transport, templates owned by the service |
| **Provider implementation** | ✅ Complete. `onModuleInit` builds a transport when `MAIL_HOST` is set |
| **Credentials** | ❌ **MISSING CREDENTIALS** — `MAIL_HOST` unset, so the service starts in log-only mode and says so in the boot log |
| **Backend integration** | ✅ Wired to auth flows |
| **Frontend integration** | n/a |
| **Config keys required** | `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_SECURE`, `MAIL_FROM` — all already validated by `env.validation.ts` |
| **Sandbox available?** | Yes — any SMTP sandbox (Mailtrap, Mailhog) works unchanged |
| **Without it** | ⚠️ **No email leaves the platform, including password-reset and verification messages.** Flows complete; the message is written to the log instead of sent |
| **Effort once supplied** | **< 1 hour**, mostly verification |
| **Status** | **MISSING CREDENTIALS** |

## 2. Payment gateway — X-05

| | |
|---|---|
| **Requirements** | X-05; affects P-05 deposit automation |
| **Code abstraction** | ❌ None on the backend. `DepositRequest.metadata.method` records a label only |
| **Provider implementation** | ❌ **MISSING IMPLEMENTATION** — and deliberately so: no fake gateway was ever built |
| **Credentials** | ❌ No provider selected |
| **Backend integration** | Partial — the deposit lifecycle (`PENDING → operator credit`) is complete and is the correct seam a gateway would attach to |
| **Frontend integration** | Deposit request UI exists; no redirect/checkout step |
| **Config keys required** | Depend on the provider: API key, secret, webhook signing secret |
| **Sandbox available?** | Yes for every major Indian provider |
| **What is already complete without it** | The whole deposit record, review, credit, ledger posting and reconciliation path. A gateway adds *automatic confirmation*, not the money handling |
| **Without it** | ⚠️ Every deposit requires manual operator confirmation. Workable at low volume |
| **Effort once supplied** | **3–5 days** including webhook idempotency and reconciliation |
| **Status** | **MISSING PROVIDER + MISSING IMPLEMENTATION** |

## 3. SMS / push — X-04

| | |
|---|---|
| **Requirements** | X-04 |
| **Code abstraction** | ❌ None. Repository-wide search for `sendSms` / `sendPush` / a push service returns nothing |
| **Provider implementation** | ❌ **MISSING IMPLEMENTATION** |
| **Credentials** | ❌ No provider selected |
| **What is already complete** | In-app notifications (P-09) are complete, durable, idempotent and event-driven. SMS/push would be additional delivery channels over the same events |
| **Without it** | In-app notifications only — which work fully |
| **Effort once supplied** | **1–2 days per channel** |
| **Status** | **MISSING PROVIDER + MISSING IMPLEMENTATION** |

## 4. Object / document storage — P-12 sub-capability

| | |
|---|---|
| **Requirements** | P-12 KYC document **file bytes** |
| **Code abstraction** | ❌ No storage service. `Document.fileUrl` holds an opaque marker (`kyc:<id>:<TYPE>`), never a real object key |
| **Provider implementation** | ❌ **MISSING IMPLEMENTATION** |
| **Credentials** | ❌ No bucket configured |
| **What is already complete** | The entire KYC lifecycle: submit, resubmit, status, rejection reason, operator queue, review decision, audit. Only the image bytes are absent, and `UPLOAD_UNAVAILABLE` is declared honestly rather than faked |
| **Config keys required** | Bucket, region, access key, secret, plus a retention period |
| **Without it** | ⚠️ KYC approval works, but reviewers must inspect documents outside the platform |
| **Effort once supplied** | **~1 day** |
| **Status** | **MISSING PROVIDER + MISSING IMPLEMENTATION** |

## 5. FX rate source — F-09

| | |
|---|---|
| **Requirements** | F-09 consolidated multi-currency totals |
| **Code abstraction** | ✅ `exchange_rates` table exists in the schema |
| **Provider implementation** | ❌ No feed writes it |
| **Data** | ❌ **`exchange_rates` contains 0 rows** (verified this phase) |
| **What is already complete** | Every financial figure across analytics, reports and the finance console is returned **per currency and never combined** — the correct behaviour without a rate source |
| **Current relevance** | **Low.** `wallet_transactions` shows activity in **INR only** (39,400 rows, single currency). This is only needed if a second currency goes live |
| **Effort once supplied** | **S** — the per-currency buckets already exist; conversion is a presentation layer over them |
| **Status** | **MISSING PROVIDER** (low priority) |

## 6. Banking / settlement — F-10

| | |
|---|---|
| **Requirements** | F-10 |
| **Code abstraction** | ❌ None |
| **Provider implementation** | ❌ **MISSING IMPLEMENTATION** |
| **Credentials** | ❌ No bank relationship configured |
| **What is already complete** | Withdrawal request, hold, review, approve/reject, refund and ledger posting. The payout *instruction* is what is missing, not the money handling |
| **Without it** | Payouts executed manually by staff |
| **Effort once supplied** | **XL** — depends entirely on the bank's file format and reconciliation model |
| **Status** | **MISSING PROVIDER + MISSING IMPLEMENTATION** |

---

## Summary

| Service | Abstraction | Implementation | Credentials | Blocking launch? |
|---|---|---|---|---|
| **SMTP** | ✅ | ✅ | ❌ | ⚠️ **Yes — no password-reset email** |
| **Payment gateway** | ❌ | ❌ | ❌ | ⚠️ Operationally, yes at volume |
| **Object storage** | ❌ | ❌ | ❌ | Partially — KYC review still works |
| **SMS / push** | ❌ | ❌ | ❌ | No — in-app notifications are complete |
| **FX source** | ✅ table | ❌ | ❌ | No — single currency in use |
| **Banking** | ❌ | ❌ | ❌ | No — manual payouts are viable |

**One line summary: SMTP is the cheapest and most urgent (code done, needs credentials); the payment
gateway is the largest genuine integration; the rest can follow launch.**

**No fake provider exists anywhere in this codebase.** Nothing returns a success it did not receive
from a real system.
