'use client';

/**
 * GameHistoryList — server-authoritative game history (Phase 2C.4), mobile-first.
 *
 * Round cards show game / stake / payout / net result (WIN/LOSS/PUSH) / status / time / round id,
 * all from the backend (no client calculation, no demo wallet). Tap a card to open the round
 * traceability sheet. Sticky filters (game / status / date range), loading / empty / error states,
 * prev/next pagination. No horizontal overflow at 375/390/412.
 */
import { useState } from 'react';
import { useGameHistory } from './use-game-history';
import { RoundDetail } from './RoundDetail';

const GAMES = ['', 'dice', 'sic-bo', 'crash', 'roulette', 'baccarat', 'blackjack', 'number-lottery'];
const STATUSES = ['', 'SETTLED', 'RESERVED', 'PENDING_SETTLEMENT', 'RECOVERED', 'FAILED'];

function fmt(ts: string): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function GameHistoryList() {
  const g = useGameHistory();
  const [openRound, setOpenRound] = useState<string | null>(null);

  return (
    <div style={{ color: '#1b1f37', maxWidth: 480, margin: '0 auto', padding: '0 4px 24px', boxSizing: 'border-box' }}>
      {/* sticky filters */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#ebeef5', padding: '10px 4px', borderBottom: '1px solid #ccd2e0', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <select data-testid="filter-game" value={g.filters.gameKey ?? ''} onChange={(e) => g.setFilter({ gameKey: e.target.value || undefined })} style={sel}>
            {GAMES.map((t) => <option key={t} value={t}>{t === '' ? 'All games' : t}</option>)}
          </select>
          <select data-testid="filter-status" value={g.filters.status ?? ''} onChange={(e) => g.setFilter({ status: e.target.value || undefined })} style={sel}>
            {STATUSES.map((t) => <option key={t} value={t}>{t === '' ? 'All statuses' : t}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input data-testid="filter-from" type="date" value={(g.filters.from ?? '').slice(0, 10)} onChange={(e) => g.setFilter({ from: e.target.value ? `${e.target.value}T00:00:00.000Z` : undefined })} style={{ ...sel, flex: 1 }} aria-label="from" />
          <input data-testid="filter-to" type="date" value={(g.filters.to ?? '').slice(0, 10)} onChange={(e) => g.setFilter({ to: e.target.value ? `${e.target.value}T23:59:59.999Z` : undefined })} style={{ ...sel, flex: 1 }} aria-label="to" />
          <button onClick={g.clearFilters} style={{ ...sel, cursor: 'pointer' }}>Clear</button>
        </div>
      </div>

      {g.error && <div data-testid="error" style={{ color: '#b42318', fontSize: 13, margin: '10px 2px' }}>⚠ {g.error}</div>}
      {g.loading && <div data-testid="loading" style={{ color: '#515970', fontSize: 13, padding: 24, textAlign: 'center' }}>Loading…</div>}
      {g.isEmpty && !g.error && <div data-testid="empty" style={{ color: '#515970', fontSize: 13, padding: 32, textAlign: 'center' }}>No rounds match these filters.</div>}

      {/* round cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {g.items.map((r) => {
          const net = Number(r.netResult);
          const label = net > 0 ? 'WIN' : net < 0 ? 'LOSS' : 'PUSH';
          const color = net > 0 ? '#0f7a4a' : net < 0 ? '#b42318' : '#8a5300';
          return (
            <button key={r.roundId} data-testid="round-card" onClick={() => setOpenRound(r.roundId)} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'capitalize' }}>{r.gameKey} <span style={{ color: '#626a7e', fontWeight: 400 }}>· {r.betType}</span></span>
                <span style={{ fontSize: 13, fontWeight: 800, color }}>{label} {net >= 0 ? '+' : ''}{r.netResult}</span>
              </div>
              <div style={{ fontSize: 11, color: '#515970', marginTop: 4 }}>stake {r.stake} · payout {r.payout} · <span style={{  }}>{r.status}</span></div>
              <div style={{ fontSize: 10, color: '#626a7e', marginTop: 3 }}>{fmt(r.createdAt)} · tap for details</div>
            </button>
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

      {openRound && <RoundDetail roundId={openRound} onClose={() => setOpenRound(null)} />}
    </div>
  );
}

const sel: React.CSSProperties = { padding: '9px 10px', borderRadius: 9, border: '1px solid #b9c1d4', background: '#ffffff', color: '#1b1f37', fontSize: 13 };
const card: React.CSSProperties = { textAlign: 'left', width: '100%', border: '1px solid #ccd2e0', borderRadius: 12, padding: '10px 12px', background: '#ebeef5', color: '#1b1f37', cursor: 'pointer' };
function pager(disabled: boolean): React.CSSProperties {
  return { padding: '10px 16px', borderRadius: 10, border: '1px solid #b9c1d4', background: disabled ? '#ccd2e0' : '#7c3aed', color: disabled ? '#4a5164' : '#fff', fontWeight: 700, fontSize: 14, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 };
}

export default GameHistoryList;
