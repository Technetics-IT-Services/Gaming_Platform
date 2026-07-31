'use client';

/**
 * HiLoBoard — Hi-Lo UI (Sprint 2, dark casino theme, responsive).
 *
 * Animated card, higher/lower/equal prediction controls with live odds, running
 * multiplier + cash-out, history strip and provably-fair panel. Drives `useHiLo`,
 * which runs money through the FROZEN interactive runtime/ledger.
 */
import type { PlayerContext } from '@/runtime/game-runtime';
import type { HiLoCard } from '@/games/hilo/types';

import { useHiLo } from './use-hilo';

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
function label(card: HiLoCard): string {
  return `${RANKS[card.rank] ?? card.rank}${SUITS[card.suit] ?? ''}`;
}

export function HiLoBoard({ player }: { player?: PlayerContext }) {
  const g = useHiLo(player);
  const s = g.state;
  const red = s ? s.current.suit === 1 || s.current.suit === 2 : false;

  return (
    <div style={{ color: '#e5e7eb', background: '#0b0f19', borderRadius: 16, padding: 20, maxWidth: 480, margin: '0 auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        {/* card */}
        <div style={{ width: 120, height: 168, borderRadius: 12, background: '#f8fafc', color: red ? '#dc2626' : '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44, fontWeight: 800, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          {s ? label(s.current) : '🂠'}
        </div>
        {s && (
          <div style={{ fontSize: 20 }}>
            Multiplier <b style={{ color: '#34d399' }}>{s.multiplier.toFixed(2)}×</b>
          </div>
        )}

        {/* prediction controls */}
        {g.inRound && s ? (
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <button onClick={() => void g.predict('higher')} disabled={(s.odds.higher ?? 0) === 0} style={predBtn('#059669')}>
              ▲ Higher {s.odds.higher ? `${s.odds.higher}×` : '—'}
            </button>
            {s.allowEqual && (
              <button onClick={() => void g.predict('equal')} disabled={(s.odds.equal ?? 0) === 0} style={predBtn('#7c3aed')}>
                = Equal {s.odds.equal ? `${s.odds.equal}×` : '—'}
              </button>
            )}
            <button onClick={() => void g.predict('lower')} disabled={(s.odds.lower ?? 0) === 0} style={predBtn('#dc2626')}>
              ▼ Lower {s.odds.lower ? `${s.odds.lower}×` : '—'}
            </button>
          </div>
        ) : null}

        {g.inRound && s && s.multiplier > 1 && (
          <button onClick={() => void g.cashout()} style={{ ...primary('#f59e0b'), width: '100%' }}>
            Cash Out {Math.round(g.stake * s.multiplier)}
          </button>
        )}

        {!g.inRound && (
          <div style={{ display: 'flex', gap: 8, width: '100%', alignItems: 'center' }}>
            <input type="number" min={1} value={g.stake} onChange={(e) => g.setStake(Math.max(1, Number(e.target.value) || 1))} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #374151', background: '#111827', color: '#e5e7eb' }} />
            <button onClick={() => void g.deal()} style={primary('#059669')}>Deal</button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
          <label><input type="checkbox" checked={g.fast} onChange={(e) => g.setFast(e.target.checked)} /> Fast</label>
          <label><input type="checkbox" checked={g.sound} onChange={(e) => g.setSound(e.target.checked)} /> 🔊 Sound</label>
        </div>
        {g.error && <div style={{ color: '#f87171', fontSize: 12 }}>⚠ {g.error}</div>}
      </div>

      {/* history */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>History</div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {g.history.map((h, i) => (
            <div key={i} style={{ flex: '0 0 auto', fontSize: 11, padding: '4px 8px', borderRadius: 6, background: h.won ? '#064e3b' : '#3f1d1d', color: h.won ? '#6ee7b7' : '#fca5a5' }}>
              {h.won ? `${h.multiplier.toFixed(2)}×` : 'Bust'}
            </div>
          ))}
          {g.history.length === 0 && <span style={{ fontSize: 12, opacity: 0.5 }}>No rounds yet</span>}
        </div>
      </div>

      {/* provably-fair panel */}
      {g.history[0] && (
        <details style={{ marginTop: 12, fontSize: 12, background: '#0f1629', borderRadius: 8, padding: 10 }}>
          <summary style={{ cursor: 'pointer', opacity: 0.85 }}>Provably Fair — verify the last round</summary>
          <dl style={{ margin: '8px 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
            <dt style={{ opacity: 0.6 }}>Server seed hash</dt><dd style={{ wordBreak: 'break-all' }}>{g.history[0].serverSeedHash ?? '—'}</dd>
            <dt style={{ opacity: 0.6 }}>Client seed</dt><dd>{g.history[0].clientSeed}</dd>
            <dt style={{ opacity: 0.6 }}>Nonce</dt><dd>{g.history[0].nonce}</dd>
            <dt style={{ opacity: 0.6 }}>Cards</dt><dd>{g.history[0].cards.map(label).join('  ')}</dd>
          </dl>
        </details>
      )}
    </div>
  );
}

function predBtn(bg: string): React.CSSProperties {
  return { flex: 1, padding: '12px 8px', borderRadius: 8, border: 'none', background: bg, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 13 };
}
function primary(bg: string): React.CSSProperties {
  return { padding: '10px 16px', borderRadius: 8, border: 'none', background: bg, color: 'white', fontWeight: 700, cursor: 'pointer' };
}

export default HiLoBoard;
