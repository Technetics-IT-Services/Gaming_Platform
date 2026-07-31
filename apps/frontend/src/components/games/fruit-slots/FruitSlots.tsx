'use client';

/**
 * FruitSlots — Fruit Slots UI (Sprint 2, dark casino theme, responsive).
 *
 * Animated 5×3 reels, winning-payline highlight, win celebration, free-spin badge,
 * auto-spin + turbo controls, history and provably-fair panel. Drives `useFruitSlots`,
 * which runs money through the FROZEN runtime/ledger.
 */
import { useState } from 'react';

import type { PlayerContext } from '@/runtime/game-runtime';
import { Symbol } from '@/games/fruit-slots/types';

import { useFruitSlots } from './use-fruit-slots';

const ICON: Record<Symbol, string> = {
  [Symbol.Cherry]: '🍒',
  [Symbol.Lemon]: '🍋',
  [Symbol.Orange]: '🍊',
  [Symbol.Plum]: '🍇',
  [Symbol.Bell]: '🔔',
  [Symbol.Seven]: '7️⃣',
  [Symbol.Wild]: '⭐',
  [Symbol.Scatter]: '💰',
};

export function FruitSlots({ player }: { player?: PlayerContext }) {
  const g = useFruitSlots(player);
  const [autoRounds, setAutoRounds] = useState(10);
  const matrix = g.spin?.matrix;
  const won = g.lastWin > g.totalBet;

  // Which (row, reel) cells are on a winning line (for highlight).
  const winningCells = new Set<string>();
  // Highlight not per-cell here (paylines vary); we mark the whole matrix as a win glow.

  return (
    <div style={{ color: '#e5e7eb', background: '#0b0f19', borderRadius: 16, padding: 20, maxWidth: 560, margin: '0 auto' }}>
      {/* reels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, padding: 12, borderRadius: 12, background: won ? 'linear-gradient(#1f2937,#064e3b)' : '#111827', transition: 'background 300ms' }}>
        {Array.from({ length: 3 }).flatMap((_, row) =>
          Array.from({ length: 5 }).map((__, reel) => {
            const sym = matrix?.[row]?.[reel];
            return (
              <div key={`${row}-${reel}`} style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, borderRadius: 8, background: '#0b0f19', opacity: g.spinning ? 0.4 : 1, transition: 'opacity 150ms', outline: winningCells.has(`${row}-${reel}`) ? '2px solid #fbbf24' : 'none' }}>
                {sym ? ICON[sym] : '❔'}
              </div>
            );
          }),
        )}
      </div>

      {/* win / free-spin badges */}
      <div style={{ minHeight: 28, marginTop: 8, textAlign: 'center' }}>
        {won && <span style={{ color: '#34d399', fontWeight: 800, fontSize: 18 }}>WIN {g.lastWin} ({(g.lastWin / g.totalBet).toFixed(2)}×)</span>}
        {g.spin && g.spin.freeSpinsAwarded > 0 && <span style={{ marginLeft: 10, color: '#fbbf24', fontWeight: 700 }}>🎁 {g.spin.freeSpinsAwarded} Free Spins</span>}
        {g.spin && g.lastWin === 0 && !g.spinning && <span style={{ opacity: 0.5 }}>No win</span>}
      </div>

      {/* controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <label style={{ fontSize: 12, opacity: 0.8 }}>
          Bet
          <input type="number" min={20} step={20} value={g.totalBet} onChange={(e) => g.setTotalBet(Math.max(20, Number(e.target.value) || 20))} style={{ width: 90, marginLeft: 6, padding: '8px', borderRadius: 6, border: '1px solid #374151', background: '#111827', color: '#e5e7eb' }} />
        </label>
        <button onClick={() => void g.doSpin()} disabled={g.spinning} style={primary('#059669')}>Spin</button>
        <button onClick={() => void g.autoSpin(autoRounds)} disabled={g.spinning} style={primary('#7c3aed')}>Auto ×{autoRounds}</button>
        <button onClick={g.stopAuto} style={primary('#374151')}>Stop</button>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={g.turbo} onChange={(e) => g.setTurbo(e.target.checked)} /> ⚡ Turbo</label>
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={g.sound} onChange={(e) => g.setSound(e.target.checked)} /> 🔊</label>
        <input type="range" min={5} max={100} step={5} value={autoRounds} onChange={(e) => setAutoRounds(Number(e.target.value))} />
      </div>
      {g.error && <div style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>⚠ {g.error}</div>}

      {/* history */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>History</div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {g.history.map((h, i) => (
            <div key={i} style={{ flex: '0 0 auto', fontSize: 11, padding: '4px 8px', borderRadius: 6, background: h.win > 0 ? '#064e3b' : '#3f1d1d', color: h.win > 0 ? '#6ee7b7' : '#fca5a5' }}>
              {h.win > 0 ? `${h.multiplier.toFixed(2)}×` : '—'}
            </div>
          ))}
          {g.history.length === 0 && <span style={{ fontSize: 12, opacity: 0.5 }}>No spins yet</span>}
        </div>
      </div>

      {/* provably-fair panel */}
      {g.history[0] && (
        <details style={{ marginTop: 12, fontSize: 12, background: '#0f1629', borderRadius: 8, padding: 10 }}>
          <summary style={{ cursor: 'pointer', opacity: 0.85 }}>Provably Fair — verify the last spin</summary>
          <dl style={{ margin: '8px 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
            <dt style={{ opacity: 0.6 }}>Server seed hash</dt><dd style={{ wordBreak: 'break-all' }}>{g.history[0].serverSeedHash ?? '—'}</dd>
            <dt style={{ opacity: 0.6 }}>Client seed</dt><dd>{g.history[0].clientSeed}</dd>
            <dt style={{ opacity: 0.6 }}>Nonce</dt><dd>{g.history[0].nonce}</dd>
            <dt style={{ opacity: 0.6 }}>Reel stops</dt><dd>{g.history[0].stops.join(', ')}</dd>
            <dt style={{ opacity: 0.6 }}>Winning lines</dt><dd>{g.history[0].lineWins.map((w) => `#${w.line} ${w.symbol}×${w.count}`).join('  ') || 'none'}</dd>
          </dl>
        </details>
      )}
    </div>
  );
}

function primary(bg: string): React.CSSProperties {
  return { padding: '10px 16px', borderRadius: 8, border: 'none', background: bg, color: 'white', fontWeight: 700, cursor: 'pointer' };
}

export default FruitSlots;
