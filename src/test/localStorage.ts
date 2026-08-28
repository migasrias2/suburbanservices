/**
 * A real in-memory Storage for tests.
 *
 * This project's jsdom environment exposes `localStorage` as a bare object with
 * no Storage methods, so `localStorage.setItem(...)` throws and
 * `localStorage.setItem?.(...)` silently does nothing — which quietly turns any
 * "a stale localStorage value must not be trusted" test into one that passes
 * without ever seeding the stale value. Install this first in any test that
 * depends on storage actually working.
 */
export function installTestLocalStorage(): Storage {
  const store = new Map<string, string>()

  const storage: Storage = {
    get length() {
      return store.size
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }

  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  })

  return storage
}
