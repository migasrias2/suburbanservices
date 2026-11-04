import { useSyncExternalStore } from 'react'
import { getClockFlags, type ClockFlags } from '@/services/clockApi'

/**
 * The remote kill switches `clock_v2` and `scanner_v2` (D9: default ON).
 *
 * Read once at app start and again whenever the app comes back to the front,
 * and remembered on the phone. What each case does, and why:
 * - Server answered: use it and remember it.
 * - Server unreachable: keep the last answer this phone saw. A switch an admin
 *   turned off stays off while the phone is offline.
 * - Never read on this phone: ON, as decided in D9. The new path is the one
 *   that copes with no signal (the outbox), so it is the safer default.
 * - The server has no switch table (the clock migration isn't applied yet):
 *   new clock OFF, since its RPCs don't exist either; the new camera stays ON.
 */
export type ClockSwitches = { clockV2: boolean; scannerV2: boolean }

export const CLOCK_FLAGS_CACHE_KEY = 'clock.flags.v1'

const DEFAULT_SWITCHES: ClockSwitches = { clockV2: true, scannerV2: true }

const listeners = new Set<() => void>()
let current: ClockSwitches | null = null

const readCache = (): ClockSwitches | null => {
  try {
    const raw = globalThis.localStorage?.getItem?.(CLOCK_FLAGS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ClockSwitches>
    if (typeof parsed?.clockV2 !== 'boolean' || typeof parsed?.scannerV2 !== 'boolean') return null
    return { clockV2: parsed.clockV2, scannerV2: parsed.scannerV2 }
  } catch {
    return null
  }
}

const writeCache = (switches: ClockSwitches) => {
  try {
    globalThis.localStorage?.setItem?.(CLOCK_FLAGS_CACHE_KEY, JSON.stringify({ ...switches, savedAt: Date.now() }))
  } catch {
    // Remembering is a convenience; the in-memory value still applies.
  }
}

const publish = (next: ClockSwitches) => {
  const changed = !current || current.clockV2 !== next.clockV2 || current.scannerV2 !== next.scannerV2
  current = next
  if (changed) listeners.forEach((listener) => listener())
}

/** The switches to use right now (synchronous). */
export function getClockSwitches(): ClockSwitches {
  if (!current) current = readCache() ?? DEFAULT_SWITCHES
  return current
}

/** Ask the server again. Never throws. */
export async function refreshClockSwitches(fetchFlags: () => Promise<ClockFlags> = getClockFlags): Promise<ClockSwitches> {
  try {
    const flags = await fetchFlags()
    if (flags.source === 'default') return getClockSwitches()
    const next = { clockV2: flags.clockV2, scannerV2: flags.scannerV2 }
    writeCache(next)
    publish(next)
    return next
  } catch (error) {
    console.warn('Could not read the clock switches; keeping the last known ones', error)
    return getClockSwitches()
  }
}

export function subscribeClockSwitches(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** React hook: the current switches, re-rendering when they change. */
export function useClockSwitches(): ClockSwitches {
  return useSyncExternalStore(subscribeClockSwitches, getClockSwitches, getClockSwitches)
}

/** Tests only: forget the in-memory value (and the stored one unless kept). */
export function resetClockSwitchesForTests(options: { keepStorage?: boolean } = {}): void {
  current = null
  if (!options.keepStorage) {
    try {
      globalThis.localStorage?.removeItem?.(CLOCK_FLAGS_CACHE_KEY)
    } catch {
      // ignore
    }
  }
}

/** Tests only: force the switches. */
export function setClockSwitchesForTests(switches: ClockSwitches): void {
  publish(switches)
}
