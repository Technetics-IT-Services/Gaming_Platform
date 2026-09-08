'use client';

/**
 * PlinkoMoneyBoard — real-money Plinko (Phase 2C.6), mobile-first.
 *
 * Authenticated: the stake is played via the backend money bridge (`/games/plinko/play`); the landing
 * bin, multiplier, payout and balance are the authoritative server values (no demo wallet). The
 * multiplier slots come from the config API (never hardcoded). Sticky balance, rows/risk selectors,
 * stake chips, a slot row that fits 375px (no horizontal scroll), and a large Drop button. No
 * horizontal overflow at 375/390/412.
 */
import { usePlinkoMoney } from './use-plinko-money';

const STAKE_CHIPS = ['1', '5', '10', '25', '50'];
const RISKS: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];

function slotColor(mult: number): string {
  if (mult >= 10) return '#b91c1c';
  if (mult >= 2) return '#d97706';
  if (mult >= 1) return '#4338ca';
  return '#334155';
}

export function PlinkoMoneyBoard() {
  const g = usePlinkoMoney();
  const rowsOptions = g.config?.rows ?? [8, 10, 12, 14, 16];
  const min = g.config?.limits.min ?? 1;
  const max = g.config?.limits.max ?? 10000;
  const r = g.lastResult;

  return (
    <div style={{ color: '#e5e7eb', maxWidth: 460, margin: '0 auto', padding: '0 4px 24px', boxSizing: 'border-box' }}>
      {/* sticky authoritative balance */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0b0f19', padding: '10px 12px', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #1f2937', marginBottom: 12 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Balance</span>
        <b data-testid="balance" style={{ fontSize: 20, color: '#34d399' }}>{g.balance === null ? '—' : `₹${g.balance}`}</b>
      </div>

      {/* result */}
      <div style={{ textAlign: 'center', minHeight: 92, background: 'radial-gradient(ellipse at center,#1e1b4b,#0b0f19)', borderRadius: 16, padding: 14, marginBottom: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        {r ? (
          <>
            <div data-testid="multiplier" style={{ fontSize: 40, fontWeight: 900, color: r.multiplier >= 1 ? '#34d399' : '#fca5a5' }}>{r.multiplier}×</div>
            <div style={{ marginTop: 4, fontWeight: 800, fontSize: 15, color: Number(r.payout) >= Number(r.stake) ? '#34d399' : '#fca5a5' }}>
              {Number(r.payout) >= Number(r.stake) ? `WON ₹${r.payout}` : `₹${r.payout}`} · bin {r.bin}{r.replayed ? ' · (replayed)' : ''}
            </div>
          </>
        ) : (
          <div style={{ opacity: 0.6, fontSize: 13, paddingTop: 24 }}>Pick rows, risk &amp; stake, then Drop.</div>
        )}
      </div>

      {/* slot multipliers (from config) — fits width via fluid grid */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${g.table.length || 1}, 1fr)`, gap: 2, marginBottom: 12 }}>
        {g.table.map((m, i) => (
          <div key={i} style={{ padding: '6px 0', borderRadius: 4, background: slotColor(m), textAlign: 'center', fontSize: g.table.length > 13 ? 8 : 10, fontWeight: 700, border: r && r.bin === i ? '2px solid #fff' : 'none' }}>{m}</div>
        ))}
      </div>

      {/* rows selector */}
      <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Rows</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {rowsOptions.map((n) => (
          <button key={n} data-testid={`rows-${n}`} onClick={() => g.setRows(n)} style={chip(g.rows === n)} aria-pressed={g.rows === n}>{n}</button>
        ))}
      </div>

      {/* risk selector */}
      <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Risk</div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {RISKS.map((rk) => (
          <button key={rk} data-testid={`risk-${rk}`} onClick={() => g.setRisk(rk)} style={{ ...chip(g.risk === rk), flex: 1, textTransform: 'capitalize' }} aria-pressed={g.risk === rk}>{rk}</button>
        ))}
      </div>

      {/* stake selector */}
      <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Stake (₹{min}–₹{max})</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {STAKE_CHIPS.map((s) => (
          <button key={s} onClick={() => g.setStake(s)} style={chip(g.stake === s)} aria-pressed={g.stake === s}>₹{s}</button>
        ))}
        <input inputMode="decimal" value={g.stake} onChange={(e) => g.setStake(e.target.value.replace(/[^\d.]/g, ''))} aria-label="stake"
          style={{ width: 80, padding: '10px 12px', borderRadius: 10, border: '1px solid #334155', background: '#111827', color: '#e5e7eb', fontSize: 15 }} />
      </div>

      {g.error && <div data-testid="error" style={{ color: '#fca5a5', fontSize: 13, margin: '6px 2px' }}>⚠ {g.error}</div>}

      {/* drop — large one-hand tap target */}
      <button data-testid="drop" onClick={() => void g.play()} disabled={g.playing || g.balance === null}
        style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: g.playing ? '#3730a3' : '#7c3aed', color: 'white', fontWeight: 800, fontSize: 18, cursor: 'pointer' }}>
        {g.playing ? 'Dropping…' : `Drop ₹${g.stake}`}
      </button>

      <p style={{ fontSize: 11, opacity: 0.45, textAlign: 'center', marginTop: 10 }}>
        Real-money drop · provably fair · bin &amp; balance are authoritative from the server.
      </p>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return { padding: '10px 13px', minWidth: 44, borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700, border: active ? '2px solid #fbbf24' : '1px solid #334155', background: active ? '#78350f' : '#111827', color: '#e5e7eb' };
}

export default PlinkoMoneyBoard;
