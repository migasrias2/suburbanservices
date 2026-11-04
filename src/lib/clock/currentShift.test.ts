import { describe, expect, it, vi } from 'vitest'
import type { ClockServerResult, ClockShift, CurrentShiftResult } from '@/services/clockApi'
import { createShiftStore, SHIFT_CACHE_KEY } from './currentShift'
import type { ClockEvent } from './clockEvents'

const USER = 'user-1'

const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

const shift = (overrides: Partial<ClockShift> = {}): ClockShift => ({
  id: 4196,
  workerRole: 'cleaner',
  customerName: 'Adams',
  siteName: 'Adams',
  clockIn: '2026-11-04T22:00:00.000Z',
  clockOut: null,
  businessDay: '2026-11-04',
  needsReview: false,
  clockInSource: 'scan',
  closeSource: null,
  autoClosed: false,
  clockOutMissing: false,
  ...overrides,
})

const serverSays = (openShift: ClockShift | null, lastClosed: ClockShift | null = null): CurrentShiftResult => ({
  ok: true,
  code: openShift ? 'clocked_in' : 'not_clocked_in',
  openShift,
  lastClosed,
  serverNow: '2026-11-05T01:00:00.000Z',
  londonToday: '2026-11-05',
})

const result = (overrides: Partial<ClockServerResult>): ClockServerResult =>
  ({
    ok: true,
    code: 'clocked_in',
    message: '',
    shift: shift(),
    flags: [],
    qr: null,
    replay: false,
    serverNow: '2026-11-04T22:00:00.000Z',
    ...overrides,
  }) as ClockServerResult

const pendingEvent = (overrides: Partial<ClockEvent> = {}): ClockEvent => ({
  eventId: 'e1',
  userId: USER,
  kind: 'clock_in',
  qrPayload: 'Adams Clock-in',
  scannedAtMs: Date.parse('2026-11-04T22:05:00.000Z'),
  location: null,
  device: {},
  attempts: 1,
  nextAttemptAtMs: 0,
  ...overrides,
})

const setup = (opts: { fetch?: () => Promise<CurrentShiftResult>; pending?: ClockEvent[]; storage?: ReturnType<typeof memoryStorage> } = {}) => {
  const storage = opts.storage ?? memoryStorage()
  let pending = opts.pending ?? []
  const fetchCurrentShift = vi.fn(opts.fetch ?? (async () => serverSays(null)))
  const store = createShiftStore({ fetchCurrentShift, pending: (u) => pending.filter((e) => e.userId === u), storage })
  return {
    store,
    storage,
    fetchCurrentShift,
    setPending: (next: ClockEvent[]) => {
      pending = next
      store.notify()
    },
  }
}

describe('current shift: server truth', () => {
  it('is unknown before any answer', () => {
    const { store } = setup()
    expect(store.getView(USER).status).toBe('unknown')
  })

  it('is on shift when the server has an open shift, whatever the calendar day', async () => {
    // Clocked in at 22:00, asked at 01:00 the next day.
    const { store } = setup({ fetch: async () => serverSays(shift()) })
    const view = await store.refresh(USER)
    expect(view.status).toBe('on_shift')
    expect(view.openShift?.id).toBe(4196)
    expect(view.clockInAt).toBe('2026-11-04T22:00:00.000Z')
    expect(view.offline).toBe(false)
  })

  it('is off shift when the server says so, and keeps the last closed shift', async () => {
    const closed = shift({ clockOut: '2026-11-05T06:00:00.000Z', autoClosed: true, clockOutMissing: true })
    const { store } = setup({ fetch: async () => serverSays(null, closed) })
    const view = await store.refresh(USER)
    expect(view.status).toBe('off_shift')
    expect(view.lastClosed?.autoClosed).toBe(true)
  })

  it('flags a lost login instead of guessing', async () => {
    const { store } = setup({ fetch: async () => ({ ok: false, code: 'not_signed_in', message: 'x' }) })
    const view = await store.refresh(USER)
    expect(view.needsSignIn).toBe(true)
    expect(view.status).toBe('unknown')
  })
})

