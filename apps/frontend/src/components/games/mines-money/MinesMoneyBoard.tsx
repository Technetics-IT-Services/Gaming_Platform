'use client';

/**
 * MinesMoneyBoard — real-money Mines (Phase 2C.6), mobile-first & interactive.
 *
 * Authenticated: start deals a HIDDEN authoritative board via the backend money bridge
 * (`/games/mines/start`); reveal tiles (`/reveal`) to grow the multiplier; cash out (`/cashout`) to
 * settle. The board, multiplier, payout and balance are the authoritative server values (no demo
 * wallet). Large 5×5 touch grid (usable at 375px), sticky balance, current multiplier + potential
 * payout, and a prominent Cash Out. No horizontal overflow at 375/390/412.
 */
import { useMinesMoney } from './use-mines-money';

const STAKE_CHIPS = ['5', '10', '25', '50', '100'];
const MINE_COUNTS = [1, 3, 5, 10];

export function MinesMoneyBoard() {
  const g = useMinesMoney();
  const r = g.round;
  const tiles = r?.tiles ?? g.config?.tiles ?? 25;
  const cols = Math.round(Math.sqrt(tiles)) || 5;
  const min = g.config?.limits.min ?? 1;
  const max = g.config?.limits.max ?? 10000;

  const tileState = (i: number): 'hidden' | 'safe' | 'mine' | 'unrevealed-mine' => {
    if (!r) return 'hidden';
    if (r.revealed.includes(i)) return 'safe';
    if (r.board) return r.board.includes(i) ? (i === r.hit ? 'mine' : 'unrevealed-mine') : 'hidden';
    return 'hidden';
  };

  return (
    <div style={{ color: '#e5e7eb', maxWidth: 460, margin: '0 auto', padding: '0 4px 24px', boxSizing: 'border-box' }}>
      {/* sticky authoritative balance + potential cashout */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0b0f19', padding: '10px 12px', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #1f2937', marginBottom: 12 }}>
        <div><div style={{ fontSize: 11, opacity: 0.6 }}>Balance</div><b data-testid="balance" style={{ fontSize: 19, color: '#34d399' }}>{g.balance === null ? '—' : `₹${g.balance}`}</b></div>
        {g.active && <div style={{ textAlign: 'right' }}><div style={{ fontSize: 11, opacity: 0.6 }}>Cash out</div><b data-testid="multiplier" style={{ fontSize: 18, color: '#fbbf24' }}>{r!.multiplier}× · ₹{r!.potentialPayout}</b></div>}
      </div>

      {/* result banner */}
      {g.settled && r && (
        <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 16, marginBottom: 10, color: r.won ? '#34d399' : '#fca5a5' }}>
          {r.won ? `CASHED OUT ${r.multiplier}× · WON ₹${r.payout}` : 'BOOM · lost'}
        </div>
      )}

      {/* 5×5 grid */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 6, marginBottom: 12 }}>
        {Array.from({ length: tiles }, (_, i) => {
          const st = tileState(i);
          const bg = st === 'safe' ? '#065f46' : st === 'mine' ? '#7f1d1d' : st === 'unrevealed-mine' ? '#3f1d1d' : '#1f2937';
          const label = st === 'safe' ? '💎' : st === 'mine' || st === 'unrevealed-mine' ? '💣' : '';
          return (
            <button key={i} data-testid={`tile-${i}`} onClick={() => g.reveal(i)} disabled={!g.active || g.revealing || (r?.revealed.includes(i) ?? false)}
              style={{ aspectRatio: '1', borderRadius: 10, border: '1px solid #334155', background: bg, color: '#fff', fontSize: 20, cursor: g.active ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>{label}</button>
          );
        })}
      </div>

      {g.error && <div data-testid="error" style={{ color: '#fca5a5', fontSize: 13, margin: '6px 2px' }}>⚠ {g.error}</div>}

      {/* controls */}
      {g.active ? (
        <button data-testid="cashout" onClick={() => void g.cashout()} disabled={g.cashingOut || r!.revealed.length === 0}
          style={{ width: '100%', padding: '18px', borderRadius: 14, border: 'none', background: r!.revealed.length === 0 ? '#374151' : g.cashingOut ? '#047857' : '#10b981', color: '#04231a', fontWeight: 900, fontSize: 20, cursor: 'pointer' }}>
          {g.cashingOut ? 'Cashing out…' : r!.revealed.length === 0 ? 'Reveal a tile first' : `Cash Out ₹${r!.potentialPayout}`}
        </button>
      ) : g.settled ? (
        <button data-testid="new-round" onClick={g.newRound} style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: '#7c3aed', color: 'white', fontWeight: 800, fontSize: 18, cursor: 'pointer' }}>New Round</button>
      ) : (
        <>
          <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Mines</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {MINE_COUNTS.map((m) => (
              <button key={m} data-testid={`mines-${m}`} onClick={() => g.setMines(m)} style={{ ...chip(g.mines === m), flex: 1 }} aria-pressed={g.mines === m}>{m}</button>
            ))}
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Stake (₹{min}–₹{max})</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {STAKE_CHIPS.map((s) => (
              <button key={s} onClick={() => g.setStake(s)} style={chip(g.stake === s)} aria-pressed={g.stake === s}>₹{s}</button>
            ))}
            <input inputMode="decimal" value={g.stake} onChange={(e) => g.setStake(e.target.value.replace(/[^\d.]/g, ''))} aria-label="stake"
              style={{ width: 80, padding: '10px 12px', borderRadius: 10, border: '1px solid #334155', background: '#111827', color: '#e5e7eb', fontSize: 15 }} />
          </div>
          <button data-testid="start" onClick={() => void g.start()} disabled={g.starting || g.balance === null}
            style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: g.starting ? '#3730a3' : '#7c3aed', color: 'white', fontWeight: 800, fontSize: 18, cursor: 'pointer' }}>
            {g.starting ? 'Starting…' : `Start · ₹${g.stake} · ${g.mines} mines`}
          </button>
        </>
      )}

      <p style={{ fontSize: 11, opacity: 0.45, textAlign: 'center', marginTop: 10 }}>
        Real-money round · provably fair · board &amp; balance are authoritative from the server.
      </p>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return { padding: '11px 14px', minWidth: 52, borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700, border: active ? '2px solid #fbbf24' : '1px solid #334155', background: active ? '#78350f' : '#111827', color: '#e5e7eb' };
}

export default MinesMoneyBoard;
