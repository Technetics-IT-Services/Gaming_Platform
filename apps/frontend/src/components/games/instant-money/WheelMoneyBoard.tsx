'use client';

/**
 * WheelMoneyBoard — real-money Wheel (Phase 2C.7), mobile-first.
 *
 * The player picks a risk level; the server spins a provably-fair wheel and pays the landed segment
 * multiplier. The landed segment, multiplier, payout and balance are the authoritative server values
 * (no demo wallet). The segment tables come from the config API (never hardcoded). No horizontal
 * overflow at 375/390/412.
 */
import { useState } from 'react';

import { useInstantMoney } from './use-instant-money';
import type { WheelConfig, WheelRisk } from '@/lib/instant-money-api';

const RISKS: WheelRisk[] = ['low', 'medium', 'high'];

function segColor(m: number): string {
  if (m >= 5) return '#b91c1c';
  if (m >= 1.8) return '#d97706';
  if (m >= 1) return '#4338ca';
  return '#334155';
}

export function WheelMoneyBoard() {
  const g = useInstantMoney<WheelConfig>('wheel');
  const [risk, setRisk] = useState<WheelRisk>('medium');
  const min = g.config?.limits.min ?? 1;
  const max = g.config?.limits.max ?? 10000;
  const segments = g.config?.segments[risk] ?? [];
  const uniqueSegs = Array.from(new Set(segments)).sort((a, b) => b - a);
  const r = g.lastResult;
  const landedIndex = r ? Number((r.result as { index?: number }).index ?? -1) : -1;
  const landedSeg = r ? Number((r.result as { segment?: number }).segment ?? 0) : null;

  return (
    <div style={{ color: '#e5e7eb', maxWidth: 460, margin: '0 auto', padding: '0 4px 24px', boxSizing: 'border-box' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0b0f19', padding: '10px 12px', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #1f2937', marginBottom: 12 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Balance</span>
        <b data-testid="balance" style={{ fontSize: 20, color: '#34d399' }}>{g.balance === null ? '—' : `₹${g.balance}`}</b>
      </div>

      <div style={{ textAlign: 'center', minHeight: 104, background: 'radial-gradient(ellipse at center,#1e1b4b,#0b0f19)', borderRadius: 16, padding: 16, marginBottom: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        {r ? (
          <>
            <div data-testid="multiplier" style={{ fontSize: 44, fontWeight: 900, color: r.win ? '#34d399' : '#fca5a5' }}>{landedSeg}×</div>
            <div style={{ marginTop: 4, fontWeight: 800, fontSize: 15, color: r.win ? '#34d399' : '#fca5a5' }}>{r.win ? `WON ₹${r.payout}` : 'LOST'}</div>
          </>
        ) : (
          <div style={{ opacity: 0.6, fontSize: 13 }}>Pick a risk level, then Spin.</div>
        )}
      </div>

      {/* segment multipliers for this risk (from config) */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(segments.length, 20) || 1}, 1fr)`, gap: 2, marginBottom: 4 }}>
        {segments.map((m, i) => (
          <div key={i} style={{ padding: '8px 0', borderRadius: 3, background: segColor(m), textAlign: 'center', fontSize: 8, fontWeight: 700, border: landedIndex === i ? '2px solid #fff' : 'none' }}>{m}</div>
        ))}
      </div>
      <div style={{ fontSize: 11, opacity: 0.6, textAlign: 'center', marginBottom: 12 }}>segments: {uniqueSegs.map((m) => `${m}×`).join(' · ')}</div>

      <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Risk</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {RISKS.map((rk) => (
          <button key={rk} data-testid={`risk-${rk}`} onClick={() => setRisk(rk)} aria-pressed={risk === rk}
            style={{ ...chip(risk === rk), flex: 1, textTransform: 'capitalize' }}>{rk}</button>
        ))}
      </div>

      <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Stake (₹{min}–₹{max})</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {['5', '10', '25', '50'].map((s) => (
          <button key={s} onClick={() => g.setStake(s)} style={chip(g.stake === s)} aria-pressed={g.stake === s}>₹{s}</button>
        ))}
        <input inputMode="decimal" value={g.stake} onChange={(e) => g.setStake(e.target.value.replace(/[^\d.]/g, ''))} aria-label="stake"
          style={{ width: 80, padding: '10px 12px', borderRadius: 10, border: '1px solid #334155', background: '#111827', color: '#e5e7eb', fontSize: 15 }} />
      </div>

      {g.error && <div data-testid="error" style={{ color: '#fca5a5', fontSize: 13, margin: '6px 2px' }}>⚠ {g.error}</div>}

      <button data-testid="play" onClick={() => g.play({ game: 'wheel', risk })} disabled={g.playing || g.balance === null}
        style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: g.playing ? '#3730a3' : '#7c3aed', color: 'white', fontWeight: 800, fontSize: 18, cursor: 'pointer' }}>
        {g.playing ? 'Spinning…' : `Spin ₹${g.stake} · ${risk}`}
      </button>

      <p style={{ fontSize: 11, opacity: 0.45, textAlign: 'center', marginTop: 10 }}>Real-money round · provably fair · segment &amp; balance are authoritative from the server.</p>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return { padding: '11px 14px', minWidth: 52, borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700, border: active ? '2px solid #fbbf24' : '1px solid #334155', background: active ? '#78350f' : '#111827', color: '#e5e7eb' };
}

export default WheelMoneyBoard;
