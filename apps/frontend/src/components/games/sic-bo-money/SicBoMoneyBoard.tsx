'use client';

/**
 * SicBoMoneyBoard — real-money Sic Bo (Phase 2C.3), mobile-first.
 *
 * Authenticated: bets are collected then submitted as ONE roll via the backend money bridge
 * (`/games/sic-bo/play`); the dice, winning bets, payout and balance are the authoritative server
 * values (no demo wallet). The COMPLETE engine bet board is exposed through collapsible mobile
 * sections (never crammed into a desktop table): even-money, singles, doubles, triples, totals.
 * Sticky balance + total stake, a compact selected-bet summary, and a large Roll button. No
 * horizontal overflow at 375/390/412.
 */
import { useMemo } from 'react';
import { useSicBoMoney } from './use-sic-bo-money';
import type { SicBoBetOption } from '@/lib/sic-bo-money-api';

const CHIPS = ['1', '5', '10', '25', '100'];
// Friendly section titles + ordering for the engine bet categories.
const SECTION_ORDER: Array<{ match: (c: string) => boolean; title: string; open?: boolean }> = [
  { match: (c) => c === 'range' || c === 'parity', title: 'Even Money', open: true },
  { match: (c) => c === 'single', title: 'Singles (1–6)' },
  { match: (c) => c === 'double', title: 'Doubles' },
  { match: (c) => c === 'triple' || c === 'pattern', title: 'Triples' },
  { match: (c) => c === 'total', title: 'Totals (4–17)' },
];

