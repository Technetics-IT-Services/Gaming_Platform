import { apiClient, unwrap } from './api-client';

/**
 * KYC API client.
 *
 * Verification status is decided ONLY by the server. The client sends a level and document
 * metadata; it never sends — and the server never accepts — a status, reviewer or verified flag.
 *
 * Document FILE upload is not available in this deployment (no object storage is configured). The
 * server says so in `unavailable`, and the UI shows that rather than pretending a file was stored.
 */

export const KYC_LEVELS = ['BASIC', 'INTERMEDIATE', 'ADVANCED'] as const;
export const KYC_DOCUMENT_TYPES = [
  'PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE', 'UTILITY_BILL', 'BANK_STATEMENT', 'PROOF_OF_ADDRESS', 'SELFIE',
] as const;

export type KycLevel = (typeof KYC_LEVELS)[number];
export type KycDocumentType = (typeof KYC_DOCUMENT_TYPES)[number];
export type KycStatus = 'NOT_STARTED' | 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export interface KycDocument {
  id: string;
  type: KycDocumentType;
  status: 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  fileName: string | null;
  mimeType: string | null;
  createdAt: string;
}

export interface KycView {
  status: KycStatus;
  level: KycLevel | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  /** Populated only when REJECTED. */
  rejectionReason: string | null;
  canSubmit: boolean;
  documents: KycDocument[];
  /** What this deployment genuinely cannot do, stated by the server. */
  unavailable: { capability: string; reason: string }[];
}

export interface KycDocumentInput {
  type: KycDocumentType;
  fileName: string;
  mimeType: string;
  size: number;
  checksum?: string;
}

export const kycApi = {
  status: () => unwrap<KycView>(apiClient.get('/kyc')),

  submit: (input: { level: KycLevel; documents: KycDocumentInput[] }) =>
    unwrap<KycView>(apiClient.post('/kyc', input)),
};

/* ------------------------------------------------------------- operator API */

/**
 * Operator KYC review (Phase 2D.12, AD-11).
 *
 * Guarded by `users:verify`. The reviewer decides IN_REVIEW / APPROVED / REJECTED and supplies a
 * reason — that decision **is** the requirement, so nothing here invents a threshold or an
 * automatic rule. Every decision is audited server-side against the reviewer.
 *
 * Document FILE BYTES remain unavailable (no object storage). The metadata lifecycle is complete,
 * and the server declares the gap rather than pretending an image exists.
 */
export type KycDecision = 'IN_REVIEW' | 'APPROVED' | 'REJECTED';

export interface KycQueueRow {
  id: string;
  userId: string;
  status: string;
  level: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  documentCount: number;
}

export interface KycQueuePage {
  items: KycQueueRow[];
  total: number;
  page: number;
  limit: number;
}

export const adminKycApi = {
  list: (params: { status?: string; page?: number; limit?: number } = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && q.set(k, String(v)));
    const s = q.toString();
    return unwrap<KycQueuePage>(apiClient.get(`/admin/kyc${s ? `?${s}` : ''}`));
  },

  get: (id: string) => unwrap<Record<string, unknown>>(apiClient.get(`/admin/kyc/${id}`)),

  /** A rejection must carry a reason; the server enforces a minimum length. */
  review: (id: string, decision: KycDecision, reason?: string) =>
    unwrap<Record<string, unknown>>(
      apiClient.post(`/admin/kyc/${id}/review`, reason ? { decision, reason } : { decision }),
    ),
};
