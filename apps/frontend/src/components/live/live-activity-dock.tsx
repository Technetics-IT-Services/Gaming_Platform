'use client';

import { cn } from '@gaming-platform/ui';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  Award,
  ChevronRight,
  Coins,
  Medal,
  PartyPopper,
  Rocket,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Trophy,
  UserPlus,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import {
  type ActivityEvent,
  type ActivityKind,
  type ActivityTone,
  activityAt,
  playersOnline,
  seedActivity,
} from '@/lib/live-activity';

/* -------------------------------------------------------------------------- */
/* Live Activity Dock — a persistent, collapsible right-edge panel that streams */
/* a deterministic platform activity feed (wins, jackpots, friends, level-ups,  */
/* tournaments, achievements, purchases). Additive and global across the         */
/* ecosystem shell. Client-only (renders nothing until mounted) and suppressed   */
/* under reduced motion, so it never affects SSR, hydration, or visual tests.    */
/* -------------------------------------------------------------------------- */

const KIND_ICON: Record<ActivityKind, typeof Rocket> = {
  win: Rocket,
  multiplier: TrendingUp,
  jackpot: Coins,
  friend: UserPlus,
  levelup: Sparkles,
  tournament: Trophy,
  achievement: Medal,
  purchase: ShoppingBag,
  avatar: Award,
};

const TONE_TEXT: Record<ActivityTone, string> = {
  good: 'text-emerald',
  gold: 'text-gold',
  violet: 'text-violet',
  accent: 'text-accent',
  neutral: 'text-foreground',
};

const TONE_RING: Record<ActivityTone, string> = {
  good: 'ring-emerald/30 bg-emerald/10',
  gold: 'ring-gold/30 bg-gold/10',
  violet: 'ring-violet/30 bg-violet/10',
  accent: 'ring-accent/30 bg-accent/10',
  neutral: 'ring-black/10 bg-black/5',
};

const STORAGE_KEY = 'gp-live-dock-open';
const SEED_COUNT = 8;
const STREAM_MS = 5200;

function ActivityRow({ event }: { event: ActivityEvent }) {
  const Icon = KIND_ICON[event.kind];
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, height: 0, marginTop: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      className="flex items-start gap-2.5 rounded-xl bg-black/[0.03] p-2.5"
    >
      <span
        className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
          TONE_RING[event.tone],
          TONE_TEXT[event.tone],
        )}
        aria-hidden
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-xs font-semibold text-foreground">{event.text}</p>
        <p className="truncate text-[11px] text-muted-foreground">{event.detail}</p>
      </div>
    </motion.li>
  );
}

export function LiveActivityDock() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[]>(() => seedActivity(SEED_COUNT));
  const [phase, setPhase] = useState(0);
  const tickRef = useRef(SEED_COUNT);

  // Client-only + reduced-motion gate. Renders nothing on the server and under
  // reduced motion, matching the platform's existing live widgets.
  useEffect(() => {
    const reduced =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.classList.contains('reduce-motion');
    if (reduced) return;
    setMounted(true);
    try {
      setOpen(window.localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      /* storage unavailable — default collapsed */
    }
  }, []);

  // Advance the deterministic stream and the live-count phase.
  useEffect(() => {
    if (!mounted) return;
    const id = window.setInterval(() => {
      const next = activityAt(tickRef.current);
      tickRef.current += 1;
      setEvents((prev) => [next, ...prev].slice(0, SEED_COUNT));
      setPhase((p) => p + 1);
    }, STREAM_MS);
    return () => window.clearInterval(id);
  }, [mounted]);

  if (!mounted) return null;

  const online = playersOnline(11_800, phase);

  const toggle = (nextOpen: boolean) => {
    setOpen(nextOpen);
    try {
      window.localStorage.setItem(STORAGE_KEY, nextOpen ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="pointer-events-none fixed right-0 top-1/2 z-40 -translate-y-1/2">
      <AnimatePresence initial={false} mode="wait">
        {open ? (
          <motion.aside
            key="panel"
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 32 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            aria-label="Live activity"
            className="glass-strong pointer-events-auto mr-3 flex max-h-[70vh] w-[min(88vw,20rem)] flex-col overflow-hidden rounded-2xl border border-black/10 shadow-elevated"
          >
            <div className="flex items-center justify-between border-b border-black/5 px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald opacity-70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald" />
                </span>
                <span className="font-display text-sm font-bold">Live Activity</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 rounded-full bg-emerald/10 px-2 py-0.5 text-[10px] font-bold text-emerald ring-1 ring-inset ring-emerald/30">
                  <Activity className="h-3 w-3" />
                  <span className="tabular-nums">{online.toLocaleString('en-US')}</span>
                </span>
                <button
                  type="button"
                  onClick={() => toggle(false)}
                  aria-label="Collapse live activity"
                  className="-m-1 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <ul className="flex-1 space-y-1.5 overflow-y-auto p-2.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <AnimatePresence initial={false}>
                {events.map((e) => (
                  <ActivityRow key={e.id} event={e} />
                ))}
              </AnimatePresence>
            </ul>
            <Link
              href="/events"
              className="flex items-center justify-center gap-1.5 border-t border-black/5 py-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/5"
            >
              <PartyPopper className="h-3.5 w-3.5" /> Open Event Center
            </Link>
          </motion.aside>
        ) : (
          <motion.button
            key="tab"
            type="button"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            onClick={() => toggle(true)}
            aria-label={`Show live activity — ${online.toLocaleString('en-US')} online`}
            className="glass-strong pointer-events-auto flex flex-col items-center gap-2 rounded-l-2xl border border-r-0 border-black/10 px-2 py-3 shadow-glow-sm transition-transform hover:-translate-x-0.5"
          >
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald" />
            </span>
            <span
              className="text-[10px] font-bold uppercase tracking-widest text-emerald [writing-mode:vertical-rl]"
              style={{ textOrientation: 'mixed' }}
            >
              Live
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