export function SicBoMoneyBoard() {
  const g = useSicBoMoney();
  const r = g.lastResult;
  const allBets = useMemo(() => g.config?.bets ?? [], [g.config]);

  const sections = useMemo(() => {
    const used = new Set<string>();
    const out = SECTION_ORDER.map((s) => {
      const bets = allBets.filter((b) => s.match(b.category));
      bets.forEach((b) => used.add(b.key));
      return { title: s.title, open: s.open, bets };
    }).filter((s) => s.bets.length > 0);
    const rest = allBets.filter((b) => !used.has(b.key));
    if (rest.length) out.push({ title: 'Other', open: false, bets: rest });
    return out;
  }, [allBets]);

  const staked = (type: string) => g.bets.find((b) => b.type === type)?.amount;
  const maxWin = useMemo(() => {
    const byKey = new Map(allBets.map((b) => [b.key, b.payout] as const));
    return g.bets.reduce((sum, b) => sum + Number(b.amount) * (byKey.get(b.type) ?? 1), 0);
  }, [g.bets, allBets]);

  return (
    <div style={{ color: '#e5e7eb', maxWidth: 460, margin: '0 auto', padding: '0 4px', boxSizing: 'border-box' }}>
      {/* sticky authoritative balance + total stake */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0b0f19', padding: '10px 12px', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #1f2937', marginBottom: 12 }}>
        <div><div style={{ fontSize: 11, opacity: 0.6 }}>Balance</div><b data-testid="balance" style={{ fontSize: 19, color: '#34d399' }}>{g.balance === null ? '—' : `₹${g.balance}`}</b></div>
        <div style={{ textAlign: 'right' }}><div style={{ fontSize: 11, opacity: 0.6 }}>Stake · Max win</div><b data-testid="total-stake" style={{ fontSize: 17, color: '#fbbf24' }}>₹{g.total} · ₹{maxWin}</b></div>
      </div>

      {/* dice result */}
      <div style={{ textAlign: 'center', minHeight: 92, background: 'radial-gradient(ellipse at center,#0f5132,#062916)', borderRadius: 16, padding: 12, marginBottom: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        {r ? (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              {r.dice.map((v, i) => (
                <span key={i} style={{ width: 40, height: 40, borderRadius: 8, background: '#fff', color: '#111827', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 20 }}>{v}</span>
              ))}
            </div>
            <div style={{ marginTop: 8, fontWeight: 800, fontSize: 16, color: Number(r.payout) > 0 ? '#34d399' : '#fca5a5' }}>
              {Number(r.payout) > 0 ? `WON +₹${r.payout}` : 'No win'}
            </div>
            <div style={{ fontSize: 11, opacity: 0.6 }}>total {r.total}{r.isTriple ? ' · triple' : ''}{r.replayed ? ' · (replayed)' : ''}</div>
          </>
        ) : (
          <div style={{ opacity: 0.6, fontSize: 13 }}>Pick a chip, place bets across the board, then Roll.</div>
        )}
      </div>

      {/* chip selector */}
      <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Chip</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {CHIPS.map((c) => (
          <button key={c} onClick={() => g.setChip(c)} style={chip(g.chip === c)} aria-pressed={g.chip === c}>₹{c}</button>
        ))}
      </div>

      {/* collapsible bet sections — the FULL engine board */}
      {sections.map((s) => (
        <details key={s.title} open={s.open} style={{ marginBottom: 8, border: '1px solid #1f2937', borderRadius: 12, overflow: 'hidden' }}>
          <summary style={{ padding: '11px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 700, background: '#111827', listStyle: 'none' }}>{s.title} <span style={{ opacity: 0.5, fontWeight: 400 }}>· {s.bets.length}</span></summary>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, padding: 8 }}>
            {s.bets.map((b: SicBoBetOption) => {
              const on = !!staked(b.key);
              return (
                <button key={b.key} data-testid={`bet-${b.key}`} onClick={() => g.place(b.key)} style={betBtn(on)}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{b.label}</span>
                  <span style={{ fontSize: 10, opacity: 0.6 }}>×{b.payout}{on ? ` · ₹${staked(b.key)}` : ''}</span>
                </button>
              );
            })}
          </div>
        </details>
      ))}

      {/* selected-bet summary */}
      {g.bets.length > 0 && (
        <div style={{ border: '1px solid #1f2937', borderRadius: 12, padding: 10, margin: '10px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>Bets ({g.bets.length})</span>
            <button onClick={g.clearBets} style={{ fontSize: 12, color: '#fca5a5', background: 'none', border: 'none', cursor: 'pointer' }}>Clear all</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
            {g.bets.map((b) => (
              <div key={b.type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                <span>{b.type} · ₹{b.amount}</span>
                <button onClick={() => g.removeBet(b.type)} aria-label="remove bet" style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {g.error && <div data-testid="error" style={{ color: '#fca5a5', fontSize: 13, margin: '6px 2px' }}>⚠ {g.error}</div>}

      {/* roll — large one-hand tap target */}
      <button data-testid="roll" onClick={() => void g.roll()} disabled={g.rolling || g.balance === null || g.bets.length === 0}
        style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: g.rolling ? '#3730a3' : g.bets.length === 0 ? '#374151' : '#7c3aed', color: 'white', fontWeight: 800, fontSize: 18, cursor: 'pointer', marginTop: 4 }}>
        {g.rolling ? 'Rolling…' : g.bets.length === 0 ? 'Place a bet' : `Roll · ₹${g.total}`}
      </button>

      <p style={{ fontSize: 11, opacity: 0.45, textAlign: 'center', marginTop: 10 }}>
        Real-money roll · provably fair · dice &amp; balance are authoritative from the server.
      </p>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return { padding: '11px 14px', minWidth: 52, borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700, border: active ? '2px solid #fbbf24' : '1px solid #334155', background: active ? '#78350f' : '#111827', color: '#e5e7eb' };
}
function betBtn(active: boolean): React.CSSProperties {
  return { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '10px 4px', borderRadius: 10, cursor: 'pointer', border: active ? '2px solid #fbbf24' : '1px solid #334155', background: active ? '#78350f' : '#0b0f19', color: '#e5e7eb' };
}

export default SicBoMoneyBoard;
