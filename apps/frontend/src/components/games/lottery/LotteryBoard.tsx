'use client';

/**
 * LotteryBoard — Number Lottery UI (Sprint 4, dark casino theme, responsive).
 *
 * A 49-number picker with quick pick, a countdown to the next scheduled draw, the
 * ticket list, the winning numbers + prize breakdown, history and a provably-fair
 * panel. Drives `useLottery`, which runs money through the FROZEN runtime/ledger and
 * the reusable Scheduled Draw Engine.
 */
import type { PlayerContext } from '@/runtime/game-runtime';

import { useLottery } from './use-lottery';

function fmt(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function LotteryBoard({ player }: { player?: PlayerContext }) {
  const g = useLottery(player);
  const numbers = Array.from({ length: g.range }, (_, i) => i + 1);
  const winSet = new Set(g.winning?.main ?? []);

  return (
    <div style={{ color: '#e5e7eb', background: '#0b0f19', borderRadius: 16, padding: 16, maxWidth: 560, margin: '0 auto' }}>
      {/* countdown + winning numbers */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, opacity: 0.8 }}>Next draw in <b style={{ color: '#fbbf24', fontSize: 18 }}>{fmt(g.countdownMs)}</b></div>
        <button onClick={() => void g.runDraw()} disabled={g.tickets.length === 0} style={primary('#7c3aed')}>Run Draw</button>
      </div>
      {g.winning && (
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Winning numbers</span>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 4 }}>
            {g.winning.main.map((n) => <span key={n} style={ball('#059669')}>{n}</span>)}
            <span style={ball('#f59e0b')}>{g.winning.bonus}</span>
          </div>
        </div>
      )}

      {/* number picker */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5 }}>
        {numbers.map((n) => {
          const sel = g.selected.includes(n);
          const won = winSet.has(n);
          return (
            <button key={n} onClick={() => g.toggle(n)} style={{ aspectRatio: '1', borderRadius: '50%', border: won ? '2px solid #34d399' : sel ? '2px solid #fbbf24' : '1px solid #334155', background: sel ? '#78350f' : '#111827', color: '#e5e7eb', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
              {n}
            </button>
          );
        })}
      </div>

      {/* controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Picked {g.selected.length}/{g.pick} · ticket {g.ticketPrice}</span>
        <button onClick={g.clearPick} style={btn('#374151')}>Clear</button>
        <button onClick={() => void g.buyTicket(false)} disabled={g.selected.length !== g.pick} style={primary('#059669')}>Buy Ticket</button>
        <button onClick={() => void g.buyTicket(true)} style={primary('#0ea5e9')}>Quick Pick</button>
      </div>
      {g.error && <div style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>⚠ {g.error}</div>}

      {/* ticket list (this draw) */}
      {g.tickets.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Your tickets ({g.tickets.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {g.tickets.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                {t.quickPick && <span style={{ opacity: 0.6 }}>QP</span>}
                {t.numbers.map((n) => <span key={n} style={{ ...ball('#1f2937'), width: 24, height: 24, fontSize: 11 }}>{n}</span>)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* past draws / history */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>History</div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {g.history.map((h, i) => (
            <div key={i} title={h.draw ? `draw ${h.draw.main.join(' ')} +${h.draw.bonus}` : ''} style={{ flex: '0 0 auto', fontSize: 11, padding: '4px 8px', borderRadius: 6, background: h.tier ? '#064e3b' : '#3f1d1d', color: h.tier ? '#6ee7b7' : '#fca5a5' }}>
              {h.tier ? `${h.tier} · ${h.prize}` : 'No prize'}
            </div>
          ))}
          {g.history.length === 0 && <span style={{ fontSize: 12, opacity: 0.5 }}>No draws yet</span>}
        </div>
      </div>

      {/* provably-fair panel */}
      {g.history[0] && (
        <details style={{ marginTop: 12, fontSize: 12, background: '#0f1629', borderRadius: 8, padding: 10 }}>
          <summary style={{ cursor: 'pointer', opacity: 0.85 }}>Provably Fair — verify the last draw</summary>
          <dl style={{ margin: '8px 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
            <dt style={{ opacity: 0.6 }}>Draw numbers</dt><dd>{g.history[0].draw ? `${g.history[0].draw.main.join(', ')} + bonus ${g.history[0].draw.bonus}` : '—'}</dd>
            <dt style={{ opacity: 0.6 }}>Your numbers</dt><dd>{g.history[0].numbers.join(', ')}</dd>
            <dt style={{ opacity: 0.6 }}>Tier / prize</dt><dd>{g.history[0].tier ?? 'none'} · {g.history[0].prize}</dd>
          </dl>
        </details>
      )}
    </div>
  );
}

function ball(bg: string): React.CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', background: bg, color: 'white', fontWeight: 700, fontSize: 13 };
}
function btn(bg: string): React.CSSProperties {
  return { padding: '8px 12px', borderRadius: 8, border: 'none', background: bg, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 13 };
}
function primary(bg: string): React.CSSProperties {
  return { padding: '9px 14px', borderRadius: 8, border: 'none', background: bg, color: 'white', fontWeight: 700, cursor: 'pointer' };
}

export default LotteryBoard;
