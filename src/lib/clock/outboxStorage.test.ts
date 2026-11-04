import { describe, expect, it } from 'vitest'
import { createLocalOutboxStorage, createMemoryOutboxStorage, OUTBOX_STORAGE_KEY } from './outboxStorage'
import type { ClockEvent } from './clockEvents'

const event = (overrides: Partial<ClockEvent> = {}): ClockEvent => ({
  eventId: 'e1',
  userId: 'u1',
  kind: 'clock_in',
  qrPayload: 'Adams Clock-in',
  scannedAtMs: 1,
  location: null,
  device: {},
  attempts: 0,
  nextAttemptAtMs: 0,
  ...overrides,
})

const memoryStore = () => {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  }
}

describe('outbox storage on localStorage', () => {
  it('round-trips scans through storage, so a new tab or a reload sees them', () => {
    const store = memoryStore()
    createLocalOutboxStorage(() => store).write([event()])
    expect(createLocalOutboxStorage(() => store).read()).toEqual([event()])
  })

  it('reads a corrupt entry as empty, and skips entries that are not scans', () => {
    const store = memoryStore()
    store.setItem(OUTBOX_STORAGE_KEY, '{oops')
    expect(createLocalOutboxStorage(() => store).read()).toEqual([])
    store.setItem(OUTBOX_STORAGE_KEY, JSON.stringify([event(), { eventId: 2 }, null]))
    expect(createLocalOutboxStorage(() => store).read()).toEqual([event()])
  })

  it('keeps scans in memory when storage is full, and keeps reading them from memory', () => {
    const store = memoryStore()
    store.setItem(OUTBOX_STORAGE_KEY, JSON.stringify([]))
    const storage = createLocalOutboxStorage(() => ({
      getItem: store.getItem,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
    }))
    storage.write([event()])
    expect(storage.read()).toEqual([event()])
  })

  it('works in memory when there is no storage at all', () => {
    const storage = createLocalOutboxStorage(() => undefined)
    storage.write([event()])
    expect(storage.read()).toEqual([event()])
  })

  it('hands out increasing sequence numbers that survive a reload (review L1)', () => {
    const store = memoryStore()
    const first = createLocalOutboxStorage(() => store)
    const a = first.nextSeq()
    const b = first.nextSeq()
    expect(b).toBeGreaterThan(a)
    const reloaded = createLocalOutboxStorage(() => store)
    expect(reloaded.nextSeq()).toBeGreaterThan(b)
  })

  it('never hands out a number below one already stored (another tab, a cleared counter)', () => {
    const store = memoryStore()
    store.setItem(OUTBOX_STORAGE_KEY, JSON.stringify([event({ seq: 41 })]))
    expect(createLocalOutboxStorage(() => store).nextSeq()).toBe(42)
  })
})

describe('memory outbox storage', () => {
  it('numbers scans in order', () => {
    const storage = createMemoryOutboxStorage()
    expect(storage.nextSeq()).toBeLessThan(storage.nextSeq())
  })
})