describe('current shift: optimistic updates from clock results', () => {
  it('goes on shift from a clock-in result without asking the server', () => {
    const { store, fetchCurrentShift } = setup()
    store.applyResult(USER, 'clock_in', result({ code: 'clocked_in' }))
    expect(store.getView(USER).status).toBe('on_shift')
    expect(fetchCurrentShift).not.toHaveBeenCalled()
  })

  it('goes off shift from a clock-out result and remembers the closed shift', () => {
    const { store } = setup()
    store.applyResult(USER, 'clock_in', result({ code: 'clocked_in' }))
    store.applyResult(USER, 'clock_out', result({ code: 'clocked_out', shift: shift({ clockOut: '2026-11-05T06:00:00.000Z' }) }))
    const view = store.getView(USER)
    expect(view.status).toBe('off_shift')
    expect(view.lastClosed?.clockOut).toBe('2026-11-05T06:00:00.000Z')
  })

  it('goes off shift when the server says there was no open shift', () => {
    const { store } = setup()
    store.applyResult(USER, 'clock_in', result({ code: 'clocked_in' }))
    store.applyResult(USER, 'clock_out', result({ ok: false, code: 'no_open_shift', shift: null }) as ClockServerResult)
    expect(store.getView(USER).status).toBe('off_shift')
  })

  it('ignores a slower refresh that started before the clock result', async () => {
    let release!: (value: CurrentShiftResult) => void
    const { store } = setup({ fetch: () => new Promise((r) => (release = r)) })
    const refreshing = store.refresh(USER)
    store.applyResult(USER, 'clock_in', result({ code: 'clocked_in' }))
    release(serverSays(null))
    await refreshing
    expect(store.getView(USER).status).toBe('on_shift')
  })

  it('notifies subscribers', () => {
    const { store } = setup()
    const listener = vi.fn()
    store.subscribe(listener)
    store.applyResult(USER, 'clock_in', result({ code: 'clocked_in' }))
    expect(listener).toHaveBeenCalled()
  })
})

describe('current shift: scans still on the phone', () => {
  it('shows a pending clock-in as on shift, waiting to send', () => {
    const { store } = setup({ pending: [pendingEvent()] })
    const view = store.getView(USER)
    expect(view.status).toBe('on_shift')
    expect(view.pendingEvent?.kind).toBe('clock_in')
    expect(view.pendingCount).toBe(1)
    expect(view.clockInAt).toBe('2026-11-04T22:05:00.000Z')
  })

  it('shows a pending clock-out as off shift', async () => {
    const { store, setPending } = setup({ fetch: async () => serverSays(shift()) })
    await store.refresh(USER)
    setPending([pendingEvent({ kind: 'clock_out' })])
    expect(store.getView(USER).status).toBe('off_shift')
  })

  it('does not count a scan still on its first send (the screen waits for the answer)', () => {
    const { store } = setup({ pending: [pendingEvent({ attempts: 0 })] })
    expect(store.getView(USER).status).toBe('unknown')
  })

  it("ignores another person's pending scans", () => {
    const { store } = setup({ pending: [pendingEvent({ userId: 'someone-else' })] })
    expect(store.getView(USER).status).toBe('unknown')
  })
})

describe('current shift: offline', () => {
  it('shows the last server answer from the phone when the server cannot be reached', async () => {
    const storage = memoryStorage()
    const first = setup({ fetch: async () => serverSays(shift()), storage })
    await first.store.refresh(USER)

    // The app is reopened with no signal.
    const second = setup({ fetch: async () => ({ ok: false, code: 'network', message: 'x' }), storage })
    const view = await second.store.refresh(USER)
    expect(view.status).toBe('on_shift')
    expect(view.offline).toBe(true)
    expect(view.fromCache).toBe(true)
  })

  it("does not show another person's cached shift", async () => {
    const storage = memoryStorage()
    storage.setItem(SHIFT_CACHE_KEY, JSON.stringify({ userId: 'someone-else', openShift: shift(), lastClosed: null, checkedAtMs: 1 }))
    const { store } = setup({ storage })
    expect(store.getView(USER).status).toBe('unknown')
  })

  it('survives a broken cache entry', () => {
    const storage = memoryStorage()
    storage.setItem(SHIFT_CACHE_KEY, '{not json')
    const { store } = setup({ storage })
    expect(store.getView(USER).status).toBe('unknown')
  })
})
