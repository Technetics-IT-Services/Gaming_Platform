'use client';

/**
 * LimboMoneyBoard — real-money Limbo (Phase 2C.7), mobile-first.
 *
 * The player picks a target multiplier; the server generates a provably-fair multiplier and pays the
 * target if it reaches it. The generated multiplier, win/loss, payout and balance are the
 * authoritative server values (no demo wallet). Mobile-first: sticky balance, big target control,
 * large Play button. No horizontal overflow at 375/390/412.
 */
import { useState } from 'react';

import { useInstantMoney } from './use-instant-money';
import type { LimboConfig } from '@/lib/instant-money-api';

const TARGET_CHIPS = [1.5, 2, 3, 5, 10];

export function LimboMoneyBoard() {
  const g = useInstantMoney<LimboConfig>('limbo');
  const [target, setTarget] = useState('2');
  const t = Number(target);
  const min = g.config?.limits.min ?? 1;
  const max = g.config?.limits.max ?? 10000;
  const minTarget = g.config?.minTarget ?? 1.01;
  const r = g.lastResult;
  const generated = r ? Number((r.result as { generated?: number }).generated ?? 0) : null;
  const valid = Number.isFinite(t) && t >= minTarget;
  const potential = valid ? (Number(g.stake) * t).toFixed(2) : '0.00';

  return (
    <div style={{ color: '#e5e7eb', maxWidth: 460, margin: '0 auto', padding: '0 4px 24px', boxSizing: 'border-box' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0b0f19', padding: '10px 12px', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #1f2937', marginBottom: 12 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Balance</span>
        <b data-testid="balance" style={{ fontSize: 20, color: '#34d399' }}>{g.balance === null ? '—' : `₹${g.balance}`}</b>
      </div>

      <div style={{ textAlign: 'center', minHeight: 104, background: 'radial-gradient(ellipse at center,#1e1b4b,#0b0f19)', borderRadius: 16, padding: 16, marginBottom: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        {r ? (
          <>
            <div data-testid="multiplier" style={{ fontSize: 44, fontWeight: 900, color: r.win ? '#34d399' : '#fca5a5' }}>{generated?.toFixed(2)}×</div>
            <div style={{ marginTop: 4, fontWeight: 800, fontSize: 15, color: r.win ? '#34d399' : '#fca5a5' }}>
              {r.win ? `WON ₹${r.payout} (${t}×)` : `LOST · needed ${(r.result as { target?: number }).target}×`}
            </div>
          </>
        ) : (
          <div style={{ opacity: 0.6, fontSize: 13 }}>Pick a target multiplier, then Play.</div>
        )}
      </div>

      <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Target multiplier (≥ {minTarget})</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ''))} aria-label="target"
          style={{ flex: 1, padding: '14px', borderRadius: 12, border: '1px solid #334155', background: '#111827', color: '#e5e7eb', fontSize: 22, fontWeight: 800, textAlign: 'center' }} />
        <div style={{ fontSize: 12, opacity: 0.7, minWidth: 96, textAlign: 'right' }}>win chance<br /><b style={{ color: '#fbbf24' }}>{valid ? `${(99 / t).toFixed(2)}%` : '—'}</b></div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {TARGET_CHIPS.map((c) => (
          <button key={c} data-testid={`target-${c}`} onClick={() => setTarget(String(c))} style={chip(t === c)} aria-pressed={t === c}>{c}×</button>
        ))}
      </div>

      <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Stake (₹{min}–₹{max}) · pays ₹{potential}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {['5', '10', '25', '50'].map((s) => (
          <button key={s} onClick={() => g.setStake(s)} style={chip(g.stake === s)} aria-pressed={g.stake === s}>₹{s}</button>
        ))}
        <input inputMode="decimal" value={g.stake} onChange={(e) => g.setStake(e.target.value.replace(/[^\d.]/g, ''))} aria-label="stake"
          style={{ width: 80, padding: '10px 12px', borderRadius: 10, border: '1px solid #334155', background: '#111827', color: '#e5e7eb', fontSize: 15 }} />
      </div>

      {g.error && <div data-testid="error" style={{ color: '#fca5a5', fontSize: 13, margin: '6px 2px' }}>⚠ {g.error}</div>}

      <button data-testid="play" onClick={() => valid && g.play({ game: 'limbo', target: Math.floor(t * 100) / 100 })} disabled={g.playing || g.balance === null || !valid}
        style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: !valid ? '#374151' : g.playing ? '#3730a3' : '#7c3aed', color: 'white', fontWeight: 800, fontSize: 18, cursor: 'pointer' }}>
        {g.playing ? 'Playing…' : `Play ₹${g.stake} · ${valid ? t : '?'}×`}
      </button>

      <p style={{ fontSize: 11, opacity: 0.45, textAlign: 'center', marginTop: 10 }}>Real-money round · provably fair · outcome &amp; balance are authoritative from the server.</p>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return { padding: '11px 14px', minWidth: 52, borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700, border: active ? '2px solid #fbbf24' : '1px solid #334155', background: active ? '#78350f' : '#111827', color: '#e5e7eb' };
}

export default LimboMoneyBoard;
