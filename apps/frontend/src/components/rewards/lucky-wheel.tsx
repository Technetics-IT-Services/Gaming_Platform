'use client';

import { Button, cn } from '@gaming-platform/ui';
import { motion } from 'framer-motion';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { GameFx, type FxSignal } from '@/components/games/prototype/game-fx';
import { sound } from '@/lib/sound';
import { DemoFundsBadge } from '@/components/wallet/demo-funds-badge';
import { useDemoWallet } from '@/stores/demo-wallet';
import { usePlayerProfile } from '@/stores/player-profile';

interface Prize {
  label: string;
  coins: number;
  xp: number;
  color: string;
}

const PRIZES: Prize[] = [
  { label: '500', coins: 500, xp: 0, color: '#6d28d9' },
  { label: '100 XP', coins: 0, xp: 100, color: '#0e7490' },
  { label: '1,000', coins: 1000, xp: 0, color: '#be185d' },
  { label: 'BOX', coins: 750, xp: 50, color: '#b45309' },
  { label: '250', coins: 250, xp: 0, color: '#15803d' },
  { label: '250 XP', coins: 0, xp: 250, color: '#4338ca' },
  { label: '2,500', coins: 2500, xp: 0, color: '#9d174d' },
  { label: 'JACKPOT', coins: 5000, xp: 500, color: '#a16207' },
];
const SEG = 360 / PRIZES.length;
// Deterministic-ish spin sequence so results feel varied but reproducible.
const SEQUENCE = [2, 5, 0, 7, 3, 1, 6, 4];

export function LuckyWheel() {
  const bonus = useDemoWallet((s) => s.bonus);
  const addXp = usePlayerProfile((s) => s.addXp);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [fx, setFx] = useState<FxSignal>({ key: 0, type: null });
  const spinCount = useRef(0);
  const fxKey = useRef(0);

  const spin = () => {
    if (spinning) return;
    setSpinning(true);
    sound.play('wheel');
    const idx = SEQUENCE[spinCount.current % SEQUENCE.length]!;
    spinCount.current += 1;
    // land segment idx center under the top pointer
    const target = 360 * 5 + (360 - idx * SEG - SEG / 2);
    setRotation((r) => Math.floor(r / 360) * 360 + target);
    window.setTimeout(() => {
      const prize = PRIZES[idx]!;
      if (prize.coins) bonus(prize.coins, { label: 'Lucky Wheel', source: 'lucky-wheel' });
      if (prize.xp) addXp(prize.xp);
      sound.play(prize.label === 'JACKPOT' ? 'jackpot' : 'reward');
      fxKey.current += 1;
      setFx({ key: fxKey.current, type: 'win', amount: prize.coins || prize.xp });
      toast.success(
        prize.label === 'JACKPOT'
          ? '🎉 JACKPOT! +5,000 coins +500 XP'
          : `You won ${prize.coins ? `${prize.coins.toLocaleString('en-US')} coins` : `${prize.xp} XP`}!`,
      );
      setSpinning(false);
    }, 3600);
  };

  return (
    <div className="card-premium relative flex flex-col items-center overflow-hidden p-6">
      <GameFx trigger={fx} />
      <h3 className="mb-1 flex items-center gap-2 font-display text-lg font-bold">
        Lucky Wheel <DemoFundsBadge />
      </h3>
      <p className="mb-4 text-sm text-muted-foreground">Spin for coins, XP & jackpots</p>

      <div className="relative h-60 w-60">
        {/* pointer */}
        <div className="absolute left-1/2 top-[-6px] z-20 h-0 w-0 -translate-x-1/2 border-x-8 border-t-[14px] border-x-transparent border-t-gold drop-shadow" />
        <motion.div
          animate={{ rotate: rotation }}
          transition={{ duration: 3.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative h-60 w-60 rounded-full border-4 border-white shadow-elevated"
          style={{
            background: `conic-gradient(${PRIZES.map((p, i) => `${p.color} ${i * SEG}deg ${(i + 1) * SEG}deg`).join(',')})`,
          }}
        >
          {PRIZES.map((p, i) => (
            <span
              key={i}
              className="absolute left-1/2 top-1/2 origin-left text-[11px] font-bold text-white drop-shadow"
              style={{ transform: `rotate(${i * SEG + SEG / 2}deg) translateX(38px)` }}
            >
              {p.label}
            </span>
          ))}
          <div className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-gradient-to-br from-primary to-violet shadow-glow" />
        </motion.div>
      </div>

      <Button
        variant="gradient"
        size="lg"
        className={cn('sheen mt-6 w-full', spinning && 'opacity-70')}
        onClick={spin}
        disabled={spinning}
      >
        {spinning ? 'Spinning…' : 'SPIN'}
      </Button>
    </div>
  );
}
