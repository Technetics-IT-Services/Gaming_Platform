'use client';

/**
 * BaccaratMoneyBoard — real-money Baccarat (Phase 2C.4), mobile-first.
 *
 * Authenticated: bets are collected then submitted as ONE deal via the backend money bridge
 * (`/games/baccarat/play`); the cards, winning side, payout and balance are the authoritative
 * server values (no demo wallet). Large touch-friendly PLAYER / BANKER / TIE controls, a chip
 * selector, selected-bet summary, total stake, and a big Deal button. No horizontal overflow at
 * 375/390/412.
 */
import { useBaccaratMoney } from './use-baccarat-money';

const CHIPS = ['1', '5', '10', '25', '100'];
const SIDES = [
  { key: 'player', label: 'PLAYER', color: '#2563eb' },
  { key: 'banker', label: 'BANKER', color: '#b91c1c' },
  { key: 'tie', label: 'TIE', color: '#166534' },
];

/** Render a 2-char card code (e.g. "AS", "TH") as a small playing card. */
function Card({ code }: { code: string }) {
  const rank = code.slice(0, code.length - 1).replace('T', '10');
  const suitCode = code.slice(-1);
  const suit = suitCode === 'H' ? '♥' : suitCode === 'D' ? '♦' : suitCode === 'C' ? '♣' : suitCode === 'S' ? '♠' : '★';
  const red = suitCode === 'H' || suitCode === 'D';
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 34, height: 46, borderRadius: 6, background: '#fff', color: red ? '#b91c1c' : '#111827', fontWeight: 800, border: '1px solid #cbd5e1' }}>
      <span style={{ fontSize: 14, lineHeight: 1 }}>{rank}</span>
      <span style={{ fontSize: 15, lineHeight: 1 }}>{suit}</span>
    </span>
  );
}

export function BaccaratMoneyBoard() {
  const g = useBaccaratMoney();
  const r = g.lastResult;

  return (
    <div style={{ color: '#e5e7eb', maxWidth: 460, margin: '0 auto', padding: '0 4px', boxSizing: 'border-box' }}>
      {/* sticky authoritative balance + total stake */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0b0f19', padding: '10px 12px', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #1f2937', marginBottom: 12 }}>
        <div><div style={{ fontSize: 11, opacity: 0.6 }}>Balance</div><b data-testid="balance" style={{ fontSize: 19, color: '#34d399' }}>{g.balance === null ? '—' : `₹${g.balance}`}</b></div>
        <div style={{ textAlign: 'right' }}><div style={{ fontSize: 11, opacity: 0.6 }}>Total stake</div><b data-testid="total-stake" style={{ fontSize: 19, color: '#fbbf24' }}>₹{g.total}</b></div>
      </div>

      {/* cards / result */}
      <div style={{ minHeight: 120, background: 'radial-gradient(ellipse at center,#0f5132,#062916)', borderRadius: 16, padding: 12, marginBottom: 12 }}>
        {r ? (
          <>
            {['player', 'banker'].map((side) => (
              <div key={side} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ width: 62, fontSize: 12, opacity: 0.8, textTransform: 'capitalize' }}>{side}</span>
                <div style={{ display: 'flex', gap: 5 }}>{(r.hands[side] ?? []).map((c, i) => <Card key={i} code={c} />)}</div>
              </div>
            ))}
            <div style={{ textAlign: 'center', marginTop: 6, fontWeight: 800, fontSize: 15, color: Number(r.payout) > 0 ? '#34d399' : '#fca5a5' }}>
              {r.isTie ? 'TIE' : `${r.winners[0]?.toUpperCase() ?? ''} WINS`} · {Number(r.payout) > 0 ? `+₹${r.payout}` : 'no win'}{r.replayed ? ' · (replayed)' : ''}
            </div>
          </>
        ) : (
          <div style={{ opacity: 0.6, fontSize: 13, textAlign: 'center', paddingTop: 40 }}>Pick a chip, back a side, then Deal.</div>
        )}
      </div>

      {/* chip selector */}
      <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Chip</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {CHIPS.map((c) => (
          <button key={c} onClick={() => g.setChip(c)} style={chip(g.chip === c)} aria-pressed={g.chip === c}>₹{c}</button>
        ))}
      </div>

      {/* PLAYER / BANKER / TIE */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
        {SIDES.map((s) => {
          const on = g.staked(s.key);
          const payout = g.config?.bets.find((b) => b.key === s.key)?.payout;
          return (
            <button key={s.key} data-testid={`bet-${s.key}`} onClick={() => g.place(s.key)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '16px 4px', borderRadius: 12, cursor: 'pointer', fontWeight: 800, border: on ? '2px solid #fbbf24' : '1px solid #334155', background: on ? s.color : '#111827', color: '#fff' }}>
              <span style={{ fontSize: 14 }}>{s.label}</span>
              <span style={{ fontSize: 10, opacity: 0.75 }}>{payout ? `×${payout}` : ''}{on ? ` · ₹${on}` : ''}</span>
            </button>
          );
        })}
      </div>

      {g.bets.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, marginBottom: 8, opacity: 0.85 }}>
          <span>{g.bets.map((b) => `${b.type} ₹${b.amount}`).join(' · ')}</span>
          <button onClick={g.clearBets} style={{ color: '#fca5a5', background: 'none', border: 'none', cursor: 'pointer' }}>Clear</button>
        </div>
      )}

      {g.error && <div data-testid="error" style={{ color: '#fca5a5', fontSize: 13, margin: '6px 2px' }}>⚠ {g.error}</div>}

      {/* deal — large one-hand tap target */}
      <button data-testid="deal" onClick={() => void g.deal()} disabled={g.dealing || g.balance === null || g.bets.length === 0}
        style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: g.dealing ? '#3730a3' : g.bets.length === 0 ? '#374151' : '#7c3aed', color: 'white', fontWeight: 800, fontSize: 18, cursor: 'pointer', marginTop: 4 }}>
        {g.dealing ? 'Dealing…' : g.bets.length === 0 ? 'Place a bet' : `Deal · ₹${g.total}`}
      </button>

      <p style={{ fontSize: 11, opacity: 0.45, textAlign: 'center', marginTop: 10 }}>
        Real-money deal · provably fair · cards &amp; balance are authoritative from the server.
      </p>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return { padding: '11px 14px', minWidth: 52, borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700, border: active ? '2px solid #fbbf24' : '1px solid #334155', background: active ? '#78350f' : '#111827', color: '#e5e7eb' };
}

export default BaccaratMoneyBoard;
