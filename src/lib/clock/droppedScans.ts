import type { ClockKind } from './clockEvents'
import type { FailReason } from './outbox'

/**
 * Scans the outbox had to take out of the line without saving them (a
 * permanent error, too old to send, too many failures). Remembered on the
 * phone per person, so the cleaner is told the next time they open the app,
 * even when it happened in the background or while someone else was signed in.
 * Cleared when the cleaner has seen it.
 */
export const DROPPED_SCANS_KEY = 'clock.droppedScans.v1'
const MAX_KEPT = 20

export interface DroppedScan {
  userId: string
  eventId: string
  kind: ClockKind
  scannedAtMs: number
  reason: FailReason
  code?: string
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

const isDropped = (value: unknown): value is DroppedScan => {
  const d = value as Partial<DroppedScan> | null
  return !!d && typeof d.userId === 'string' && typeof d.eventId === 'string' && typeof d.scannedAtMs === 'number'
}

export function createDroppedScans(store: () => KeyValueStore | undefined) {
  let memory: DroppedScan[] = []

  const read = (): DroppedScan[] => {
    try {
      const raw = store()?.getItem(DROPPED_SCANS_KEY)
      if (!raw) return memory
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(isDropped) : []
    } catch {
      return memory
    }
  }

  const write = (items: DroppedScan[]) => {
    memory = items.slice(-MAX_KEPT)
    try {
      store()?.setItem(DROPPED_SCANS_KEY, JSON.stringify(memory))
    } catch {
      // Memory still shows it in this tab.
    }
  }

  return {
    add: (item: DroppedScan) => write([...read().filter((d) => d.eventId !== item.eventId), item]),
    list: (userId: string) => read().filter((d) => d.userId === userId),
    /** Seen: all of this person's, or one scan the screen already explained. */
    dismiss: (userId: string, eventId?: string) =>
      write(read().filter((d) => d.userId !== userId || (eventId !== undefined && d.eventId !== eventId))),
  }
}
