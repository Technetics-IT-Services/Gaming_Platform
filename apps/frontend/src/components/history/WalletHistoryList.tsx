'use client';

/**
 * WalletHistoryList — server-authoritative wallet transaction history (Phase 2C.4), mobile-first.
 *
 * Every value is the backend's: amount, balanceBefore and balanceAfter are STORED (never derived on
 * the client), plus reference + timestamp. No demo wallet. Compact transaction cards (no wide
 * tables), sticky filters (type / currency / date range), loading / empty / error states, prev/next
 * pagination. No horizontal overflow at 375/390/412.
 */
import { useWalletHistory } from './use-wallet-history';

const TYPES = ['', 'BET', 'WIN', 'RESERVE', 'DEPOSIT', 'WITHDRAWAL', 'BONUS', 'REFUND'];

function fmt(ts: string): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function WalletHistoryList() {
  const g = useWalletHistory();

  return (
    <div style={{ color: '#1b1f37', maxWidth: 480, margin: '0 auto', padding: '0 4px 24px', boxSizing: 'border-box' }}>
      {/* sticky filters */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#ebeef5', padding: '10px 4px', borderBottom: '1px solid #ccd2e0', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <select data-testid="filter-type" value={g.filters.type ?? ''} onChange={(e) => g.setFilter({ type: e.target.value || undefined })} style={sel}>
            {TYPES.map((t) => <option key={t} value={t}>{t === '' ? 'All types' : t}</option>)}
          </select>
          <input data-testid="filter-currency" value={g.filters.currency ?? ''} onChange={(e) => g.setFilter({ currency: e.target.value.toUpperCase() || undefined })} placeholder="Currency" style={{ ...sel, width: 92 }} />
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input data-testid="filter-from" type="date" value={(g.filters.from ?? '').slice(0, 10)} onChange={(e) => g.setFilter({ from: e.target.value ? `${e.target.value}T00:00:00.000Z` : undefined })} style={{ ...sel, flex: 1 }} aria-label="from" />
          <input data-testid="filter-to" type="date" value={(g.filters.to ?? '').slice(0, 10)} onChange={(e) => g.setFilter({ to: e.target.value ? `${e.target.value}T23:59:59.999Z` : undefined })} style={{ ...sel, flex: 1 }} aria-label="to" />
          <button onClick={g.clearFilters} style={{ ...sel, cursor: 'pointer' }}>Clear</button>
        </div>
      </div>

      {g.error && <div data-testid="error" style={{ color: '#b42318', fontSize: 13, margin: '10px 2px' }}>⚠ {g.error}</div>}
      {g.loading && <div data-testid="loading" style={{ color: '#515970', fontSize: 13, padding: 24, textAlign: 'center' }}>Loading…</div>}
      {g.isEmpty && !g.error && <div data-testid="empty" style={{ color: '#515970', fontSize: 13, padding: 32, textAlign: 'center' }}>No transactions match these filters.</div>}

      {/* transaction cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {g.items.map((t) => {
          const up = Number(t.balanceAfter) >= Number(t.balanceBefore);
          return (
            <div key={t.id} data-testid="txn-card" style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{t.type} <span style={{ color: '#626a7e', fontWeight: 400 }}>· {t.status}</span></span>
                <span style={{ fontSize: 15, fontWeight: 800, color: up ? '#0f7a4a' : '#b42318' }}>{up ? '+' : '−'}{t.amount} {t.currency}</span>
              </div>
              <div style={{ fontSize: 11, marginTop: 4 }}>bal {t.balanceBefore} → <b style={{ color: '#1b1f37' }}>{t.balanceAfter}</b></div>
              <div style={{ fontSize: 10, color: '#626a7e', marginTop: 3, wordBreak: 'break-all' }}>{t.reference} · {fmt(t.createdAt)}</div>
            </div>
          );
        })}
      </div>

      {/* pager */}
      {g.pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <button data-testid="prev" onClick={g.prev} disabled={g.page <= 1} style={pager(g.page <= 1)}>‹ Prev</button>
          <span style={{ fontSize: 12, color: '#515970' }}>Page {g.page} / {g.pages} · {g.total} total</span>
          <button data-testid="next" onClick={g.next} disabled={g.page >= g.pages} style={pager(g.page >= g.pages)}>Next ›</button>
        </div>
      )}
    </div>
  );
}

const sel: React.CSSProperties = { padding: '9px 10px', borderRadius: 9, border: '1px solid #b9c1d4', background: '#ffffff', color: '#1b1f37', fontSize: 13 };
const card: React.CSSProperties = { border: '1px solid #ccd2e0', borderRadius: 12, padding: '10px 12px', background: '#ebeef5' };
function pager(disabled: boolean): React.CSSProperties {
  return { padding: '10px 16px', borderRadius: 10, border: '1px solid #b9c1d4', background: disabled ? '#ccd2e0' : '#7c3aed', color: disabled ? '#4a5164' : '#fff', fontWeight: 700, fontSize: 14, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 };
}

export default WalletHistoryList;
