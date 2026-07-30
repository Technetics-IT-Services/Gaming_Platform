'use client';

import type {
  IBetRequest,
  IFairnessProof,
  IGameResult,
  IGameSession,
  IProvablyFairProvider,
} from '@gaming-platform/types';
import { SettlementType } from '@gaming-platform/types';

import type { RuntimeGameEngine } from '@/runtime/engine-registry';

/**
 * Slots engine (Phase 3 migration, flexible settlement).
 *
 * PURE reel logic — the runtime owns bet/RNG/settlement/history. The reel strips,
 * symbol pay table, three-of-a-kind / pair / jackpot rules are byte-for-byte the
 * previous in-component logic; only the per-spin seed moves to the provably-fair
 * provider. Absolute payouts (base win + jackpot) flow through the flexible
 * `ISettlementResult` (Win / Jackpot). The dynamic jackpot pool + game title are
 * supplied per round by the UI (the one generic slot renderer serves many titles).
 */
export const SYMBOLS = [
  { char: '🍒', pay: 4, label: 'Cherry' },
  { char: '🍋', pay: 5, label: 'Lemon' },
  { char: '🔔', pay: 8, label: 'Bell' },
  { char: '⭐', pay: 12, label: 'Star' },
  { char: '💎', pay: 25, label: 'Diamond' },
  { char: '7️⃣', pay: 50, label: 'Seven' },
] as const;

export const STRIP = 32;
export const ROWS = 3;
export const REELS = 3;

export function fnv(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic PRNG — same seed → same stream. No global RNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable per-reel strip of symbol indices, derived from the slug. */
export function buildStrip(slug: string, reel: number): number[] {
  const rnd = mulberry32(fnv(`${slug}::reel::${reel}`));
  return Array.from({ length: STRIP }, () => Math.floor(rnd() * SYMBOLS.length));
}

/** Per-round input from the UI: which slot title + the live jackpot pool. */
export interface SlotsPick {
  slug: string;
  jackpot: number;
}

export interface SlotsState {
  targets: number[];
  results: number[];
  win: number;
  label: string;
  isJackpot: boolean;
}

export class SlotsEngine implements RuntimeGameEngine<unknown, SlotsPick, SlotsState> {
  readonly engineKey = 'slots';

  createRound(input: {
    session: IGameSession;
    bet: IBetRequest<SlotsPick>;
    config: unknown;
    rng: IProvablyFairProvider;
    fairness: IFairnessProof;
  }): IGameResult<SlotsState> {
    const { session, bet, rng, fairness } = input;
    const { slug, jackpot } = bet.selections[0]!.pick;
    const stake = Number(bet.stake.amount);

    const strips = Array.from({ length: REELS }, (_, r) => buildStrip(slug, r));
    const r = rng.nextFloat({ serverSeed: fairness.serverSeed ?? '', clientSeed: fairness.clientSeed, nonce: fairness.nonce });
    const rnd = mulberry32(Math.floor(r * 2 ** 31));
    // Land within a safe window so a full 3-row view is always valid (preserved).
    const targets = strips.map(() => 1 + Math.floor(rnd() * (STRIP - ROWS - 1)));
    const results = targets.map((o, reel) => strips[reel]![(o + 1) % STRIP]!);

    const [a, b, c] = results as [number, number, number];
    let win = 0;
    let label = 'No win';
    let isJackpot = false;
    if (a === b && b === c) {
      win = SYMBOLS[a]!.pay * stake;
      if (SYMBOLS[a]!.char === '7️⃣') {
        win += jackpot;
        isJackpot = true;
        label = 'Jackpot!';
      } else {
        label = `Three ${SYMBOLS[a]!.label}s`;
      }
    } else if (a === b || b === c || a === c) {
      win = Math.round(stake * 1.5);
      label = 'Matching pair';
    }

    const isWin = win > 0;
    const value = stake > 0 && isWin ? win / stake : 0;
    const display = { label, value };

    return {
      roundId: '',
      gameId: session.gameId,
      state: { targets, results, win, label, isJackpot },
      multiplier: value,
      win: isWin,
      fairness,
      computedAt: new Date().toISOString(),
      display,
      settlement: isWin
        ? {
            type: isJackpot ? SettlementType.Jackpot : SettlementType.Win,
            payout: String(win),
            multiplier: value,
            metadata: isJackpot ? { jackpot: true, symbol: SYMBOLS[a]!.char } : undefined,
            reason: label,
            display,
          }
        : { type: SettlementType.Loss, payout: '0', reason: label, display },
    };
  }
}
