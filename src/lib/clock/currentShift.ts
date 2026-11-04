import type { ClockServerResult, ClockShift, CurrentShiftResult } from '@/services/clockApi'
import type { ClockEvent, ClockKind } from './clockEvents'

/**
 * The one answer to "am I clocked in?" on the new clock path (P3).
 *
 * Truth is the server's current_shift(): the open shift for this login, with no
 * calendar-day window, so a night shift is still open after midnight. Between
 * server answers it is kept up to date from clock results (which carry the
 * shift), and scans still waiting on the phone are laid over it: a waiting
 * clock-in counts as on shift, a waiting clock-out as off shift. The last
 * server answer is cached on the phone, per person, for showing offline only.
 */
export const SHIFT_CACHE_KEY = 'clock.currentShift.v2'

export interface CurrentShiftView {
  status: 'on_shift' | 'off_shift' | 'unknown'
  openShift: ClockShift | null
  lastClosed: ClockShift | null
  /** The newest scan of this person still waiting on the phone. */
  pendingEvent: ClockEvent | null
  pendingCount: number
  /** When the shift started: the server's time, or the scan time while it waits. */
  clockInAt: string | null
  needsSignIn: boolean
  /** The last refresh could not reach the server. */
  offline: boolean
  /** No server answer yet in this app session; showing what the phone remembered. */
  fromCache: boolean
}

interface Snapshot {
  userId: string
  openShift: ClockShift | null
  lastClosed: ClockShift | null
  checkedAtMs: number
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface ShiftStoreDeps {
  fetchCurrentShift: () => Promise<CurrentShiftResult>
  pending: (userId: string) => ClockEvent[]
  storage?: KeyValueStore
  now?: () => number
}

export interface ShiftStore {
  getView(userId: string): CurrentShiftView
  refresh(userId: string): Promise<CurrentShiftView>
  applyResult(userId: string, kind: ClockKind, result: ClockServerResult): void
  /** Something the view depends on changed (e.g. the outbox). */
  notify(): void
  subscribe(listener: () => void): () => void
  /** Changes on every update; for useSyncExternalStore. */
  version(): number
  /** Tests only. */
  reset(): void
}

const readCache = (storage: KeyValueStore | undefined, userId: string): Snapshot | null => {
  try {
    const raw = storage?.getItem(SHIFT_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Snapshot
    return parsed && parsed.userId === userId ? parsed : null
  } catch {
    return null
  }
}

const writeCache = (storage: KeyValueStore | undefined, snapshot: Snapshot) => {
  try {
    storage?.setItem(SHIFT_CACHE_KEY, JSON.stringify(snapshot))
  } catch {
    // The cache is only for offline display; the server stays the truth.
  }
}

const CLOCK_IN_OPEN = new Set(['clocked_in', 'already_clocked_in'])
const SHIFT_NOW_CLOSED = new Set(['clocked_out', 'already_clocked_out', 'late_clock_out', 'too_late', 'already_corrected'])

/** The snapshot after a clock answer, or null when the answer says nothing about the shift. */
const snapshotAfter = (prev: Snapshot, kind: ClockKind, result: ClockServerResult, now: number): Snapshot | null => {
  if (kind === 'clock_in' && result.ok && CLOCK_IN_OPEN.has(result.code)) {
    return { ...prev, openShift: result.shift, checkedAtMs: now }
  }
  if (SHIFT_NOW_CLOSED.has(result.code)) {
    return { ...prev, openShift: null, lastClosed: result.shift ?? prev.lastClosed, checkedAtMs: now }
  }
  if (result.code === 'no_open_shift') return { ...prev, openShift: null, checkedAtMs: now }
  return null
}

const deriveView = (
  snapshot: Snapshot | null,
  queued: ClockEvent[],
  flags: { needsSignIn: boolean; offline: boolean; confirmed: boolean },
): CurrentShiftView => {
  // A scan on its first send isn't "waiting" yet: the screen that sent it is
  // still waiting for the answer and must not change under the cleaner.
  const pending = queued.filter((event) => event.attempts > 0)
  const pendingEvent = pending.length ? pending[pending.length - 1] : null
  const openShift = snapshot?.openShift ?? null
  const serverStatus = snapshot ? (openShift ? 'on_shift' : 'off_shift') : 'unknown'
  const status = pendingEvent ? (pendingEvent.kind === 'clock_in' ? 'on_shift' : 'off_shift') : serverStatus
  const pendingClockIn = pendingEvent?.kind === 'clock_in' ? new Date(pendingEvent.scannedAtMs).toISOString() : null
  return {
    status,
    openShift: status === 'on_shift' ? openShift : null,
    lastClosed: snapshot?.lastClosed ?? null,
    pendingEvent,
    pendingCount: pending.length,
    clockInAt: status === 'on_shift' ? (openShift?.clockIn ?? pendingClockIn) : null,
    needsSignIn: flags.needsSignIn,
    offline: flags.offline,
    fromCache: Boolean(snapshot) && !flags.confirmed,
  }
}

export function createShiftStore(deps: ShiftStoreDeps): ShiftStore {
  const now = deps.now ?? (() => Date.now())
  const listeners = new Set<() => void>()
  let snapshot: Snapshot | null = null
  let confirmed = false
  let offline = false
  let needsSignIn = false
  let version = 0
  // Bumped by every clock result, so a refresh that started earlier can't undo it.
  let writeSeq = 0

  const notify = () => {
    version += 1
    listeners.forEach((listener) => listener())
  }

  const snapshotFor = (userId: string): Snapshot | null => {
    if (snapshot?.userId === userId) return snapshot
    snapshot = readCache(deps.storage, userId)
    confirmed = false
    return snapshot
  }

  const commit = (next: Snapshot) => {
    snapshot = next
    confirmed = true
    writeCache(deps.storage, next)
    notify()
  }

  const getView = (userId: string) =>
    deriveView(snapshotFor(userId), deps.pending(userId), { needsSignIn, offline, confirmed })

  const refresh = async (userId: string): Promise<CurrentShiftView> => {
    if (!userId) return getView(userId)
    const startedAt = writeSeq
    const answer = await deps.fetchCurrentShift()
    if (answer.ok) {
      offline = false
      needsSignIn = false
      if (startedAt === writeSeq) {
        commit({ userId, openShift: answer.openShift, lastClosed: answer.lastClosed, checkedAtMs: now() })
      } else notify()
    } else {
      needsSignIn = answer.code === 'not_signed_in'
      offline = answer.code !== 'not_signed_in'
      notify()
    }
    return getView(userId)
  }

  const applyResult = (userId: string, kind: ClockKind, result: ClockServerResult) => {
    const base = snapshotFor(userId) ?? { userId, openShift: null, lastClosed: null, checkedAtMs: 0 }
    const next = snapshotAfter(base, kind, result, now())
    if (!next) return
    writeSeq += 1
    needsSignIn = false
    offline = false
    commit(next)
  }

  return {
    getView,
    refresh,
    applyResult,
    notify,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    version: () => version,
    reset: () => {
      snapshot = null
      confirmed = false
      offline = false
      needsSignIn = false
      writeSeq = 0
      notify()
    },
  }
}
