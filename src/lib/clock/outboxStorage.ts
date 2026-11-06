import type { ClockEvent } from './clockEvents'

/**
 * Where clock scans wait on the phone.
 *
 * localStorage, not IndexedDB, on purpose:
 * - It is synchronous, so the scan is on the phone before the request starts,
 *   with no transaction that can still be pending when the tab is killed.
 * - The shared IndexedDB helpers in offlineStore.ts can't take a new store
 *   without bumping DB_VERSION, and that upgrade waits for every old tab to
 *   close its connection. offlineStore never closes its connections, so one
 *   old tab would leave the clock-in hanging.
 * - Each event is under 3 KB and only a handful ever wait at once.
 */
export interface OutboxStorage {
  read(): ClockEvent[]
  write(events: ClockEvent[]): void
  /** The next place in line: always above every number handed out or stored before. */
  nextSeq(): number
  /** False when a reload would lose a scan kept only in this tab's memory. */
  isDurable(): boolean
}

export const OUTBOX_STORAGE_KEY = 'clock.outbox.v1'
const SEQ_SUFFIX = '.seq'

const highestSeq = (events: ClockEvent[]) => events.reduce((max, e) => Math.max(max, e.seq ?? 0), 0)

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

const isEvent = (value: unknown): value is ClockEvent => {
  const e = value as Partial<ClockEvent> | null
  return (
    !!e &&
    typeof e.eventId === 'string' &&
    typeof e.userId === 'string' &&
    (e.kind === 'clock_in' || e.kind === 'clock_out') &&
    typeof e.qrPayload === 'string' &&
    typeof e.scannedAtMs === 'number'
  )
}

const parseEvents = (raw: string | null): ClockEvent[] => {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isEvent) : []
  } catch {
    return []
  }
}

/** In memory only: for tests, and as the fallback when storage is blocked. */
export function createMemoryOutboxStorage(initial: ClockEvent[] = []): OutboxStorage {
  let events = [...initial]
  let counter = highestSeq(initial)
  return {
    read: () => [...events],
    write: (next) => {
      events = [...next]
    },
    nextSeq: () => {
      counter = Math.max(counter, highestSeq(events)) + 1
      return counter
    },
    isDurable: () => events.length === 0,
  }
}

/**
 * Backed by localStorage. If storage throws (private mode, quota), the scan
 * still lives in memory for this tab, so it is still sent and retried.
 */
export function createLocalOutboxStorage(store: () => KeyValueStore | undefined, key = OUTBOX_STORAGE_KEY): OutboxStorage {
  const memory = createMemoryOutboxStorage()
  // Once a write has failed, storage no longer has every scan: memory does.
  let degraded = false
  let lastSeq = 0

  const read = (): ClockEvent[] => {
    if (degraded) return memory.read()
    try {
      const target = store()
      return target ? parseEvents(target.getItem(key)) : memory.read()
    } catch {
      return memory.read()
    }
  }

  const write = (events: ClockEvent[]) => {
    memory.write(events)
    try {
      const target = store()
      if (!target) return
      target.setItem(key, JSON.stringify(events))
    } catch (error) {
      degraded = true
      console.warn('Could not save clock scans on this phone; keeping them in memory', error)
    }
  }

  const storedSeq = (): number => {
    try {
      return Number(store()?.getItem(key + SEQ_SUFFIX)) || 0
    } catch {
      return 0
    }
  }

  // A stored counter, so the order survives reloads and is shared by tabs.
  // Never below a number already in the queue (a cleared counter, another tab).
  const nextSeq = (): number => {
    lastSeq = Math.max(lastSeq, storedSeq(), highestSeq(read())) + 1
    try {
      store()?.setItem(key + SEQ_SUFFIX, String(lastSeq))
    } catch {
      // This tab's own counter still keeps its scans in order.
    }
    return lastSeq
  }

  const isDurable = () => {
    const events = read()
    if (!events.length) return true
    try {
      if (degraded || !store()) return false
      const stored = parseEvents(store()?.getItem(key) ?? null)
      return events.every((event) => stored.some((saved) => JSON.stringify(saved) === JSON.stringify(event)))
    } catch {
      return false
    }
  }

  return { read, write, nextSeq, isDurable }
}
