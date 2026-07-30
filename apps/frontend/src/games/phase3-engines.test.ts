import type { IBetRequest, IFairnessProof, IGameSession, IProvablyFairProvider } from '@gaming-platform/types';
import { BetMode, RuntimeState, SessionStatus, SettlementType } from '@gaming-platform/types';
import { describe, expect, it } from 'vitest';

import { blackjackHand } from '@/lib/deck';
import { AB_PAYOUT, AndarBaharEngine } from './cards/andar-bahar-engine';
import { BACCARAT_PAYOUT, BaccaratEngine } from './cards/baccarat-engine';
import { BlackjackEngine } from './cards/blackjack-engine';
import { CasinoWarEngine } from './cards/casino-war-engine';
import { DT_PAYOUT, DragonTigerEngine } from './cards/dragon-tiger-engine';
import { Lucky7Engine } from './cards/lucky-7-engine';
import { TeenPattiEngine } from './cards/teen-patti-engine';
import { SlotsEngine, type SlotsPick } from './slots-engine';

/**
 * Phase 3 game engines (regression). Each engine is PURE; a stub RNG makes the
 * outcome deterministic so the extracted rules + payouts can't silently drift.
 */

const session: IGameSession = {
  sessionId: 's',
  gameId: 'x',
  playerId: 'demo-player',
  currency: 'INR',
  status: SessionStatus.Active,
  createdAt: '2020-01-01T00:00:00.000Z',
};
const fairness: IFairnessProof = { serverSeed: 'srv', serverSeedHash: 'h', clientSeed: 'cli', nonce: 1 };
const rngReturning = (r: number): IProvablyFairProvider => ({
  commit: () => ({ serverSeed: 'srv', serverSeedHash: 'h' }),
  nextFloat: () => r,
  verify: () => true,
});
const bet = <T>(pick: T, amount = '100'): IBetRequest<T> => ({
  gameId: session.gameId,
  sessionId: 's',
  stake: { amount, currency: 'INR' },
  mode: BetMode.Single,
  selections: [{ pick }],
  idempotencyKey: 'k',
});

describe('dragon-tiger-engine', () => {
  const engine = new DragonTigerEngine();
  const run = (r: number, side: 'dragon' | 'tiger' | 'tie') =>
    engine.createRound({ session, bet: bet(side), config: undefined, rng: rngReturning(r), fairness });

  it('is deterministic and pays PAYOUT[side] on a win, 0 otherwise', () => {
    const res = run(0.42, 'dragon');
    expect(['dragon', 'tiger', 'tie']).toContain(res.state.winner);
    expect(res.win).toBe(res.state.winner === 'dragon');
    expect(res.multiplier).toBe(res.win ? DT_PAYOUT.dragon : 0);
    expect(res.display?.value).toBe(res.win ? DT_PAYOUT.dragon : 0);
    expect(run(0.42, 'dragon').state.winner).toBe(res.state.winner);
  });
});

describe('andar-bahar-engine', () => {
  const engine = new AndarBaharEngine();
  it('deals a valid winning sequence and pays the side table', () => {
    const res = engine.createRound({ session, bet: bet<'andar' | 'bahar'>('andar'), config: undefined, rng: rngReturning(0.3), fairness });
    expect(res.state.sequence.length).toBeGreaterThan(0);
    expect(['andar', 'bahar']).toContain(res.state.winner);
    expect(res.multiplier).toBe(res.win ? AB_PAYOUT.andar : 0);
  });
});

describe('baccarat-engine', () => {
  const engine = new BaccaratEngine();
  it('resolves a coup and pays the bet table (tie = loss for player/banker)', () => {
    const res = engine.createRound({ session, bet: bet<'player' | 'banker' | 'tie'>('player'), config: undefined, rng: rngReturning(0.77), fairness });
    expect(res.state.playerCards.length).toBeGreaterThanOrEqual(2);
    expect(['player', 'banker', 'tie']).toContain(res.state.winner);
    expect(res.win).toBe(res.state.winner === 'player');
    expect(res.multiplier).toBe(res.win ? BACCARAT_PAYOUT.player : 0);
  });
});

describe('lucky-7-engine', () => {
  const engine = new Lucky7Engine();
  it('draws a card and settles under/seven/over', () => {
    const res = engine.createRound({ session, bet: bet<'under' | 'seven' | 'over'>('under'), config: undefined, rng: rngReturning(0.2), fairness });
    expect(res.state.pip).toBeGreaterThanOrEqual(1);
    expect(res.state.pip).toBeLessThanOrEqual(13);
    expect(['under', 'seven', 'over']).toContain(res.state.outcome);
    expect(res.win).toBe(res.state.outcome === 'under');
    expect(res.display?.value).toBe(res.state.pip);
  });
});

