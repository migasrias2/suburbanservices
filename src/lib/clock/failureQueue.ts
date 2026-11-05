import { buildClockFailureRow, type ClockFailure } from '@/services/clockFailureService'
import type { SessionState } from './outbox'

/**
 * Clock failure reports (D7c).
 *
 * A report made while signed out, or one that couldn't get through, is kept on
 * the phone and sent after its creator next signs in, never anonymously and
 * never under someone else's login (review L4). Kept reports are capped and
 * expire after a week; they are diagnostics, not payroll. Writes always merge
 * with what is stored, so a report added during a flush is never lost.
 */
export const FAILURE_QUEUE_KEY = 'clock.failureReports.v1'
export const MAX_QUEUED_FAILURES = 30
const MAX_AGE_MS = 7 * 24 * 3600_000

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type InsertResult = { error: { message?: string; code?: string } | null }
type Row = ReturnType<typeof buildClockFailureRow>

interface QueuedFailure {
  id: string
  /** Who made the report: it is only ever sent under this login. */
  userId: string | null
  row: Row
  queuedAtMs: number
}

export interface FailureQueueDeps {
  storage: () => KeyValueStore | undefined
  insert: (row: Row) => Promise<InsertResult>
  readSession: () => Promise<SessionState>
  now?: () => number
}

export interface FailureQueue {
  report(failure: ClockFailure, userId: string | null): Promise<void>
  flush(): Promise<void>
  size(): number
}

const isQueued = (value: unknown): value is QueuedFailure => {
  const item = value as Partial<QueuedFailure> | null
  return !!item && typeof item.id === 'string' && typeof item.queuedAtMs === 'number' && !!item.row
}

export function createFailureQueue(deps: FailureQueueDeps): FailureQueue {
  const now = deps.now ?? (() => Date.now())
  let memory: QueuedFailure[] = []
  let counter = 0

  const read = (): QueuedFailure[] => {
    try {
      const raw = deps.storage()?.getItem(FAILURE_QUEUE_KEY)
      if (!raw) return memory
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(isQueued) : []
    } catch {
      return memory
    }
  }

  const fresh = (items: QueuedFailure[]) => items.filter((item) => now() - item.queuedAtMs < MAX_AGE_MS)

  const write = (items: QueuedFailure[]) => {
    memory = fresh(items).slice(-MAX_QUEUED_FAILURES)
    try {
      deps.storage()?.setItem(FAILURE_QUEUE_KEY, JSON.stringify(memory))
    } catch {
      // Memory still holds them for this tab.
    }
  }

  // Only "didn't get through" is worth keeping. A database refusal has a code
  // and would be refused again.
  const send = async (row: Row): Promise<'sent' | 'keep' | 'refused'> => {
    try {
      const { error } = await deps.insert(row)
      if (!error) return 'sent'
      return error.code ? 'refused' : 'keep'
    } catch {
      return 'keep'
    }
  }

  const keep = (row: Row, userId: string | null) => {
    counter += 1
    write([...read(), { id: `${now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`, userId, row, queuedAtMs: now() }])
  }

  // Re-read before removing, so reports added while we were sending stay.
  const removeIds = (ids: Set<string>) => {
    if (ids.size) write(read().filter((item) => !ids.has(item.id)))
  }

  return {
    report: async (failure, userId) => {
      const row = buildClockFailureRow(failure)
      const session = await deps.readSession()
      if (session.status !== 'signed_in' || !userId || session.userId !== userId) return keep(row, userId)
      if ((await send(row)) === 'keep') keep(row, userId)
    },
    flush: async () => {
      const items = fresh(read())
      write(items)
      if (!items.length) return
      const session = await deps.readSession()
      if (session.status !== 'signed_in') return
      const done = new Set<string>()
      for (const item of items.filter((i) => i.userId === session.userId)) {
        if ((await send(item.row)) !== 'keep') done.add(item.id)
      }
      removeIds(done)
    },
    size: () => fresh(read()).length,
  }
}
