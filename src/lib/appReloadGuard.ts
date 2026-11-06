// Taken synchronously, before a scan/save first awaits. Multiple operations
// can overlap, and only the last one finishing makes a reload safe again.
let active = 0
const listeners = new Set<() => void>()

export const isAppReloadIdle = () => active === 0

export function holdAppReload(): () => void {
  active += 1
  let released = false
  return () => {
    if (released) return
    released = true
    active -= 1
    if (active === 0) listeners.forEach((listener) => listener())
  }
}

export function onAppReloadIdle(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
