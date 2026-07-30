import type { IBetRequest, IFairnessProof, IGameResult, IGameSession } from '@gaming-platform/types';
import { BetMode, RoundStatus, SessionStatus } from '@gaming-platform/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { SessionManager } from './session-manager';

/**
 * Session manager (STEP 4).
 *
 * Pure in-memory bookkeeper for session + round lifecycle. Tests cover create/get,
 * idle timeout, round lifecycle (pending → in-progress → settled/voided),
 * concurrent sessions, replay data, and memory pruning.
 */

const fairness = (nonce = 1): IFairnessProof => ({
  serverSeed: 'server',
  serverSeedHash: 'hash',
  clientSeed: 'client',
  nonce,
});

const betFor = (session: IGameSession): IBetRequest => ({
  gameId: session.gameId,
  sessionId: session.sessionId,
  stake: { amount: '10', currency: session.currency },
  mode: BetMode.Single,
  selections: [{ pick: 2 }],
  idempotencyKey: `idem-${session.sessionId}`,
});

const resultFor = (session: IGameSession): IGameResult => ({
  roundId: '',
  gameId: session.gameId,
  state: { crashPoint: 2.5 },
  multiplier: 0,
  win: false,
  computedAt: new Date().toISOString(),
});

let mgr: SessionManager;
beforeEach(() => {
  mgr = new SessionManager(10_000);
});

const newSession = (m: SessionManager = mgr) =>
  m.createSession({ gameId: 'crash', playerId: 'demo-player', currency: 'INR' });

describe('session-manager — create / get', () => {
  it('creates an active session with the expected shape', () => {
    const s = newSession();
    expect(s.sessionId).toMatch(/^sess_/);
    expect(s.gameId).toBe('crash');
    expect(s.playerId).toBe('demo-player');
    expect(s.currency).toBe('INR');
    expect(s.status).toBe(SessionStatus.Active);
    expect(() => new Date(s.createdAt).toISOString()).not.toThrow();
  });

  it('carries the provably-fair commit hash when provided', () => {
    const s = mgr.createSession({ gameId: 'crash', playerId: 'p', currency: 'INR', serverSeedHash: 'abc123' });
    expect(s.serverSeedHash).toBe('abc123');
  });

  it('returns the stored session by id and null for an unknown id', () => {
    const s = newSession();
    expect(mgr.getSession(s.sessionId)).toBe(s);
    expect(mgr.getSession('nope')).toBeNull();
  });

  it('issues distinct ids for concurrent sessions', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newSession().sessionId));
    expect(ids.size).toBe(50);
  });
});

describe('session-manager — idle timeout', () => {
  it('a fresh session is not expired', () => {
    const s = newSession();
    expect(mgr.isExpired(s.sessionId)).toBe(false);
    expect(mgr.getSession(s.sessionId)?.status).toBe(SessionStatus.Active);
  });

  it('marks the session Expired once past the idle window', () => {
    const expiring = new SessionManager(-1); // any elapsed time exceeds the window
    const s = newSession(expiring);
    expect(expiring.isExpired(s.sessionId)).toBe(true);
    expect(expiring.getSession(s.sessionId)?.status).toBe(SessionStatus.Expired);
  });

  it('touch resets the idle clock (no expiry within the window)', () => {
    const s = newSession();
    mgr.touch(s.sessionId);
    expect(mgr.isExpired(s.sessionId)).toBe(false);
  });

  it('isExpired is false for an unknown session (nothing to expire)', () => {
    expect(mgr.isExpired('ghost')).toBe(false);
  });

  it('touch on an unknown session is a safe no-op', () => {
    expect(() => mgr.touch('ghost')).not.toThrow();
  });
});

describe('session-manager — round lifecycle', () => {
  it('creates a pending round bound to its session + fairness', () => {
    const s = newSession();
    const round = mgr.createRound({ session: s, bet: betFor(s), fairness: fairness() });
    expect(round.roundId).toMatch(/^round_/);
    expect(round.status).toBe(RoundStatus.Pending);
    expect(round.session).toBe(s);
    expect(round.fairness.nonce).toBe(1);
    expect(mgr.getRound(round.roundId)).toBe(round);
  });

  it('getRound returns null for an unknown round', () => {
    expect(mgr.getRound('missing')).toBeNull();
  });

  it('setResult moves the round to in-progress and attaches the outcome', () => {
    const s = newSession();
    const round = mgr.createRound({ session: s, bet: betFor(s), fairness: fairness() });
    const result = resultFor(s);
    mgr.setResult(round.roundId, result);
    expect(mgr.getRound(round.roundId)?.status).toBe(RoundStatus.InProgress);
    expect(mgr.getRound(round.roundId)?.result).toBe(result);
  });

  it('settle marks the round settled and stamps settledAt', () => {
    const s = newSession();
    const round = mgr.createRound({ session: s, bet: betFor(s), fairness: fairness() });
    mgr.settle(round.roundId);
    const stored = mgr.getRound(round.roundId);
    expect(stored?.status).toBe(RoundStatus.Settled);
    expect(typeof stored?.settledAt).toBe('number');
  });

  it('cancel voids the round and stamps settledAt', () => {
    const s = newSession();
    const round = mgr.createRound({ session: s, bet: betFor(s), fairness: fairness() });
    mgr.cancel(round.roundId);
    const stored = mgr.getRound(round.roundId);
    expect(stored?.status).toBe(RoundStatus.Voided);
    expect(typeof stored?.settledAt).toBe('number');
  });

  it('lifecycle mutators are safe no-ops on an unknown round', () => {
    expect(() => mgr.setResult('x', resultFor(newSession()))).not.toThrow();
    expect(() => mgr.settle('x')).not.toThrow();
    expect(() => mgr.cancel('x')).not.toThrow();
  });

  it('increments the nonce across successive rounds when the runtime supplies it', () => {
    const s = newSession();
    const r1 = mgr.createRound({ session: s, bet: betFor(s), fairness: fairness(1) });
    const r2 = mgr.createRound({ session: s, bet: betFor(s), fairness: fairness(2) });
    expect(r1.roundId).not.toBe(r2.roundId);
    expect(mgr.getReplay(r1.roundId)?.nonce).toBe(1);
    expect(mgr.getReplay(r2.roundId)?.nonce).toBe(2);
  });
});

describe('session-manager — replay', () => {
  it('returns the fairness proof needed to reproduce a round', () => {
    const s = newSession();
    const round = mgr.createRound({ session: s, bet: betFor(s), fairness: fairness(7) });
    expect(mgr.getReplay(round.roundId)).toEqual(fairness(7));
  });

  it('returns null replay for an unknown round', () => {
    expect(mgr.getReplay('nope')).toBeNull();
  });
});

describe('session-manager — memory pruning', () => {
  it('drops settled rounds older than the retention window', () => {
    const s = newSession();
    const round = mgr.createRound({ session: s, bet: betFor(s), fairness: fairness() });
    mgr.settle(round.roundId);
    mgr.prune(-1); // treat every settled round as stale
    expect(mgr.getRound(round.roundId)).toBeNull();
  });

  it('keeps unsettled rounds and recently-settled rounds', () => {
    const s = newSession();
    const pending = mgr.createRound({ session: s, bet: betFor(s), fairness: fairness() });
    const settled = mgr.createRound({ session: s, bet: betFor(s), fairness: fairness(2) });
    mgr.settle(settled.roundId);
    mgr.prune(10 * 60_000); // generous window — nothing is stale yet
    expect(mgr.getRound(pending.roundId)).not.toBeNull();
    expect(mgr.getRound(settled.roundId)).not.toBeNull();
  });
});
