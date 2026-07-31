'use client';

/**
 * SicBoTable — Sic Bo UI (Sprint 3, dark casino theme, responsive).
 *
 * Traditional betting grid with chip placement, an animated dice cup + reveal, winning-
 * bet highlights, bet summary, history and a provably-fair panel. Drives `useSicBo`,
 * which runs money through the FROZEN runtime/ledger.
 */
import type { PlayerContext } from '@/runtime/game-runtime';
import { type Bet, BetType } from '@/games/sic-bo/types';

import { betKey, useSicBo } from './use-sic-bo';

const DIE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const CHIPS = [10, 50, 100, 500];

export function SicBoTable({ player }: { player?: PlayerContext }) {
  const g = useSicBo(player);
  const winKeys = new Set((g.lastState?.results ?? []).filter((r) => r.won).map((r) => betKey(r)));

  const Cell = ({ bet, label }: { bet: Bet; label: string }) => {
    const key = betKey(bet);
    const amt = g.placed.get(key)?.amount ?? 0;
    const won = winKeys.has(key);
    const odds = g.oddsOf(bet);
    return (
      <button onClick={() => g.place(bet)} disabled={g.rolling} style={{ position: 'relative', padding: '12px 6px', borderRadius: 8, border: won ? '2px solid #fbbf24' : '1px solid #334155', background: amt > 0 ? '#1e3a5f' : '#111827', color: '#e5e7eb', cursor: 'pointer', fontSize: 13, fontWeight: 600, minHeight: 52 }}>
        <div>{label}</div>
        <div style={{ fontSize: 10, opacity: 0.6 }}>{Array.isArray(odds) ? `${odds[0]}/${odds[1]}/${odds[2]}:1` : `${odds}:1`}</div>
        {amt > 0 && <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 11, color: '#fbbf24' }}>●{amt}</span>}
      </button>
    );
  };

  return (
    <div style={{ color: '#e5e7eb', background: '#0b0f19', borderRadius: 16, padding: 16, maxWidth: 640, margin: '0 auto' }}>
      {/* dice cup + reveal */}
      <div style={{ textAlign: 'center', fontSize: 54, letterSpacing: 8, minHeight: 64, opacity: g.rolling ? 0.4 : 1, transition: 'opacity 200ms' }}>
        {g.rolling ? '🥣🎲🎲' : g.dice ? g.dice.map((d, i) => <span key={i}>{DIE[d]}</span>) : '🎲🎲🎲'}
      </div>
      {g.lastState && !g.rolling && (
        <div style={{ textAlign: 'center', fontSize: 14, marginBottom: 8 }}>
          Total <b>{g.lastState.total}</b>{g.lastState.isTriple ? ' (Triple!)' : ''} · Payout <b style={{ color: g.lastState.totalPayout > g.lastState.totalStake ? '#34d399' : '#f87171' }}>{g.lastState.totalPayout}</b>
        </div>
      )}

      {/* even-money row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        <Cell bet={{ type: BetType.Small }} label="Small 4–10" />
        <Cell bet={{ type: BetType.Odd }} label="Odd" />
        <Cell bet={{ type: BetType.Even }} label="Even" />
        <Cell bet={{ type: BetType.Big }} label="Big 11–17" />
      </div>

      {/* single numbers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginTop: 6 }}>
        {[1, 2, 3, 4, 5, 6].map((n) => <Cell key={n} bet={{ type: BetType.Single, value: n }} label={`${DIE[n]}`} />)}
      </div>

      {/* any triple + totals sample */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 6 }}>
        <Cell bet={{ type: BetType.AnyTriple }} label="Any Triple" />
        <Cell bet={{ type: BetType.Total, value: 9 }} label="Total 9" />
        <Cell bet={{ type: BetType.Total, value: 10 }} label="Total 10" />
        <Cell bet={{ type: BetType.Total, value: 11 }} label="Total 11" />
      </div>

      {/* controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Chip:</span>
        {CHIPS.map((c) => (
          <button key={c} onClick={() => g.setChip(c)} style={{ padding: '6px 10px', borderRadius: 20, border: g.chip === c ? '2px solid #fbbf24' : '1px solid #374151', background: g.chip === c ? '#78350f' : '#1f2937', color: '#e5e7eb', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>{c}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 13 }}>Stake <b>{g.totalStake}</b></span>
        <button onClick={g.clear} disabled={g.rolling} style={btn('#374151')}>Clear</button>
        <button onClick={() => void g.roll()} disabled={g.rolling || g.placed.size === 0} style={btn('#059669')}>Roll</button>
      </div>
      {g.error && <div style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>⚠ {g.error}</div>}

      {/* history */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>History</div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {g.history.map((h, i) => (
            <div key={i} title={`dice ${h.dice.join(' ')} · payout ${h.totalPayout}`} style={{ flex: '0 0 auto', fontSize: 11, padding: '4px 8px', borderRadius: 6, background: h.totalPayout > h.totalStake ? '#064e3b' : '#3f1d1d', color: h.totalPayout > h.totalStake ? '#6ee7b7' : '#fca5a5' }}>
              {h.dice.join('·')} {h.multiplier > 0 ? `${h.multiplier.toFixed(2)}×` : ''}
            </div>
          ))}
          {g.history.length === 0 && <span style={{ fontSize: 12, opacity: 0.5 }}>No rolls yet</span>}
        </div>
      </div>

      {/* provably-fair panel */}
      {g.history[0] && (
        <details style={{ marginTop: 12, fontSize: 12, background: '#0f1629', borderRadius: 8, padding: 10 }}>
          <summary style={{ cursor: 'pointer', opacity: 0.85 }}>Provably Fair — verify the last roll</summary>
          <dl style={{ margin: '8px 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
            <dt style={{ opacity: 0.6 }}>Server seed hash</dt><dd style={{ wordBreak: 'break-all' }}>{g.history[0].serverSeedHash ?? '—'}</dd>
            <dt style={{ opacity: 0.6 }}>Client seed</dt><dd>{g.history[0].clientSeed}</dd>
            <dt style={{ opacity: 0.6 }}>Nonce</dt><dd>{g.history[0].nonce}</dd>
            <dt style={{ opacity: 0.6 }}>Dice</dt><dd>{g.history[0].dice.join(', ')}</dd>
            <dt style={{ opacity: 0.6 }}>Winning bets</dt><dd>{g.history[0].winningBets.map((w) => w.type).join(', ') || 'none'}</dd>
          </dl>
        </details>
      )}
    </div>
  );
}

function btn(bg: string): React.CSSProperties {
  return { padding: '8px 14px', borderRadius: 8, border: 'none', background: bg, color: 'white', fontWeight: 700, cursor: 'pointer' };
}

export default SicBoTable;
