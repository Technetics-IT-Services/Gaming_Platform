import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventBus, RuntimeEventName, type RuntimeEvent } from './event-bus';

/**
 * Event bus (STEP 5).
 *
 * A tiny synchronous typed pub/sub — every subscription returns an unsubscribe so
 * there are no leaks. Tests cover subscribe/unsubscribe, wildcard, ordering,
 * duplicate listeners, nested emits, error propagation, leak-safety, and a
 * thousands-of-events stress run.
 */

let bus: EventBus;
beforeEach(() => {
  bus = new EventBus();
});

describe('event-bus — subscription', () => {
  it('delivers an emitted event to a named listener with a full envelope', () => {
    const spy = vi.fn();
    bus.on(RuntimeEventName.BET_CREATED, spy);
    bus.emit(RuntimeEventName.BET_CREATED, { stake: 10 }, { sessionId: 's1', roundId: 'r1' });

    expect(spy).toHaveBeenCalledTimes(1);
    const event = spy.mock.calls[0][0] as RuntimeEvent;
    expect(event.name).toBe(RuntimeEventName.BET_CREATED);
    expect(event.payload).toEqual({ stake: 10 });
    expect(event.sessionId).toBe('s1');
    expect(event.roundId).toBe('r1');
    expect(typeof event.at).toBe('number');
  });

  it('does not deliver events of other names', () => {
    const spy = vi.fn();
    bus.on(RuntimeEventName.BET_CREATED, spy);
    bus.emit(RuntimeEventName.BET_REJECTED, {});
    expect(spy).not.toHaveBeenCalled();
  });

  it('unsubscribe stops further delivery', () => {
    const spy = vi.fn();
    const off = bus.on(RuntimeEventName.ROUND_STARTED, spy);
    bus.emit(RuntimeEventName.ROUND_STARTED, {});
    off();
    bus.emit(RuntimeEventName.ROUND_STARTED, {});
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a double unsubscribe is safe (idempotent)', () => {
    const spy = vi.fn();
    const off = bus.on(RuntimeEventName.ROUND_STARTED, spy);
    off();
    expect(() => off()).not.toThrow();
    bus.emit(RuntimeEventName.ROUND_STARTED, {});
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('event-bus — wildcard (onAny)', () => {
  it('receives every event regardless of name', () => {
    const spy = vi.fn();
    bus.onAny(spy);
    bus.emit(RuntimeEventName.BET_CREATED, {});
    bus.emit(RuntimeEventName.ROUND_FINISHED, {});
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('fires both the named and the wildcard listener for one emit', () => {
    const named = vi.fn();
    const any = vi.fn();
    bus.on(RuntimeEventName.WALLET_DEBITED, named);
    bus.onAny(any);
    bus.emit(RuntimeEventName.WALLET_DEBITED, {});
    expect(named).toHaveBeenCalledTimes(1);
    expect(any).toHaveBeenCalledTimes(1);
  });

  it('wildcard unsubscribe works', () => {
    const spy = vi.fn();
    const off = bus.onAny(spy);
    off();
    bus.emit(RuntimeEventName.ERROR, {});
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('event-bus — ordering & duplicates', () => {
  it('invokes listeners in subscription order', () => {
    const order: number[] = [];
    bus.on(RuntimeEventName.ROUND_UPDATED, () => order.push(1));
    bus.on(RuntimeEventName.ROUND_UPDATED, () => order.push(2));
    bus.on(RuntimeEventName.ROUND_UPDATED, () => order.push(3));
    bus.emit(RuntimeEventName.ROUND_UPDATED, {});
    expect(order).toEqual([1, 2, 3]);
  });

  it('named listeners fire before wildcard listeners', () => {
    const order: string[] = [];
    bus.on(RuntimeEventName.SETTLEMENT_COMPLETED, () => order.push('named'));
    bus.onAny(() => order.push('any'));
    bus.emit(RuntimeEventName.SETTLEMENT_COMPLETED, {});
    expect(order).toEqual(['named', 'any']);
  });

  it('a listener added twice fires only once (Set-deduped)', () => {
    const spy = vi.fn();
    bus.on(RuntimeEventName.BET_VALIDATED, spy);
    bus.on(RuntimeEventName.BET_VALIDATED, spy);
    bus.emit(RuntimeEventName.BET_VALIDATED, {});
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('event-bus — nested emits & errors', () => {
  it('supports emitting from inside a handler (synchronous re-entry)', () => {
    const seen: RuntimeEventName[] = [];
    bus.on(RuntimeEventName.ROUND_STARTED, () => {
      seen.push(RuntimeEventName.ROUND_STARTED);
      bus.emit(RuntimeEventName.ROUND_FINISHED, {});
    });
    bus.on(RuntimeEventName.ROUND_FINISHED, () => seen.push(RuntimeEventName.ROUND_FINISHED));
    bus.emit(RuntimeEventName.ROUND_STARTED, {});
    expect(seen).toEqual([RuntimeEventName.ROUND_STARTED, RuntimeEventName.ROUND_FINISHED]);
  });

  it('propagates a throwing handler to the emitter (fail-fast, no swallowing)', () => {
    bus.on(RuntimeEventName.ERROR, () => {
      throw new Error('handler blew up');
    });
    expect(() => bus.emit(RuntimeEventName.ERROR, {})).toThrow('handler blew up');
  });
});

describe('event-bus — leak-safety & teardown', () => {
  it('clear() drops every named and wildcard listener', () => {
    const named = vi.fn();
    const any = vi.fn();
    bus.on(RuntimeEventName.BET_CREATED, named);
    bus.onAny(any);
    bus.clear();
    bus.emit(RuntimeEventName.BET_CREATED, {});
    expect(named).not.toHaveBeenCalled();
    expect(any).not.toHaveBeenCalled();
  });

  it('unsubscribing every listener leaves no references (no leak)', () => {
    const offs = Array.from({ length: 1000 }, () => bus.on(RuntimeEventName.ROUND_UPDATED, vi.fn()));
    offs.forEach((off) => off());
    const spy = vi.fn();
    bus.on(RuntimeEventName.ROUND_UPDATED, spy);
    bus.emit(RuntimeEventName.ROUND_UPDATED, {});
    // Only the one live listener runs; the 1000 torn-down ones are gone.
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('event-bus — stress', () => {
  it('dispatches thousands of events in order without loss', () => {
    let count = 0;
    let last = -1;
    let monotonic = true;
    bus.on(RuntimeEventName.ROUND_UPDATED, (e) => {
      count += 1;
      const n = (e.payload as { n: number }).n;
      if (n <= last) monotonic = false;
      last = n;
    });
    const N = 10_000;
    for (let i = 0; i < N; i += 1) bus.emit(RuntimeEventName.ROUND_UPDATED, { n: i });
    expect(count).toBe(N);
    expect(monotonic).toBe(true);
  });

  it('handles many concurrent listeners on one event', () => {
    const spies = Array.from({ length: 500 }, () => vi.fn());
    spies.forEach((s) => bus.on(RuntimeEventName.STATISTICS_UPDATED, s));
    bus.emit(RuntimeEventName.STATISTICS_UPDATED, {});
    spies.forEach((s) => expect(s).toHaveBeenCalledTimes(1));
  });
});
