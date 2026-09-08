'use client';

/**
 * KYC submission — the REAL, server-decided identity verification flow.
 *
 * The client sends a level and DOCUMENT METADATA. It never sends a status, reviewer or verified
 * flag, and the server would reject those anyway: verification is decided only by an authorised
 * reviewer. Nothing here fakes a verified state.
 *
 * File CONTENT upload is not available in this deployment — no object storage is configured. The
 * server declares that in `unavailable`, and this component shows the reason rather than presenting
 * a file picker that would silently discard the file.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  KYC_DOCUMENT_TYPES,
  KYC_LEVELS,
  kycApi,
  type KycDocumentType,
  type KycLevel,
} from '@/lib/kyc-api';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};
const FIELD: React.CSSProperties = {
  minHeight: 44, padding: '10px', borderRadius: 10, border: '1px solid #b9c1d4',
  background: '#ebeef5', color: '#1b1f37', fontSize: 14, width: '100%', boxSizing: 'border-box',
};

const STATUS_TEXT: Record<string, string> = {
  NOT_STARTED: 'Not started',
  PENDING: 'Submitted — awaiting review',
  IN_REVIEW: 'Under review',
  APPROVED: 'Verified',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
};

const STATUS_COLOR: Record<string, string> = {
  NOT_STARTED: '#515970', PENDING: '#8a5300', IN_REVIEW: '#1d4ed8',
  APPROVED: '#0f7a4a', REJECTED: '#b42318', EXPIRED: '#8a5300',
};

const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

export function KycSubmission() {
  const qc = useQueryClient();
  const [level, setLevel] = useState<KycLevel>('BASIC');
  const [docType, setDocType] = useState<KycDocumentType>('PASSPORT');
  const [fileName, setFileName] = useState('');
  const [mimeType, setMimeType] = useState('image/jpeg');
  const [size, setSize] = useState('');

  const status = useQuery({ queryKey: ['kyc', 'status'], queryFn: kycApi.status });

  const submit = useMutation({
    mutationFn: () =>
      kycApi.submit({
        level,
        documents: [{ type: docType, fileName: fileName.trim(), mimeType, size: Number(size) }],
      }),
    onSuccess: () => {
      setFileName(''); setSize('');
      qc.invalidateQueries({ queryKey: ['kyc', 'status'] });
    },
  });

  const d = status.data;

  return (
    <div data-testid="kyc-submission" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {status.isLoading ? (
        <div data-testid="kyc-loading" style={{ ...PANEL, height: 70 }} />
      ) : status.isError ? (
        <div data-testid="kyc-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
          Could not load your verification status. Please try again.
        </div>
      ) : d ? (
        <>
          <section style={{ ...PANEL, minWidth: 0 }} data-testid="kyc-status">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 15 }}>Identity verification</strong>
              <span data-testid="kyc-status-value" style={{ fontSize: 13, color: STATUS_COLOR[d.status] ?? '#515970', fontWeight: 700 }}>
                {STATUS_TEXT[d.status] ?? d.status}
              </span>
            </div>
            {d.submittedAt ? (
              <div style={{ fontSize: 11, color: '#515970', marginTop: 6 }}>
                Submitted {new Date(d.submittedAt).toLocaleString()}
                {d.reviewedAt ? ` · Reviewed ${new Date(d.reviewedAt).toLocaleString()}` : ''}
              </div>
            ) : null}

            {d.rejectionReason ? (
              <div data-testid="kyc-rejection" role="alert"
                   style={{ marginTop: 10, padding: 10, borderRadius: 10, border: '1px solid #f0b4b0',
                            fontSize: 12, color: '#b42318', lineHeight: 1.6, overflowWrap: 'anywhere' }}>
                <strong>Why it was rejected:</strong> {d.rejectionReason}
              </div>
            ) : null}

            {d.documents.length > 0 ? (
              <ul data-testid="kyc-documents" style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {d.documents.map((doc) => (
                  <li key={doc.id} style={{ fontSize: 12, opacity: 0.8, overflowWrap: 'anywhere' }}>
                    {label(doc.type)} — {label(doc.status)}
                    {doc.fileName ? ` (${doc.fileName})` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {d.unavailable.length > 0 ? (
            <section data-testid="kyc-unavailable" style={{ ...PANEL, borderColor: '#fff7e6', minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#8a5300', marginBottom: 6 }}>
                What we cannot do yet
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6, opacity: 0.85 }}>
                {d.unavailable.map((u) => (
                  <li key={u.capability} style={{ overflowWrap: 'anywhere' }}>{u.reason}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {d.canSubmit ? (
            <section style={{ ...PANEL, minWidth: 0 }} data-testid="kyc-form">
              <h3 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 4px' }}>
                {d.status === 'REJECTED' ? 'Resubmit your documents' : 'Submit your documents'}
              </h3>
              <p style={{ fontSize: 11, color: '#515970', margin: '0 0 10px', lineHeight: 1.5 }}>
                Our compliance team reviews every submission. We will never mark you verified automatically.
              </p>

              <label style={{ display: 'block', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#515970' }}>Verification level</span>
                <select data-testid="kyc-level" value={level} onChange={(e) => setLevel(e.target.value as KycLevel)} style={FIELD}>
                  {KYC_LEVELS.map((l) => <option key={l} value={l}>{label(l)}</option>)}
                </select>
              </label>

              <label style={{ display: 'block', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#515970' }}>Document type</span>
                <select data-testid="kyc-doc-type" value={docType} onChange={(e) => setDocType(e.target.value as KycDocumentType)} style={FIELD}>
                  {KYC_DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                </select>
              </label>

              <label style={{ display: 'block', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: '#515970' }}>File name</span>
                <input data-testid="kyc-file-name" value={fileName} onChange={(e) => setFileName(e.target.value)}
                       placeholder="passport.jpg" style={FIELD} />
              </label>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                <label style={{ flex: '1 1 140px' }}>
                  <span style={{ fontSize: 11, color: '#515970' }}>File type</span>
                  <select data-testid="kyc-mime" value={mimeType} onChange={(e) => setMimeType(e.target.value)} style={FIELD}>
                    <option value="image/jpeg">JPEG</option>
                    <option value="image/png">PNG</option>
                    <option value="image/webp">WebP</option>
                    <option value="application/pdf">PDF</option>
                  </select>
                </label>
                <label style={{ flex: '1 1 120px' }}>
                  <span style={{ fontSize: 11, color: '#515970' }}>Size (bytes)</span>
                  <input data-testid="kyc-size" inputMode="numeric" value={size}
                         onChange={(e) => setSize(e.target.value)} placeholder="120000" style={FIELD} />
                </label>
              </div>

              <button
                data-testid="kyc-submit"
                onClick={() => submit.mutate()}
                disabled={!fileName.trim() || !Number(size) || submit.isPending}
                style={{ ...FIELD, minHeight: 44, fontWeight: 700, cursor: 'pointer',
                         border: '1px solid #86c9a6', background: '#e6f6ee',
                         opacity: !fileName.trim() || !Number(size) ? 0.6 : 1 }}
              >
                {submit.isPending ? 'Submitting…' : 'Submit for review'}
              </button>

              {submit.isError ? (
                <p data-testid="kyc-submit-error" role="alert" style={{ fontSize: 12, color: '#b42318', margin: '8px 0 0' }}>
                  Could not submit. Nothing was sent — check the file details and try again.
                </p>
              ) : null}
            </section>
          ) : (
            <p data-testid="kyc-cannot-submit" style={{ fontSize: 12, color: '#515970', margin: '0 4px', lineHeight: 1.5 }}>
              {d.status === 'APPROVED'
                ? 'Your identity is verified. No further action is needed.'
                : 'Your submission is with our compliance team. You will be notified when it is reviewed.'}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
