# Phase 2D.3 — KYC Implementation

## 1. What existed

| Item | State found (verified in code and the live DB, not from reports) |
|---|---|
| `KycVerification` + `Document` models | **Existed**, with the complete status enum: `NOT_STARTED / PENDING / IN_REVIEW / APPROVED / REJECTED / EXPIRED` |
| Rows | **0** in both tables |
| Backend | One read-only projection: `UsersService.verification()` |
| Submission / review / admin surface | **None** |
| Object storage | `StorageProvider` + `FileStorage` models exist, **0 rows, no writer**; no S3/GCS SDK, no multer |
| Permission for review | **`users:verify` already existed** and is held by `admin` / `super_admin` |

## 2. What changed

**No schema change was needed** — the existing models carry the whole lifecycle, and the brief's
terminology maps onto the existing enum (`IN_REVIEW`, not a new `UNDER_REVIEW`).

**No new permission was invented** — `users:verify` is exactly "may verify a user's identity".

| File | Change |
|---|---|
| `modules/kyc/kyc.service.ts` | new — submit/resubmit, status, admin list/get/review |
| `modules/kyc/kyc.controller.ts` | new — `GET/POST /kyc` (player), `GET /admin/kyc`, `GET /admin/kyc/:id`, `POST /admin/kyc/:id/review` |
| `modules/kyc/kyc.module.ts` | new |
| `lib/kyc-api.ts`, `components/account/kyc-submission.tsx` | new frontend |
| `app/(dashboard)/verification/page.tsx` | wired the real flow in; corrected copy that said submission was operator-only |

## 3. Documents: metadata only, and why

There is no object storage in this deployment. Rather than fabricate a cloud upload, the module
records document **metadata** (type, file name, MIME type, size, checksum) and its review state.

- `fileUrl` holds an opaque internal reference (`kyc:<id>:<TYPE>`) — **never** a URL, bucket path,
  signed link or credential.
- The API returns `unavailable: [{ capability: 'documentFileUpload', reason: 'NOT AVAILABLE — NO
  STORAGE CONFIGURED …' }]` on every response, and the UI renders that reason.
- The UI deliberately has **no `<input type="file">`** — a picker that discarded the file would be a
  lie. Asserted by test.

**This is the one part of the KYC requirement that is genuinely BLOCKED**, and it is marked as such.

## 4. Lifecycle and business rules

| Rule | Behaviour |
|---|---|
| Player submission | **Always** lands as `PENDING`. The DTO has no status/reviewer/verified field and the pipe runs `forbidNonWhitelisted`, so a client cannot propose a decision |
| Duplicate while open | **REFUSED (400)** — deterministic, never a silent second row or overwrite |
| Resubmission | Allowed from `NOT_STARTED`, `REJECTED`, `EXPIRED`; the old application is soft-superseded so exactly one is live |
| Already approved | Cannot submit again |
| Rejection | **Must** carry a reason; the reason is disclosed to the player **only** while status is `REJECTED` |
| Concurrent review | A conditional `updateMany` means only one reviewer wins; the loser gets a clear 400, never a silent overwrite |
| Documents | Follow the application decision (APPROVED/REJECTED) |
| Validation | MIME allow-list, 1 byte–10 MB, no path in the file name, no duplicate document type, at least one document |

### 4.1 KYC does NOT gate money — deliberately

The brief says: enforce a KYC gate **only** if the requirements call for one, and otherwise do not
create "compliance theatre". The requirement enumeration
([`PHASE_2C18_GAP_MATRIX.md`](PHASE_2C18_GAP_MATRIX.md) rows 27–28, 146–147) asks for KYC
**submission** and **review**. It does **not** state that withdrawals, deposits or gameplay are
blocked pending verification.

**So no gate was added.** If the client wants one, the enforcement point already exists — the
responsible-gaming guard pattern — and it would be a small additive change.

## 5. Audit

Every submission and every decision is written through the **existing** `AuditService`:
actor, subject user, action, old status, new status, reason. Document **types** are recorded;
**contents are never logged** (asserted by test against `base64`, `data:image`, `fileUrl`,
`storageKey`, `password`, `token`).

## 6. Evidence

| Check | Result |
|---|---|
| Integration vs real Postgres | **24 passed** |
| Live HTTP verification | included in the **56/56** 2D.3 live run |
| Frontend unit | included in the **25** KYC+support tests |
| Mobile certification | 375/390/412 — included in **21/21** |
| Restart persistence | verified (full app-context rebuild) |
| Financial safety | ledger byte-identical before/after submit + review + list |
