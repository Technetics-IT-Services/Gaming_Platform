'use client';

/**
 * PokerTable — Texas Hold'em UI (Sprint 5, dark casino theme, responsive).
 *
 * An oval table with seat positions + dealer button, community cards, the pot, chip
 * stacks, hero hole cards, bet controls (fold / check / call / bet / raise / all-in),
 * hand history, and a provably-fair panel to verify every dealt hand. Drives `usePoker`,
 * which runs the hand on the reusable Poker Table Engine and settles the hero through
 * the FROZEN runtime / ledger.
 */
import { useState } from 'react';

import { PlayingCard } from '@/components/card/playing-card';
import type { PlayerContext } from '@/runtime/game-runtime';
import { PokerActionType } from '@/games/poker/types';

import { usePoker, type SeatView } from './use-poker';

/** Seat coordinates around an oval (seat 0 = hero, bottom centre). */
const SEAT_POS = ['50% 90%', '8% 40%', '50% 6%', '92% 40%'];

export function PokerTable({ player }: { player?: PlayerContext }) {
  const g = usePoker(player);
  const [raiseTo, setRaiseTo] = useState<number>(0);

  return (
    <div style={{ color: '#e5e7eb', maxWidth: 720, margin: '0 auto' }}>
      {/* table */}
      <div style={{ position: 'relative', aspectRatio: '16 / 10', background: 'radial-gradient(ellipse at center, #0f5132 0%, #062916 75%)', border: '10px solid #3f2a12', borderRadius: '48%', boxShadow: 'inset 0 0 60px rgba(0,0,0,.6)' }}>
        {/* community cards + pot */}
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
          <div style={{ display: 'flex', gap: 4, justifyContent: 'center', minHeight: 84 }}>
            {g.board.map((c, i) => <PlayingCard key={c} code={c} index={i} small />)}
          </div>
          <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: '#fbbf24' }}>Pot {g.pot}</div>
          <div style={{ fontSize: 11, opacity: 0.7, textTransform: 'capitalize' }}>{g.street.replace('-', ' ')}</div>
        </div>

        {/* seats */}
        {g.seats.map((s) => (
          <Seat key={s.seat} s={s} pos={SEAT_POS[s.seat] ?? '50% 50%'} />
        ))}
      </div>

      {/* message */}
      <div style={{ textAlign: 'center', margin: '12px 0', minHeight: 20, fontSize: 14 }}>{g.message}</div>

      {/* controls */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {g.phase !== 'playing' && <button onClick={() => void g.newHand()} style={primary('#7c3aed')}>New Hand</button>}
        {g.heroTurn && (
          <>
            {g.legal.includes(PokerActionType.Fold) && <button onClick={() => void g.act(PokerActionType.Fold)} style={primary('#b91c1c')}>Fold</button>}
            {g.legal.includes(PokerActionType.Check) && <button onClick={() => void g.act(PokerActionType.Check)} style={primary('#374151')}>Check</button>}
            {g.legal.includes(PokerActionType.Call) && <button onClick={() => void g.act(PokerActionType.Call)} style={primary('#059669')}>Call {g.toCall}</button>}
            {(g.legal.includes(PokerActionType.Bet) || g.legal.includes(PokerActionType.Raise)) && (
              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                <input type="number" min={g.minRaiseTo} value={raiseTo || g.minRaiseTo} onChange={(e) => setRaiseTo(Number(e.target.value))} style={{ width: 72, padding: '6px 8px', borderRadius: 6, border: '1px solid #334155', background: '#111827', color: '#e5e7eb' }} />
                <button onClick={() => void g.act(g.legal.includes(PokerActionType.Bet) ? PokerActionType.Bet : PokerActionType.Raise, raiseTo || g.minRaiseTo)} style={primary('#0ea5e9')}>
                  {g.legal.includes(PokerActionType.Bet) ? 'Bet' : 'Raise to'}
                </button>
              </span>
            )}
            {g.legal.includes(PokerActionType.AllIn) && <button onClick={() => void g.act(PokerActionType.AllIn)} style={primary('#d97706')}>All-In</button>}
          </>
        )}
      </div>

      {/* history */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>Hand history</div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
          {g.history.length === 0 && <span style={{ fontSize: 12, opacity: 0.5 }}>No hands yet</span>}
          {g.history.map((h, i) => (
            <div key={i} title={`${h.handName ?? ''} board ${h.board.join(' ')}`} style={{ flex: '0 0 auto', fontSize: 11, padding: '4px 8px', borderRadius: 6, background: h.net > 0 ? '#064e3b' : h.net < 0 ? '#3f1d1d' : '#1f2937', color: h.net > 0 ? '#6ee7b7' : h.net < 0 ? '#fca5a5' : '#cbd5e1' }}>
              {h.net > 0 ? `+${h.net}` : h.net}
            </div>
          ))}
        </div>
      </div>

      {/* provably-fair panel */}
      {g.lastProof && (
        <details style={{ marginTop: 12, fontSize: 12, background: '#0f1629', borderRadius: 8, padding: 10 }}>
          <summary style={{ cursor: 'pointer', opacity: 0.85 }}>Provably Fair — verify the last hand</summary>
          <dl style={{ margin: '8px 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', wordBreak: 'break-all' }}>
            <dt style={{ opacity: 0.6 }}>Server seed</dt><dd>{g.lastProof.serverSeed ?? '—'}</dd>
            <dt style={{ opacity: 0.6 }}>Hashed server seed</dt><dd>{g.lastProof.serverSeedHash ?? '—'}</dd>
            <dt style={{ opacity: 0.6 }}>Client seed</dt><dd>{g.lastProof.clientSeed}</dd>
            <dt style={{ opacity: 0.6 }}>Nonce</dt><dd>{g.lastProof.nonce}</dd>
            <dt style={{ opacity: 0.6 }}>Board</dt><dd>{g.lastProof.board.join(', ') || '—'}</dd>
            <dt style={{ opacity: 0.6 }}>Your cards</dt><dd>{g.lastProof.hole.join(', ') || '—'}</dd>
          </dl>
          <p style={{ opacity: 0.55, marginTop: 6 }}>Re-derive the shuffled deck from these seeds (verifyShuffle / replayHand) to confirm the deal.</p>
        </details>
      )}
    </div>
  );
}

