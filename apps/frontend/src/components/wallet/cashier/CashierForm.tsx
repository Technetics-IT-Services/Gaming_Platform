'use client';

/**
 * CashierForm — shared mobile-first deposit/withdrawal flow (Phase 2C.9). Server-authoritative: the
 * balance and request lists come from the server; deposits are PENDING (no fake credit), withdrawals
 * hold funds immediately. No demo wallet. Large touch targets, sticky balance, one-hand reachable CTA.
 * Fits 375/390/412 with no horizontal overflow.
 */
import Link from 'next/link';

import { useCashier } from './use-cashier';
import type { DepositRequestView, WithdrawalRequestView } from '@/lib/cashier-api';

const QUICK: Record<'deposit' | 'withdrawal', string[]> = {
  deposit: ['100', '500', '1000', '5000'],
  withdrawal: ['100', '500', '1000'],
};

const CANCELLABLE = new Set(['PENDING', 'UNDER_REVIEW']);

function statusColor(s: string): string {
  if (s === 'COMPLETED') return '#0f7a4a';
  if (s === 'FAILED' || s === 'REJECTED' || s === 'CANCELLED' || s === 'EXPIRED') return '#b42318';
  return '#8a5300'; // pending-ish
}

export function CashierForm({ kind }: { kind: 'deposit' | 'withdrawal' }) {
  const c = useCashier(kind);
  const isDeposit = kind === 'deposit';
  const min = c.config ? (isDeposit ? c.config.minDeposit : c.config.minWithdrawal) : 1;
  const max = c.config ? (isDeposit ? c.config.maxDeposit : c.config.maxWithdrawal) : 100000;
  const amt = Number(c.amount);
  const valid = Number.isFinite(amt) && amt >= min && amt <= max && (!isDeposit ? amt <= Number(c.balance ?? 0) : true);
  const rows: Array<DepositRequestView | WithdrawalRequestView> = isDeposit ? c.deposits : c.withdrawals;

  return (
    <div style={{ color: '#1b1f37', maxWidth: 460, margin: '0 auto', padding: '0 12px 24px', boxSizing: 'border-box' }}>
      {/* sticky authoritative balance */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#ebeef5', padding: '12px', borderRadius: 14, border: '1px solid #ccd2e0', marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: '#515970' }}>Available balance</div>
        <b data-testid="balance" style={{ fontSize: 30, color: '#0f7a4a', fontWeight: 900 }}>{c.balance === null ? '—' : `₹${c.balance}`}</b>
      </div>

      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '4px 2px 10px' }}>{isDeposit ? 'Deposit' : 'Withdraw'}</h1>

      {/* quick chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {QUICK[kind].map((q) => (
          <button key={q} data-testid={`quick-${q}`} onClick={() => c.setAmount(q)} aria-pressed={c.amount === q}
            style={{ flex: '1 0 22%', minWidth: 72, padding: '13px 8px', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer', border: c.amount === q ? '2px solid #8a5300' : '1px solid #b9c1d4', background: c.amount === q ? '#fff7e6' : '#ffffff', color: '#1b1f37' }}>₹{q}</button>
        ))}
      </div>

      {/* amount input */}
      <div style={{ position: 'relative', marginBottom: 6 }}>
        <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 20, fontWeight: 800, color: '#515970' }}>₹</span>
        <input data-testid="amount" inputMode="numeric" value={c.amount} onChange={(e) => c.setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="Enter amount"
          style={{ width: '100%', padding: '16px 14px 16px 34px', borderRadius: 14, border: '1px solid #b9c1d4', background: '#ffffff', color: '#1b1f37', fontSize: 22, fontWeight: 800, boxSizing: 'border-box' }} />
      </div>
      <div style={{ fontSize: 12, color: '#515970', margin: '0 2px 12px' }}>Min ₹{min} · Max ₹{max}{!isDeposit && c.balance !== null ? ` · Available ₹${c.balance}` : ''}</div>

      {c.error && <div data-testid="error" style={{ color: '#b42318', fontSize: 13, margin: '0 2px 10px' }}>⚠ {c.error}</div>}
      {c.notice && <div data-testid="notice" style={{ color: '#1d4ed8', fontSize: 13, margin: '0 2px 10px' }}>ℹ {c.notice}</div>}

      <button data-testid="submit" onClick={c.submit} disabled={c.submitting || c.balance === null || !valid}
        style={{ width: '100%', padding: '17px', borderRadius: 14, border: 'none', background: !valid ? '#cbd2e0' : c.submitting ? '#3730a3' : (isDeposit ? '#7c3aed' : '#0369a1'), color: !valid ? '#4a5164' : 'white', fontWeight: 900, fontSize: 18, cursor: 'pointer' }}>
        {c.submitting ? 'Submitting…' : isDeposit ? `Deposit ₹${c.amount || '0'}` : `Withdraw ₹${c.amount || '0'}`}
      </button>

      <p style={{ fontSize: 12, color: '#626a7e', textAlign: 'center', margin: '10px 0 4px' }}>
        {isDeposit
          ? 'Deposits are reviewed and confirmed by an operator — your balance updates once completed. No card is charged here.'
          : 'Funds are placed on hold immediately and released to you after review. Cancel a pending request to get them back.'}
      </p>

      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <Link href={isDeposit ? '/withdraw' : '/deposit'} style={{ color: '#1d4ed8', fontSize: 13, textDecoration: 'none' }}>{isDeposit ? 'Withdraw funds →' : 'Deposit funds →'}</Link>
      </div>

      {/* recent requests */}
      <section style={{ marginTop: 12, borderTop: '1px solid #ccd2e0', paddingTop: 12 }}>
        <h2 style={{ fontSize: 13, color: '#515970', margin: '0 2px 8px' }}>Recent {isDeposit ? 'deposits' : 'withdrawals'}</h2>
        {rows.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#626a7e', fontSize: 13, padding: '16px 0' }}>No requests yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((r) => (
              <div key={r.id} data-testid={`req-${r.id}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px', borderRadius: 12, background: '#ffffff', border: '1px solid #ccd2e0' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: isDeposit ? '#0f7a4a' : '#1b1f37' }}>{isDeposit ? '+' : '−'}₹{r.amount}</div>
                  <div style={{ fontSize: 11, color: '#626a7e' }}>{new Date(r.createdAt).toLocaleString()}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: statusColor(r.status) }}>{r.status.replace('_', ' ')}</span>
                  {!isDeposit && CANCELLABLE.has(r.status) && (
                    <button data-testid={`cancel-${r.id}`} onClick={() => c.cancel(r.id)} disabled={c.cancelling}
                      style={{ padding: '7px 10px', borderRadius: 9, border: '1px solid #b9c1d4', background: '#ebeef5', color: '#b42318', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default CashierForm;
