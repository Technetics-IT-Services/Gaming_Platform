/**
 * Vitest global setup (Phase 2.3A).
 *
 * The runtime's demo providers delegate to Zustand stores that persist to
 * `localStorage` (`createJSONStorage(() => localStorage)`). Node has no DOM, so we
 * install a minimal in-memory `localStorage` — enough for `persist` to hydrate and
 * write without a jsdom dependency. `crypto.getRandomValues` is already global in
 * Node 20+, which the provably-fair provider relies on.
 */
import { beforeEach } from 'vitest';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
}

// Guard: every test starts from a clean persisted state so store singletons don't
// leak balances/bets across files.
beforeEach(() => {
  globalThis.localStorage.clear();
});
