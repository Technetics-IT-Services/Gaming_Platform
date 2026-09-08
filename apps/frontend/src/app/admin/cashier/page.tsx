'use client';

/**
 * Operator cashier console (Phase 2D.12) — P-05, P-06, F-01.
 *
 * THE GAP THIS CLOSES. The deposit model is operator-credited: a player requests a deposit, it sits
 * PENDING, and an operator completes it — which credits the wallet through the ledger. With the
 * payment gateway deliberately deferred, **this is the deposit rail.** The five endpoints behind it
 * were guarded, audited and idempotent, but had no screen, so no deposit could be credited and no
 * withdrawal paid without hand-crafting an authenticated request.
 *
 * THE OPERATOR NEVER TYPES AN AMOUNT. Every figure comes from the player's own request; the
 * operator decides yes or no. There is no amount field anywhere on this page, by design.
 *
 * READING vs ACTING are separately permissioned: the queue needs `transactions:read`, every action
 * needs `wallets:adjust`. A finance reviewer sees the work without being able to move money.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { cashierAdminApi } from '@/lib/cashier-admin-api';
import { financeOpsApi, type CashierQueueItem } from '@/lib/finance-ops-api';
import { useAuthStore } from '@/stores/auth-store';

const PANEL: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #ccd2e0', borderRadius: 14, padding: 14,
};
const FIELD: React.CSSProperties = {
  minHeight: 44, padding: '10px', borderRadius: 10, border: '1px solid #b9c1d4',
  background: '#ebeef5', color: '#1b1f37', fontSize: 14, width: '100%', boxSizing: 'border-box',
};
const BTN = (bg: string, border: string): React.CSSProperties => ({
  ...FIELD, width: 'auto', minWidth: 104, fontSize: 12, fontWeight: 700,
  cursor: 'pointer', background: bg, border: `1px solid ${border}`,
});
const TH: React.CSSProperties = {
  textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #ccd2e0',
  whiteSpace: 'nowrap', color: '#515970',
};
const TD: React.CSSProperties = {
  padding: '10px 12px', borderBottom: '1px solid #ffffff', whiteSpace: 'nowrap',
};

const STATUS_COLOR: Record<string, string> = {
  PENDING: '#8a5300', PROCESSING: '#1d4ed8', UNDER_REVIEW: '#1d4ed8', APPROVED: '#0f7a4a',
};

const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

type Kind = 'deposits' | 'withdrawals';

export default function AdminCashierPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isDemoSession = useAuthStore((s) => s.isDemoSession);
  // Acting on the queue is the same authority as any other wallet adjustment.
  const mayAct = !isDemoSession && (user?.permissions ?? []).includes('wallets:adjust');

  const [kind, setKind] = useState<Kind>('deposits');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);

  const queue = useQuery({
    queryKey: ['admin', 'cashier', kind, page],
    queryFn: () => financeOpsApi.cashierQueue({ kind, page, limit: 50 }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'cashier'] });
    // The finance console's queue counts are derived from the same rows.
    qc.invalidateQueries({ queryKey: ['finance'] });
  };

  const act = useMutation({
    mutationFn: (v: { action: string; id: string; reason?: string }) => {
      switch (v.action) {
        case 'complete-deposit': return cashierAdminApi.completeDeposit(v.id);
        case 'reject-deposit': return cashierAdminApi.rejectDeposit(v.id, v.reason ?? '');
        case 'approve-withdrawal': return cashierAdminApi.approveWithdrawal(v.id);
        case 'complete-withdrawal': return cashierAdminApi.completeWithdrawal(v.id);
        case 'reject-withdrawal': return cashierAdminApi.rejectWithdrawal(v.id, v.reason ?? '');
        default: throw new Error('unknown action');
      }
    },
    onSuccess: (_d, v) => {
      setNotice(`${label(v.action)} applied.`);
      setRejecting(null);
      invalidate();
    },
    onError: () => setNotice(null),
  });

  const d = queue.data;

  return (
    <div
      data-testid="admin-cashier"
      style={{
        color: '#1b1f37', width: '100%', maxWidth: 1150, minWidth: 0,
        margin: '0 auto', padding: '4px 0 28px', boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 4px' }}>Cashier</h1>
      <p style={{ fontSize: 12, color: '#515970', margin: '0 2px 14px', lineHeight: 1.5 }}>
        {mayAct
          ? 'Amounts come from the player’s request — you decide whether to approve, not how much.'
          : 'Read-only: acting on the cashier queue requires wallet-adjust permission. The server refuses these actions from this account.'}
      </p>

      {/* ------------------------------------------------------- queue switch */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {(['deposits', 'withdrawals'] as Kind[]).map((k) => (
          <button
            key={k}
            data-testid={`cashier-tab-${k}`}
            onClick={() => { setKind(k); setPage(1); setRejecting(null); }}
            style={{
              ...FIELD, width: 'auto', minWidth: 140, fontWeight: 700, cursor: 'pointer',
              background: kind === k ? '#e8efff' : '#ebeef5',
              border: `1px solid ${kind === k ? '#e8efff' : '#b9c1d4'}`,
            }}
          >
            {k === 'deposits' ? 'Deposits' : 'Withdrawals'}
          </button>
        ))}
      </div>

      {queue.isLoading ? (
        <div data-testid="cashier-loading" style={{ ...PANEL, height: 100 }} />
      ) : queue.isError ? (
        <div data-testid="cashier-error" role="alert" style={{ ...PANEL, borderColor: '#f0b4b0', color: '#b42318' }}>
          Could not load the cashier queue.
        </div>
      ) : d ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {notice ? (
            <span data-testid="cashier-notice" role="status" style={{ fontSize: 12, color: '#0f7a4a' }}>{notice}</span>
          ) : null}
          {act.isError ? (
            <span data-testid="cashier-action-error" role="alert" style={{ fontSize: 12, color: '#b42318' }}>
              That action was refused by the server and was NOT applied.
            </span>
          ) : null}

          <div style={{ fontSize: 11, color: '#515970' }}>
            {d.total} awaiting a decision · {d.statuses.map(label).join(', ')} · oldest first
          </div>

          {d.items.length === 0 ? (
            <div data-testid="cashier-empty" style={{ ...PANEL, fontSize: 13, color: '#515970' }}>
              Nothing is waiting for a decision.
            </div>
          ) : (
            <div style={{ ...PANEL, padding: 0, overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
              <table data-testid="cashier-table" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 780, fontSize: 12 }}>
                <thead>
                  <tr>
                    {['Requested', 'Player', 'Amount', 'Currency', 'Status', 'Reference',
                      ...(mayAct ? ['Decision'] : [])].map((h) => (
                        <th key={h} style={TH}>{h}</th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((item) => (
                    <Row
                      key={item.id}
                      item={item}
                      kind={kind}
                      mayAct={mayAct}
                      pending={act.isPending}
                      onAct={(action) => act.mutate({ action, id: item.id })}
                      onReject={() => setRejecting({ id: item.id, reason: '' })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ------------------------------------------------ rejection reason */}
          {rejecting ? (
            <section data-testid="cashier-reject-panel" style={{ ...PANEL, borderColor: '#f0b4b0', minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
                Reason for rejection
              </div>
              <p style={{ fontSize: 11, color: '#515970', margin: '0 0 10px', lineHeight: 1.5 }}>
                {kind === 'withdrawals'
                  ? 'Rejecting refunds the held funds back to the player. The reason is recorded against the request.'
                  : 'Rejecting moves no money. The reason is recorded against the request.'}
              </p>
              <input
                data-testid="cashier-reject-reason"
                value={rejecting.reason}
                onChange={(e) => setRejecting({ ...rejecting, reason: e.target.value })}
                placeholder="Why is this being rejected?"
                style={FIELD}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button
                  data-testid="cashier-reject-confirm"
                  disabled={rejecting.reason.trim().length < 3 || act.isPending}
                  onClick={() => act.mutate({
                    action: kind === 'deposits' ? 'reject-deposit' : 'reject-withdrawal',
                    id: rejecting.id,
                    reason: rejecting.reason.trim(),
                  })}
                  style={{ ...BTN('#fef2f2', '#f0b4b0'), opacity: rejecting.reason.trim().length < 3 ? 0.6 : 1 }}
                >
                  Confirm rejection
                </button>
                <button
                  data-testid="cashier-reject-cancel"
                  onClick={() => setRejecting(null)}
                  style={BTN('#ebeef5', '#b9c1d4')}
                >
                  Cancel
                </button>
              </div>
            </section>
          ) : null}

          {/* Paging — a capped queue that silently hid new work was a real defect; the count and
              these controls make the rest of the backlog reachable. */}
          {d.total > d.limit ? (
            <div data-testid="cashier-paging" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                data-testid="cashier-prev"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{ ...BTN('#ebeef5', '#b9c1d4'), opacity: page <= 1 ? 0.5 : 1 }}
              >
                Previous
              </button>
              <span style={{ fontSize: 11, color: '#515970' }}>
                page {d.page} of {Math.max(1, Math.ceil(d.total / d.limit))}
              </span>
              <button
                data-testid="cashier-next"
                disabled={page >= Math.ceil(d.total / d.limit)}
                onClick={() => setPage((p) => p + 1)}
                style={{ ...BTN('#ebeef5', '#b9c1d4'), opacity: page >= Math.ceil(d.total / d.limit) ? 0.5 : 1 }}
              >
                Next
              </button>
            </div>
          ) : null}

          {/* The server's own description of what these actions do. Printed, not paraphrased. */}
          <p data-testid="cashier-note" style={{ fontSize: 11, color: '#515970', margin: '0 2px', lineHeight: 1.55 }}>
            {d.note}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Row({
  item, kind, mayAct, pending, onAct, onReject,
}: {
  item: CashierQueueItem;
  kind: Kind;
  mayAct: boolean;
  pending: boolean;
  onAct: (action: string) => void;
  onReject: () => void;
}) {
  return (
    <tr data-testid={`cashier-row-${item.id}`}>
      <td style={TD}>{new Date(item.requestedAt).toLocaleString()}</td>
      <td style={{ ...TD, overflowWrap: 'anywhere', whiteSpace: 'normal', maxWidth: 160 }}>{item.username}</td>
      {/* The amount is displayed, never editable. */}
      <td style={TD}>{item.amount}</td>
      <td style={TD}>{item.currency}</td>
      <td style={{ ...TD, color: STATUS_COLOR[item.status] ?? '#1b1f37' }}>{label(item.status)}</td>
      <td style={{ ...TD, overflowWrap: 'anywhere', whiteSpace: 'normal', maxWidth: 190 }}>{item.reference}</td>
      {mayAct ? (
        <td style={TD}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {kind === 'deposits' ? (
              <button
                data-testid={`cashier-complete-${item.id}`}
                disabled={pending}
                onClick={() => onAct('complete-deposit')}
                style={BTN('#e6f6ee', '#86c9a6')}
              >
                Credit
              </button>
            ) : (
              <>
                {item.status === 'PENDING' || item.status === 'UNDER_REVIEW' ? (
                  <button
                    data-testid={`cashier-approve-${item.id}`}
                    disabled={pending}
                    onClick={() => onAct('approve-withdrawal')}
                    style={BTN('#e8efff', '#e8efff')}
                  >
                    Approve
                  </button>
                ) : null}
                {item.status === 'APPROVED' ? (
                  <button
                    data-testid={`cashier-pay-${item.id}`}
                    disabled={pending}
                    onClick={() => onAct('complete-withdrawal')}
                    style={BTN('#e6f6ee', '#86c9a6')}
                  >
                    Mark paid
                  </button>
                ) : null}
              </>
            )}
            <button
              data-testid={`cashier-reject-${item.id}`}
              disabled={pending}
              onClick={onReject}
              style={BTN('#fef2f2', '#f0b4b0')}
            >
              Reject
            </button>
          </div>
        </td>
      ) : null}
    </tr>
  );
}
