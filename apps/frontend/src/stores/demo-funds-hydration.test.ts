import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Client demo funds — the part that only makes sense against real persistence.
 *
 * These tests live apart from `demo-funds.test.ts` because of one hard constraint: zustand's
 * `createJSONStorage(() => localStorage)` resolves the storage ONCE, when the store module is
 * first evaluated. The suite runs in the `node` environment, where `localStorage` does not exist,
 * so a store imported normally has persistence permanently disabled and every hydration assertion
 * would silently pass against a dead store.
 *
 * So the storage stub is installed BEFORE the module is loaded, and the store is imported
 * dynamically inside each test with a fresh module registry. That gives a genuinely persisted
 * store to assert against.
 */

/** Minimal localStorage stand-in, installed before the store module is evaluated. */
function installStorage(seed?: string) {
  const map = new Map<string, string>();
  if (seed) map.set('gp-wallet', seed);
  // The store only arms its grant when a window exists (its SSR guard), so the browser
  // condition has to be simulated as well as the storage.
  vi.stubGlobal('window', globalThis as unknown as Window & typeof globalThis);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  });
  return map;
}

/** Load a pristine copy of the store with the stub already in place. */
async function loadStore() {
  vi.resetModules();
  return (await import('./demo-wallet')).useDemoWallet;
}

const played = JSON.stringify({
  state: { balance: 4_350, vault: 0, transactions: [], bets: [], txnSeq: 3, betSeq: 1 },
  version: 0,
});

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a brand-new browser is granted the play-money automatically', () => {
  it('hydrating with nothing stored leaves the client holding 5,000', async () => {
    installStorage(); // a device that has never opened the app
    const useDemoWallet = await loadStore();
    await useDemoWallet.persist.rehydrate();
    expect(useDemoWallet.getState().balance).toBe(5_000);
  });

  it('writes that balance back to localStorage under gp-wallet, so it survives a reload', async () => {
    const map = installStorage();
    const useDemoWallet = await loadStore();
    await useDemoWallet.persist.rehydrate();
    const stored = map.get('gp-wallet');
    expect(stored, 'gp-wallet written').toBeDefined();
    expect(JSON.parse(stored!).state.balance).toBe(5_000);
  });
});

describe('a returning client keeps their own balance', () => {
  it('hydrating a played wallet restores 4,350 and does NOT re-grant', async () => {
    installStorage(played);
    const useDemoWallet = await loadStore();
    await useDemoWallet.persist.rehydrate();
    // The exact regression this guards: an earlier implementation used `onRehydrateStorage`,
    // which fires BEFORE the merged state lands, so the guard saw an empty wallet and reset the
    // client back to 5,000.
    expect(useDemoWallet.getState().balance).toBe(4_350);
  });

  it('a second reload still does not top them back up', async () => {
    installStorage(played);
    const useDemoWallet = await loadStore();
    await useDemoWallet.persist.rehydrate();
    await useDemoWallet.persist.rehydrate();
    expect(useDemoWallet.getState().balance).toBe(4_350);
  });

  it('a client who spent everything is not refilled on reload', async () => {
    installStorage(
      JSON.stringify({
        state: { balance: 0, vault: 0, transactions: [], bets: [], txnSeq: 7, betSeq: 4 },
        version: 0,
      }),
    );
    const useDemoWallet = await loadStore();
    await useDemoWallet.persist.rehydrate();
    expect(useDemoWallet.getState().balance).toBe(0);
  });
});

describe('hydration never reaches the network', () => {
  it('granting the starting funds makes no request', async () => {
    installStorage();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const useDemoWallet = await loadStore();
    await useDemoWallet.persist.rehydrate();
    expect(useDemoWallet.getState().balance).toBe(5_000);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
