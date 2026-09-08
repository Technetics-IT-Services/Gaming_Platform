'use client';

/**
 * DiceMoneyBoard — the first REAL-MONEY game flow (Phase 2B), mobile-first.
 *
 * Authenticated: stakes are placed via the backend money bridge (`/games/dice/play`); the
 * wallet balance shown is the authoritative server value (no demo wallet). Touch-friendly
 * controls, sticky balance, numeric stake chips, loading + result + error states, and safe
 * repeated-tap handling. No horizontal overflow at 375/390/412.
 */
import { useDiceMoney } from './use-dice-money';

const STAKE_CHIPS = ['1', '5', '10', '25', '50'];

export function DiceMoneyBoard() {
  const g = useDiceMoney();
  const bets = g.config?.bets ?? [{ key: 'big', label: 'Big', payout: 2 }, { key: 'small', label: 'Small', payout: 2 }];
  const min = g.config?.limits.min ?? 1;
  const max = g.config?.limits.max ?? 10000;
  const r = g.lastResult;

  return (
    <div style={{ color: '#e5e7eb', maxWidth: 440, margin: '0 auto', padding: '0 4px', boxSizing: 'border-box' }}>
      {/* sticky authoritative balance */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0b0f19', padding: '10px 12px', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #1f2937', marginBottom: 12 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Balance</span>
        <b data-testid="balance" style={{ fontSize: 20, color: '#34d399' }}>{g.balance === null ? '—' : `₹${g.balance}`}</b>
      </div>

      {/* winning numbers / result */}
      <div style={{ textAlign: 'center', minHeight: 92, background: 'radial-gradient(ellipse at center,#0f5132,#062916)', borderRadius: 16, padding: 14, marginBottom: 12 }}>
        {r ? (
          <>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              {r.result.values.map((v, i) => (
                <span key={i} style={{ width: 40, height: 40, borderRadius: 8, background: '#fff', color: '#111827', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 20 }}>{v}</span>
              ))}
            </div>
            <div style={{ marginTop: 8, fontWeight: 800, fontSize: 16, color: r.result.won ? '#34d399' : '#fca5a5' }}>
              {r.result.won ? `WON +₹${r.payout}` : 'No win'}
            </div>
            <div style={{ fontSize: 11, opacity: 0.6 }}>total {r.result.total}{r.replayed ? ' · (replayed)' : ''}</div>
          </>
        ) : (
          <div style={{ opacity: 0.6, fontSize: 13, paddingTop: 28 }}>Pick a stake and a bet, then Play.</div>
        )}
      </div>

      {/* bet selector */}
      <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Bet</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {bets.map((b) => (
          <button key={b.key} onClick={() => g.setBetType(b.key)} style={chip(g.betType === b.key)} aria-pressed={g.betType === b.key}>
            {b.label} <span style={{ opacity: 0.6 }}>×{b.payout}</span>
          </button>
        ))}
      </div>

      {/* stake selector */}
      <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Stake (₹{min}–₹{max})</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {STAKE_CHIPS.map((s) => (
          <button key={s} onClick={() => g.setStake(s)} style={chip(g.stake === s)} aria-pressed={g.stake === s}>₹{s}</button>
        ))}
        <input inputMode="decimal" value={g.stake} onChange={(e) => g.setStake(e.target.value.replace(/[^\d.]/g, ''))} aria-label="stake"
          style={{ width: 80, padding: '10px 12px', borderRadius: 10, border: '1px solid #334155', background: '#111827', color: '#e5e7eb', fontSize: 15 }} />
      </div>

      {g.error && <div data-testid="error" style={{ color: '#fca5a5', fontSize: 13, margin: '6px 2px' }}>⚠ {g.error}</div>}

      {/* play — large one-hand tap target */}
      <button data-testid="play" onClick={() => void g.play()} disabled={g.playing || g.balance === null}
        style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: g.playing ? '#3730a3' : '#7c3aed', color: 'white', fontWeight: 800, fontSize: 18, cursor: 'pointer', marginTop: 4 }}>
        {g.playing ? 'Playing…' : `Play ₹${g.stake}`}
      </button>

      <p style={{ fontSize: 11, opacity: 0.45, textAlign: 'center', marginTop: 10 }}>
        Real-money round · provably fair · balance is authoritative from the server.
      </p>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return {
    padding: '11px 14px', minWidth: 56, borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700,
    border: active ? '2px solid #fbbf24' : '1px solid #334155',
    background: active ? '#78350f' : '#111827', color: '#e5e7eb',
  };
}

export default DiceMoneyBoard;
