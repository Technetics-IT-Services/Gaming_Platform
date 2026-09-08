'use client';

/**
 * CoinFlipMoneyBoard — real-money Coin Flip (Phase 2C.7), mobile-first.
 *
 * The player calls heads or tails; the server flips a provably-fair coin and pays 1.98× on a correct
 * call. The outcome, win/loss, payout and balance are the authoritative server values (no demo
 * wallet). Mobile-first: sticky balance, two large call buttons. No horizontal overflow at 375/390/412.
 */
import { useState } from 'react';

import { useInstantMoney } from './use-instant-money';
import type { CoinFlipConfig, CoinSide } from '@/lib/instant-money-api';

export function CoinFlipMoneyBoard() {
  const g = useInstantMoney<CoinFlipConfig>('coin-flip');
  const [side, setSide] = useState<CoinSide>('heads');
  const min = g.config?.limits.min ?? 1;
  const max = g.config?.limits.max ?? 10000;
  const payout = g.config?.payout ?? 1.98;
  const r = g.lastResult;
  const outcome = r ? ((r.result as { outcome?: CoinSide }).outcome ?? null) : null;
  const potential = (Number(g.stake) * payout).toFixed(2);

  return (
    <div style={{ color: '#e5e7eb', maxWidth: 460, margin: '0 auto', padding: '0 4px 24px', boxSizing: 'border-box' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0b0f19', padding: '10px 12px', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #1f2937', marginBottom: 12 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Balance</span>
        <b data-testid="balance" style={{ fontSize: 20, color: '#34d399' }}>{g.balance === null ? '—' : `₹${g.balance}`}</b>
      </div>

      <div style={{ textAlign: 'center', minHeight: 128, background: 'radial-gradient(ellipse at center,#1e1b4b,#0b0f19)', borderRadius: 16, padding: 16, marginBottom: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        <div data-testid="multiplier" style={{ fontSize: 64, lineHeight: 1 }}>{outcome === 'heads' ? '🙂' : outcome === 'tails' ? '🪙' : '🪙'}</div>
        {r ? (
          <div style={{ marginTop: 8, fontWeight: 800, fontSize: 16, color: r.win ? '#34d399' : '#fca5a5' }}>
            {outcome === 'heads' ? 'Heads' : 'Tails'} · {r.win ? `WON ₹${r.payout}` : 'LOST'}
          </div>
        ) : (
          <div style={{ marginTop: 8, opacity: 0.6, fontSize: 13 }}>Call heads or tails, then Flip.</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        {(['heads', 'tails'] as CoinSide[]).map((s) => (
          <button key={s} data-testid={`side-${s}`} onClick={() => setSide(s)} aria-pressed={side === s}
            style={{ flex: 1, padding: '18px', borderRadius: 14, fontSize: 18, fontWeight: 800, cursor: 'pointer', textTransform: 'capitalize', border: side === s ? '2px solid #fbbf24' : '1px solid #334155', background: side === s ? '#78350f' : '#111827', color: '#e5e7eb' }}>
            {s === 'heads' ? '🙂 Heads' : '🪙 Tails'}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Stake (₹{min}–₹{max}) · pays ₹{potential} ({payout}×)</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {['5', '10', '25', '50'].map((s) => (
          <button key={s} onClick={() => g.setStake(s)} style={chip(g.stake === s)} aria-pressed={g.stake === s}>₹{s}</button>
        ))}
        <input inputMode="decimal" value={g.stake} onChange={(e) => g.setStake(e.target.value.replace(/[^\d.]/g, ''))} aria-label="stake"
          style={{ width: 80, padding: '10px 12px', borderRadius: 10, border: '1px solid #334155', background: '#111827', color: '#e5e7eb', fontSize: 15 }} />
      </div>

      {g.error && <div data-testid="error" style={{ color: '#fca5a5', fontSize: 13, margin: '6px 2px' }}>⚠ {g.error}</div>}

      <button data-testid="play" onClick={() => g.play({ game: 'coin-flip', side })} disabled={g.playing || g.balance === null}
        style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: g.playing ? '#3730a3' : '#7c3aed', color: 'white', fontWeight: 800, fontSize: 18, cursor: 'pointer' }}>
        {g.playing ? 'Flipping…' : `Flip ₹${g.stake} on ${side}`}
      </button>

      <p style={{ fontSize: 11, opacity: 0.45, textAlign: 'center', marginTop: 10 }}>Real-money round · provably fair · outcome &amp; balance are authoritative from the server.</p>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return { padding: '11px 14px', minWidth: 52, borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700, border: active ? '2px solid #fbbf24' : '1px solid #334155', background: active ? '#78350f' : '#111827', color: '#e5e7eb' };
}

export default CoinFlipMoneyBoard;