function Seat({ s, pos }: { s: SeatView; pos: string }) {
  const [x, y] = pos.split(' ');
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: 'translate(-50%,-50%)', textAlign: 'center', width: 96 }}>
      <div style={{ display: 'flex', gap: 2, justifyContent: 'center', minHeight: 58, opacity: s.folded ? 0.35 : 1 }}>
        {s.hole.length > 0
          ? s.hole.map((c, i) => <PlayingCard key={c} code={c} index={i} small />)
          : !s.folded && <><CardBack /><CardBack /></>}
      </div>
      <div style={{ marginTop: 2, padding: '2px 6px', borderRadius: 6, background: s.isActor ? '#fbbf24' : '#111827', color: s.isActor ? '#111827' : '#e5e7eb', fontSize: 11, fontWeight: 700, border: s.isHero ? '1px solid #34d399' : '1px solid #334155' }}>
        {s.playerId}{s.isButton ? ' Ⓑ' : ''} · {s.stack}
        {s.allIn && <span style={{ color: '#f59e0b' }}> ALL-IN</span>}
        {s.hand && <div style={{ fontWeight: 500, opacity: 0.8 }}>{s.hand}</div>}
        {s.contributed > 0 && !s.hand && <div style={{ fontWeight: 500, opacity: 0.7 }}>bet {s.contributed}</div>}
      </div>
    </div>
  );
}

function CardBack() {
  return <div style={{ width: 28, height: 40, borderRadius: 5, background: 'linear-gradient(135deg,#4c1d95,#7c3aed)', border: '1px solid #a78bfa' }} />;
}

function primary(bg: string): React.CSSProperties {
  return { padding: '9px 14px', borderRadius: 8, border: 'none', background: bg, color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 13 };
}

export default PokerTable;
