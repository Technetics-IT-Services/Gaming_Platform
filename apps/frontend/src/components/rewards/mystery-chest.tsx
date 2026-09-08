'use client';

import { Button } from '@gaming-platform/ui';
import { AnimatePresence, motion } from 'framer-motion';
import { Gift, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { GameFx, type FxSignal } from '@/components/games/prototype/game-fx';
import { sound } from '@/lib/sound';
import { DemoFundsBadge } from '@/components/wallet/demo-funds-badge';
import { useDemoWallet } from '@/stores/demo-wallet';
import { usePlayerProfile } from '@/stores/player-profile';

const LOOT = [
  { label: '1,500 Coins', coins: 1500, xp: 0 },
  { label: '300 XP', coins: 0, xp: 300 },
  { label: 'Rare Badge + 800', coins: 800, xp: 100 },
  { label: '3,000 Coins', coins: 3000, xp: 0 },
  { label: 'Epic Frame + 500', coins: 500, xp: 200 },
  { label: 'Legendary Title!', coins: 2000, xp: 400 },
];
const SEQ = [0, 3, 1, 5, 2, 4];

export function MysteryChest() {
  const bonus = useDemoWallet((s) => s.bonus);
  const addXp = usePlayerProfile((s) => s.addXp);
  const [opening, setOpening] = useState(false);
  const [reveal, setReveal] = useState<string | null>(null);
  const [fx, setFx] = useState<FxSignal>({ key: 0, type: null });
  const count = useRef(0);
  const fxKey = useRef(0);

  const open = () => {
    if (opening) return;
    setOpening(true);
    setReveal(null);
    sound.play('chips');
    window.setTimeout(() => {
      const loot = LOOT[SEQ[count.current % SEQ.length]!]!;
      count.current += 1;
      if (loot.coins) bonus(loot.coins, { label: 'Mystery Chest', source: 'mystery-chest' });
      if (loot.xp) addXp(loot.xp);
      fxKey.current += 1;
      setFx({ key: fxKey.current, type: 'win', amount: loot.coins || loot.xp });
      sound.play('reward');
      setReveal(loot.label);
      toast.success(`Mystery Chest: ${loot.label}! 🎁`);
      setOpening(false);
    }, 900);
  };

  return (
    <div className="card-premium relative flex flex-col items-center overflow-hidden p-6 text-center">
      <GameFx trigger={fx} />
      <h3 className="mb-1 flex items-center gap-2 font-display text-lg font-bold">
        Mystery Chest <DemoFundsBadge />
      </h3>
      <p className="mb-4 text-sm text-muted-foreground">Open for a surprise reward</p>

      <motion.div
        animate={opening ? { rotate: [0, -6, 6, -6, 6, 0], scale: [1, 1.05, 1] } : {}}
        transition={{ duration: 0.9 }}
        className="relative flex h-40 w-40 items-center justify-center"
      >
        <div className="absolute inset-0 animate-glow-pulse rounded-3xl bg-gradient-to-br from-gold/30 to-warning/20 blur-2xl" />
        <div className="relative flex h-32 w-32 items-center justify-center rounded-3xl bg-gradient-to-br from-gold to-warning text-white shadow-glow-gold">
          <Gift className="h-16 w-16" />
        </div>
      </motion.div>

      <div className="mt-3 h-6">
        <AnimatePresence>
          {reveal ? (
            <motion.p
              key={reveal}
              initial={{ opacity: 0, y: 8, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="flex items-center justify-center gap-1 font-display text-sm font-bold text-gradient-gold"
            >
              <Sparkles className="h-4 w-4 text-gold" /> {reveal}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>

      <Button variant="gold" size="lg" className="sheen mt-3 w-full" onClick={open} disabled={opening}>
        {opening ? 'Opening…' : 'Open Chest'}
      </Button>
    </div>
  );
}
