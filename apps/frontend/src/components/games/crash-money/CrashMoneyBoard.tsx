'use client';

/**
 * CrashMoneyBoard — real-money Crash (Phase 2C.2), mobile-first.
 *
 * Authenticated: the stake is reserved via the backend money bridge (`/games/crash/play`) and
 * the round settles at the SERVER-authoritative multiplier on Cash Out (`/games/crash/cashout`).
 * The rising multiplier shown is a client-side animation for display only; the crash point,
 * payout and balance are always the authoritative server values (no demo wallet). Prominent
 * one-hand Cash Out target. No horizontal overflow at 375/390/412.
 */
import { useCrashMoney } from './use-crash-money';

const STAKE_CHIPS = ['1', '5', '10', '25', '50'];

export function CrashMoneyBoard() {
  const g = useCrashMoney();
  const min = g.config?.limits.min ?? 1;
  const max = g.config?.limits.max ?? 10000;
  const r = g.lastResult;
  const mult = g.running ? g.liveMultiplier : r ? (r.crashPoint ?? 1) : 1;
  const multColor = g.running ? '#fbbf24' : r ? (r.won ? '#34d399' : '#fca5a5') : '#e5e7eb';

  return (
    <div style={{ color: '#e5e7eb', maxWidth: 440, margin: '0 auto', padding: '0 4px', boxSizing: 'border-box' }}>
      {/* sticky authoritative balance */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#0b0f19', padding: '10px 12px', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #1f2937', marginBottom: 12 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Balance</span>
        <b data-testid="balance" style={{ fontSize: 20, color: '#34d399' }}>{g.balance === null ? '—' : `₹${g.balance}`}</b>
      </div>

      {/* multiplier stage */}
      <div style={{ textAlign: 'center', minHeight: 128, background: 'radial-gradient(ellipse at center,#1e1b4b,#0b0f19)', borderRadius: 16, padding: 16, marginBottom: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
        <div data-testid="multiplier" style={{ fontSize: 46, fontWeight: 900, color: multColor, lineHeight: 1 }}>{mult.toFixed(2)}×</div>
        {g.running ? (
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>Round live — cash out before it busts</div>
        ) : r ? (
          <div style={{ marginTop: 8, fontWeight: 800, fontSize: 16, color: r.won ? '#34d399' : '#fca5a5' }}>
            {r.won ? `CASHED OUT ${(r.cashoutMultiplier ?? 0).toFixed(2)}× · WON +₹${r.payout}` : `CRASHED @ ${(r.crashPoint ?? 0).toFixed(2)}× · lost`}
            {r.replayed ? ' · (replayed)' : ''}
          </div>
        ) : (
          <div style={{ marginTop: 8, opacity: 0.6, fontSize: 13 }}>Set a stake and press Play.</div>
        )}
      </div>

      {/* stake + auto cash-out (hidden while running) */}
      {!g.running && (
        <>
          <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Stake (₹{min}–₹{max})</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {STAKE_CHIPS.map((s) => (
              <button key={s} onClick={() => g.setStake(s)} style={chip(g.stake === s)} aria-pressed={g.stake === s}>₹{s}</button>
            ))}
            <input inputMode="decimal" value={g.stake} onChange={(e) => g.setStake(e.target.value.replace(/[^\d.]/g, ''))} aria-label="stake"
              style={{ width: 80, padding: '10px 12px', borderRadius: 10, border: '1px solid #334155', background: '#111827', color: '#e5e7eb', fontSize: 15 }} />
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, margin: '4px 2px' }}>Auto cash-out (optional)</div>
          <input inputMode="decimal" value={g.autoCashout} onChange={(e) => g.setAutoCashout(e.target.value.replace(/[^\d.]/g, ''))} aria-label="auto cash-out" placeholder="e.g. 2.00"
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1px solid #334155', background: '#111827', color: '#e5e7eb', fontSize: 15, marginBottom: 8 }} />
        </>
      )}

      {g.error && <div data-testid="error" style={{ color: '#fca5a5', fontSize: 13, margin: '6px 2px' }}>⚠ {g.error}</div>}

      {/* action — Cash Out while running, else Play. Large one-hand target. */}
      {g.running ? (
        <button data-testid="cashout" onClick={() => void g.cashout()} disabled={g.cashingOut}
          style={{ width: '100%', padding: '18px', borderRadius: 14, border: 'none', background: g.cashingOut ? '#047857' : '#10b981', color: '#04231a', fontWeight: 900, fontSize: 20, cursor: 'pointer', marginTop: 4 }}>
          {g.cashingOut ? 'Cashing out…' : `Cash Out ${g.liveMultiplier.toFixed(2)}×`}
        </button>
      ) : (
        <button data-testid="play" onClick={() => void g.play()} disabled={g.playing || g.balance === null}
          style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', background: g.playing ? '#3730a3' : '#7c3aed', color: 'white', fontWeight: 800, fontSize: 18, cursor: 'pointer', marginTop: 4 }}>
          {g.playing ? 'Starting…' : `Play ₹${g.stake}`}
        </button>
      )}

      <p style={{ fontSize: 11, opacity: 0.45, textAlign: 'center', marginTop: 10 }}>
        Real-money round · provably fair · crash point &amp; balance are authoritative from the server.
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

export default CrashMoneyBoard;
