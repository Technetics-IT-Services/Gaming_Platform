'use client';

/**
 * RouletteMoneyBoard — real-money Roulette (Phase 2C.2), mobile-first.
 *
 * Authenticated: bets are collected then submitted as ONE spin via the backend money bridge
 * (`/games/roulette/play`); the winning pocket, payout and balance are the authoritative server
 * values (no demo wallet). Mobile interaction model: pick a chip, tap outside bets or numbers to
 * place, review the selected-bet summary + total, then Spin. The full engine bet board stays
 * accessible via a scrollable number grid — no supported bet is removed. No horizontal overflow
 * at 375/390/412.
 */
import { useRouletteMoney } from './use-roulette-money';

const CHIPS = ['1', '5', '10', '25', '100'];
const OUTSIDE: Array<{ type: string; label: string; selection?: number[] }> = [
  { type: 'red', label: 'Red' },
  { type: 'black', label: 'Black' },
  { type: 'odd', label: 'Odd' },
  { type: 'even', label: 'Even' },
  { type: 'low', label: '1–18' },
  { type: 'high', label: '19–36' },
  { type: 'dozen', label: '1st 12', selection: [1] },
  { type: 'dozen', label: '2nd 12', selection: [2] },
  { type: 'dozen', label: '3rd 12', selection: [3] },
  { type: 'column', label: 'Col 1', selection: [1] },
  { type: 'column', label: 'Col 2', selection: [2] },
  { type: 'column', label: 'Col 3', selection: [3] },
];

export function RouletteMoneyBoard() {
  const g = useRouletteMoney();
  const r = g.lastResult;
  const reds = g.config?.redNumbers ?? [];
  const maxNumber = g.config?.maxNumber ?? 36;
  const numbers = [0, ...Array.from({ length: maxNumber }, (_, i) => i + 1)];
  const numColor = (n: number) => (n === 0 ? '#166534' : reds.includes(n) ? '#b91c1c' : '#111827');

  return (
    <div style={{ color: '#e5e7eb', maxWidth: 460, margin: '0 auto', padding: '0 4px', boxSizing: 'border-box' }}>
      {/* sticky authoritative balance + total stake */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0b0f19', padding: '10px 12px', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #1f2937', marginBottom: 12 }}>
        <div><div style={{ fontSize: 11, opacity: 0.6 }}>Balance</div><b data-testid="balance" style={{ fontSize: 19, color: '#34d399' }}>{g.balance === null ? '—' : `₹${g.balance}`}</b></div>
        <div style={{ textAlign: 'right' }}><div style={{ fontSize: 11, opacity: 0.6 }}>Total stake</div><b data-testid="total-stake" style={{ fontSize: 19, color: '#fbbf24' }}>₹{g.total}</b></div>
      </div>

      {/* result */}
      <div style={{ textAlign: 'center', minHeight: 88, background: 'radial-gradient(ellipse at center,#0f5132,#062916)', borderRadius: 16, padding: 12, marginBottom: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        {r ? (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ width: 44, height: 44, borderRadius: '50%', background: r.color === 'red' ? '#b91c1c' : r.color === 'green' ? '#166534' : '#111827', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 20, border: '2px solid #fff' }}>{r.pocketLabel}</span>
              <span style={{ fontWeight: 800, fontSize: 16, color: Number(r.payout) > 0 ? '#34d399' : '#fca5a5' }}>{Number(r.payout) > 0 ? `WON +₹${r.payout}` : 'No win'}</span>
            </div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>{r.color} · {r.winningBets.length ? `hit: ${r.winningBets.join(', ')}` : 'no winning bets'}{r.replayed ? ' · (replayed)' : ''}</div>
          </>
        ) : (
          <div style={{ opacity: 0.6, fontSize: 13 }}>Pick a chip, place bets, then Spin.</div>
        )}
      </div>

      {/* chip selector */}
      <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Chip</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {CHIPS.map((c) => (
          <button key={c} onClick={() => g.setChip(c)} style={chip(g.chip === c)} aria-pressed={g.chip === c}>₹{c}</button>
        ))}
      </div>

      {/* outside bets */}
      <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Outside bets</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 10 }}>
        {OUTSIDE.map((b) => (
          <button key={b.label} onClick={() => g.place(b.type, b.selection)} style={outsideBtn()}>{b.label}</button>
        ))}
      </div>

      {/* number grid (straight bets) — scrollable, full board accessible */}
      <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Numbers (straight ×36)</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 5, marginBottom: 12, maxHeight: 210, overflowY: 'auto', padding: 2 }}>
        {numbers.map((n) => (
          <button key={n} data-testid={`num-${n}`} onClick={() => g.place('straight', [n])}
            style={{ padding: '10px 0', borderRadius: 8, border: '1px solid #334155', background: numColor(n), color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>{n}</button>
        ))}
      </div>

      {/* selected bets summary */}
      {g.bets.length > 0 && (
        <div style={{ border: '1px solid #1f2937', borderRadius: 12, padding: 10, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>Bets ({g.bets.length})</span>
            <button onClick={g.clearBets} style={{ fontSize: 12, color: '#fca5a5', background: 'none', border: 'none', cursor: 'pointer' }}>Clear all</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
            {g.bets.map((b, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                <span>{b.type}{b.selection ? ` [${b.selection.join(',')}]` : ''} · ₹{b.amount}</span>
                <button onClick={() => g.removeBet(i)} aria-label="remove bet" style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {g.error && <div data-testid="error" style={{ color: '#fca5a5', fontSize: 13, margin: '6px 2px' }}>⚠ {g.error}</div>}

      {/* spin — large one-hand tap target */}
      <button data-testid="spin" onClick={() => void g.spin()} disabled={g.spinning || g.balance === null || g.bets.length === 0}
        style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: g.spinning ? '#3730a3' : g.bets.length === 0 ? '#374151' : '#7c3aed', color: 'white', fontWeight: 800, fontSize: 18, cursor: 'pointer', marginTop: 4 }}>
        {g.spinning ? 'Spinning…' : g.bets.length === 0 ? 'Place a bet' : `Spin · ₹${g.total}`}
      </button>

      <p style={{ fontSize: 11, opacity: 0.45, textAlign: 'center', marginTop: 10 }}>
        Real-money spin · provably fair · pocket &amp; balance are authoritative from the server.
      </p>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return { padding: '11px 14px', minWidth: 52, borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700, border: active ? '2px solid #fbbf24' : '1px solid #334155', background: active ? '#78350f' : '#111827', color: '#e5e7eb' };
}
function outsideBtn(): React.CSSProperties {
  return { padding: '12px 4px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, border: '1px solid #334155', background: '#111827', color: '#e5e7eb' };
}

export default RouletteMoneyBoard;