describe('teen-patti-engine', () => {
  const engine = new TeenPattiEngine();
  it('deals 3+3 cards, compares hands, wins pay 2 + bonus', () => {
    const res = engine.createRound({ session, bet: bet(null), config: undefined, rng: rngReturning(0.55), fairness });
    expect(res.state.player).toHaveLength(3);
    expect(res.state.dealer).toHaveLength(3);
    expect(res.win).toBe(res.state.cmp > 0);
    if (res.win) expect(res.multiplier).toBeGreaterThanOrEqual(2);
    else expect(res.multiplier).toBe(0);
    expect(res.display?.value).toBe(res.state.playerRank.category);
  });
});

describe('blackjack-engine (interactive)', () => {
  const engine = new BlackjackEngine();
  const startAt = (r: number) => engine.start({ session, bet: bet(null), config: undefined, rng: rngReturning(r), fairness });

  it('deals two cards each and offers hit/stand/double', () => {
    // Find a non-natural deal so we can drive the flow.
    let start = startAt(0.5);
    for (let i = 0; i < 60 && start.state !== RuntimeState.AwaitingPlayer; i += 1) start = startAt(i / 60);
    expect(start.state).toBe(RuntimeState.AwaitingPlayer);
    expect(start.gameState.player).toHaveLength(2);
    expect(start.availableActions).toContain('double');

    const stood = engine.step({ session, bet: bet(null), config: undefined, rng: rngReturning(0.5), fairness, gameState: start.gameState, action: { type: 'stand' } });
    expect(stood.state).toBe(RuntimeState.AwaitingSystem);
    // Dealer stands on 17+ (or busts).
    expect(blackjackHand(stood.gameState.dealer).total).toBeGreaterThanOrEqual(17);

    const resolved = engine.step({ session, bet: bet(null), config: undefined, rng: rngReturning(0.5), fairness, gameState: stood.gameState, action: { type: 'resolve' } });
    expect(resolved.state).toBe(RuntimeState.Completed);
    expect(resolved.settlement).toBeDefined();
  });

  it('rejects an illegal action', () => {
    const start = startAt(0.5);
    expect(() =>
      engine.step({ session, bet: bet(null), config: undefined, rng: rngReturning(0.5), fairness, gameState: start.gameState, action: { type: 'teleport' } }),
    ).toThrow();
  });
});

describe('casino-war-engine (interactive)', () => {
  const engine = new CasinoWarEngine();
  const startAt = (r: number) => engine.start({ session, bet: bet(null), config: undefined, rng: rngReturning(r), fairness });

  it('resolves a non-tie battle, or offers war/surrender on a tie', () => {
    const start = startAt(0.4);
    if (start.state === RuntimeState.AwaitingPlayer) {
      expect(start.availableActions).toEqual(['war', 'surrender']);
      const surrendered = engine.step({ session, bet: bet(null), config: undefined, rng: rngReturning(0.4), fairness, gameState: start.gameState, action: { type: 'surrender' } });
      expect(surrendered.state).toBe(RuntimeState.Completed);
      expect(surrendered.settlement?.type).toBe(SettlementType.Loss);
    } else {
      expect(start.state).toBe(RuntimeState.AwaitingSystem);
      const resolved = engine.step({ session, bet: bet(null), config: undefined, rng: rngReturning(0.4), fairness, gameState: start.gameState, action: { type: 'resolve' } });
      expect(resolved.state).toBe(RuntimeState.Completed);
      expect(['player', 'dealer']).toContain(resolved.gameState.outcome);
    }
  });
});

describe('slots-engine (flexible settlement)', () => {
  const engine = new SlotsEngine();
  const run = (r: number, jackpot = 25_000) =>
    engine.createRound({ session, bet: bet<SlotsPick>({ slug: 'fruit', jackpot }, '10'), config: undefined, rng: rngReturning(r), fairness });

  it('spins three reels and settles win/loss with the pay table', () => {
    const res = run(0.5);
    expect(res.state.targets).toHaveLength(3);
    expect(res.state.results).toHaveLength(3);
    expect(res.win).toBe(res.state.win > 0);
    if (res.win) {
      expect([SettlementType.Win, SettlementType.Jackpot]).toContain(res.settlement?.type);
      expect(Number(res.settlement?.payout)).toBe(res.state.win);
    } else {
      expect(res.settlement?.type).toBe(SettlementType.Loss);
    }
  });

  it('is deterministic for the same fairness', () => {
    expect(run(0.321).state.results).toEqual(run(0.321).state.results);
  });
});
