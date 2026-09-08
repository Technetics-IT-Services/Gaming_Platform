'use client';

/**
 * Transactions (Phase 2C.9) — server-authoritative wallet history. Replaces the former demo-wallet
 * list; reads the real, stored `WalletTransaction` rows via `walletApi.history` (Phase 2C.4, JWT
 * identity). balanceBefore/After are stored values, never derived. Mobile-first; no demo wallet.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { RealAccountRequired } from '@/components/auth/real-money-guard';
import { useRealSession } from '@/hooks/use-real-session';
import { walletApi } from '@/lib/wallet-api';

const FILTERS = ['ALL', 'DEPOSIT', 'WITHDRAWAL', 'GAME_BET', 'GAME_WIN', 'REFUND'];

function amountColor(type: string): string {
  if (/WIN|DEPOSIT|REFUND|CREDIT/.test(type)) return '#0f7a4a';
  if (/BET|WITHDRAWAL|DEBIT|PENALTY/.test(type)) return '#b42318';
  return '#1b1f37';
}
function sign(type: string): string {
  return /WIN|DEPOSIT|REFUND|CREDIT/.test(type) ? '+' : /BET|WITHDRAWAL|DEBIT|PENALTY/.test(type) ? '−' : '';
}

export default function TransactionsPage() {
  const [type, setType] = useState('ALL');
  // User-scoped + real-money data: requires a REAL server session (never a demo one).
  const realSession = useRealSession();
  const q = useQuery({
    queryKey: ['transactions', type],
    queryFn: () => walletApi.history({ limit: 30, type: type === 'ALL' ? undefined : type }),
    enabled: realSession,
  });
  const rows = q.data?.items ?? [];

  // A demo session has no server wallet/ledger — show the real-account notice instead of an
  // endless empty state (the api-client blocks these endpoints for demo sessions regardless).
  if (!realSession) return <RealAccountRequired />;

  return (
    <div style={{ color: '#1b1f37', maxWidth: 460, margin: '0 auto', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 2px 10px' }}>Transactions</h1>

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 12, paddingBottom: 2 }}>
        {FILTERS.map((f) => (
          <button key={f} data-testid={`txfilter-${f}`} onClick={() => setType(f)} aria-pressed={type === f}
            style={{ flex: '0 0 auto', padding: '8px 13px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', border: type === f ? '2px solid #8a5300' : '1px solid #b9c1d4', background: type === f ? '#fff7e6' : '#ffffff', color: '#1b1f37' }}>
            {f.replace('_', ' ')}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 6 }, (_, i) => <div key={i} style={{ height: 64, borderRadius: 12, background: '#ffffff', border: '1px solid #ccd2e0' }} />)}
        </div>
      ) : rows.length === 0 ? (
        <div data-testid="tx-empty" style={{ textAlign: 'center', color: '#626a7e', fontSize: 14, padding: '40px 0' }}>No transactions to show.</div>
      ) : (
        <div data-testid="tx-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((t) => (
            <div key={t.id} style={{ padding: '12px', borderRadius: 12, background: '#ffffff', border: '1px solid #ccd2e0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 14 }}>{t.type.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: 11, color: '#626a7e' }}>{new Date(t.createdAt).toLocaleString()} · {t.status}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: amountColor(t.type) }}>{sign(t.type)}₹{t.amount}</div>
                  <div style={{ fontSize: 11, color: '#626a7e' }}>Bal ₹{t.balanceAfter}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
