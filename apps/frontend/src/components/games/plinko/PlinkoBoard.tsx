'use client';

/**
 * PlinkoBoard — the production Plinko UI (Sprint 1, STEP 4).
 *
 * An animated SVG board (peg grid + ball + slot multipliers), risk/row selectors, bet
 * controls (with auto-play + fast mode), a history strip, a provably-fair panel and a
 * sound toggle. Dark casino theme consistent with the platform; responsive across
 * mobile/tablet/desktop. It renders `usePlinko`, which drives money through the FROZEN
 * runtime/ledger — this component performs no settlement and touches no balance.
 */
import { useEffect, useState } from 'react';

import type { PlayerContext } from '@/runtime/game-runtime';
import { binToX } from '@/games/plinko/animation';
import { layoutFor, pegPositions } from '@/games/plinko/layout';
import { PLINKO_RISKS, PLINKO_ROWS, type PlinkoRisk } from '@/games/plinko/types';

import { usePlinko } from './use-plinko';

function useViewportWidth(): number {
  const [w, setW] = useState<number>(typeof window !== 'undefined' ? window.innerWidth : 1024);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

const RISK_COLOR: Record<PlinkoRisk, string> = { low: '#38bdf8', medium: '#a78bfa', high: '#f472b6' };

export function PlinkoBoard({ player }: { player?: PlayerContext }) {
  const g = usePlinko(player);
  const width = useViewportWidth();
  const layout = layoutFor(width, g.rows);
  const [autoRounds, setAutoRounds] = useState(10);

  const board = layout.boardWidth;
  const height = Math.round(board * 0.75);
  const pegs = pegPositions(g.rows);
  const slots = g.table;
  const ballX = g.ball ? (g.ball.x * 0.5 + 0.5) * board : board / 2;
  const ballY = g.ball ? (g.ball.row / (g.rows + 1)) * height : 0;

  return (
    <div className="plinko" style={{ color: '#e5e7eb', background: '#0b0f19', borderRadius: 16, padding: layout.mode === 'mobile' ? 12 : 20, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', flexDirection: layout.stackControls ? 'column' : 'row', gap: 16 }}>
        {/* ---------------------------- board ---------------------------- */}
        <div style={{ flex: '1 1 auto' }}>
          <svg width="100%" viewBox={`0 0 ${board} ${height + 40}`} role="img" aria-label={`Plinko board, ${g.rows} rows, ${g.risk} risk`} style={{ display: 'block' }}>
            {pegs.map((p, i) => (
              <circle key={i} cx={(p.x * 0.5 + 0.5) * board} cy={p.y * height} r={Math.max(2, layout.pegSize / 2)} fill="#334155" />
            ))}
            {/* landed-slot highlight */}
            {g.lastResult && (
              <rect
                x={(binToX(g.lastResult.state.bin, g.rows) * 0.5 + 0.5) * board - board / (2 * (g.rows + 1))}
                y={height}
                width={board / (g.rows + 1)}
                height={26}
                rx={4}
                fill={RISK_COLOR[g.risk]}
                opacity={0.25}
              />
            )}
            {/* ball */}
            <circle cx={ballX} cy={ballY} r={layout.ballSize / 2} fill={g.dropping ? '#fbbf24' : RISK_COLOR[g.risk]} />
          </svg>
          {/* slot multipliers */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${slots.length}, 1fr)`, gap: 2, marginTop: 4 }}>
            {slots.map((m, i) => (
              <div key={i} style={{ textAlign: 'center', fontSize: layout.slotFontPx, padding: '4px 0', borderRadius: 4, background: '#111827', color: m >= 1 ? '#34d399' : '#f87171', fontWeight: 600 }}>
                {m}×
              </div>
            ))}
          </div>
        </div>

        {/* --------------------------- controls -------------------------- */}
        <div style={{ flex: layout.stackControls ? '1 1 auto' : '0 0 260px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: 12, opacity: 0.8 }}>
            Risk
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              {PLINKO_RISKS.map((r) => (
                <button key={r} onClick={() => g.setRisk(r)} disabled={g.dropping} style={btn(g.risk === r, RISK_COLOR[r])}>
                  {r}
                </button>
              ))}
            </div>
          </label>

          <label style={{ fontSize: 12, opacity: 0.8 }}>
            Rows
            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              {PLINKO_ROWS.map((n) => (
                <button key={n} onClick={() => g.setRows(n)} disabled={g.dropping} style={btn(g.rows === n, '#64748b')}>
                  {n}
                </button>
              ))}
            </div>
          </label>

          <label style={{ fontSize: 12, opacity: 0.8 }}>
            Bet amount
            <input type="number" min={1} value={g.stake} disabled={g.dropping} onChange={(e) => g.setStake(Math.max(1, Number(e.target.value) || 1))} style={input()} />
          </label>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => void g.drop()} disabled={g.dropping} style={{ ...primary(), flex: 1 }}>
              {g.dropping ? 'Dropping…' : 'Drop'}
            </button>
            <button onClick={() => void g.autoPlay({ rounds: autoRounds, baseStake: g.stake })} disabled={g.dropping} style={primary('#7c3aed')}>
              Auto ×{autoRounds}
            </button>
          </div>
          <input type="range" min={5} max={100} step={5} value={autoRounds} onChange={(e) => setAutoRounds(Number(e.target.value))} disabled={g.dropping} />

          <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
            <label><input type="checkbox" checked={g.fast} onChange={(e) => g.setFast(e.target.checked)} /> Fast</label>
            <label><input type="checkbox" checked={g.sound} onChange={(e) => g.setSound(e.target.checked)} /> 🔊 Sound</label>
          </div>

          {g.error && <div style={{ color: '#f87171', fontSize: 12 }}>⚠ {g.error}</div>}
          {g.lastResult && (
            <div style={{ fontSize: 13, padding: 8, borderRadius: 8, background: '#111827' }}>
              Landed bin {g.lastResult.state.bin} · <b style={{ color: g.lastResult.state.mult >= 1 ? '#34d399' : '#f87171' }}>{g.lastResult.state.mult}×</b> · payout {g.lastResult.result.payout}
            </div>
          )}
        </div>
      </div>

      {/* ---------------------------- history --------------------------- */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>History</div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {g.history.map((h, i) => (
            <div key={i} title={`nonce ${h.nonce} · bin ${h.bin}`} style={{ flex: '0 0 auto', fontSize: 11, padding: '4px 8px', borderRadius: 6, background: h.mult >= 1 ? '#064e3b' : '#3f1d1d', color: h.mult >= 1 ? '#6ee7b7' : '#fca5a5' }}>
              {h.mult}×
            </div>
          ))}
          {g.history.length === 0 && <span style={{ fontSize: 12, opacity: 0.5 }}>No drops yet</span>}
        </div>
      </div>

      {/* ----------------------- provably-fair panel -------------------- */}
      {g.history[0] && (
        <details style={{ marginTop: 12, fontSize: 12, background: '#0f1629', borderRadius: 8, padding: 10 }}>
          <summary style={{ cursor: 'pointer', opacity: 0.85 }}>Provably Fair — verify the last drop</summary>
          <dl style={{ margin: '8px 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
            <dt style={{ opacity: 0.6 }}>Server seed hash</dt><dd style={{ wordBreak: 'break-all' }}>{g.history[0].serverSeedHash ?? '—'}</dd>
            <dt style={{ opacity: 0.6 }}>Server seed</dt><dd style={{ wordBreak: 'break-all' }}>{g.history[0].serverSeed ?? '(revealed on rotation)'}</dd>
            <dt style={{ opacity: 0.6 }}>Client seed</dt><dd>{g.history[0].clientSeed}</dd>
            <dt style={{ opacity: 0.6 }}>Nonce</dt><dd>{g.history[0].nonce}</dd>
            <dt style={{ opacity: 0.6 }}>Path</dt><dd>{g.history[0].dirs.map((d) => (d === 1 ? 'R' : 'L')).join(' ')}</dd>
            <dt style={{ opacity: 0.6 }}>Landing / multiplier</dt><dd>bin {g.history[0].bin} · {g.history[0].mult}×</dd>
          </dl>
        </details>
      )}
    </div>
  );
}

/* ------------------------------- style helpers ---------------------------- */
function btn(active: boolean, color: string): React.CSSProperties {
  return { flex: 1, padding: '6px 8px', borderRadius: 6, border: `1px solid ${active ? color : '#374151'}`, background: active ? color : '#1f2937', color: active ? '#0b0f19' : '#e5e7eb', textTransform: 'capitalize', cursor: 'pointer', fontSize: 12, fontWeight: 600 };
}
function input(): React.CSSProperties {
  return { width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid #374151', background: '#111827', color: '#e5e7eb' };
}
function primary(bg = '#059669'): React.CSSProperties {
  return { padding: '10px 14px', borderRadius: 8, border: 'none', background: bg, color: 'white', fontWeight: 700, cursor: 'pointer' };
}

export default PlinkoBoard;
