import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installTestLocalStorage } from '@/test/localStorage'

/** The app-wide clock wiring: triggers, the switch re-read, failures, the area-scan time limit. */

const h = vi.hoisted(() => ({
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  getCurrentShift: vi.fn(),
  getClockFlags: vi.fn(),
  authCallback: null as null | ((event: string) => void),
  insert: vi.fn(async () => ({ error: null })),
}))

vi.mock('@/services/supabase', () => ({
  supabase: {
    from: () => ({ insert: h.insert }),
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null }),
      onAuthStateChange: (cb: (event: string) => void) => {
        h.authCallback = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
    },
  },
}))
vi.mock('@/services/clockApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/clockApi')>()),
  clockIn: (...a: unknown[]) => h.clockIn(...a),
  clockOut: (...a: unknown[]) => h.clockOut(...a),
  getCurrentShift: () => h.getCurrentShift(),
  getClockFlags: () => h.getClockFlags(),
}))
vi.mock('@/services/managerService', () => ({ autoLinkCleanerToCustomer: async () => [] }))

const runtime = await import('./clockRuntime')
const { resetClockSwitchesForTests } = await import('./clockFlags')

const USER = 'user-1'
const flags = { clockV2: true, scannerV2: true, source: 'server' }

beforeEach(() => {
  installTestLocalStorage()
  runtime.resetClockRuntimeForTests()
  resetClockSwitchesForTests()
  h.clockIn.mockReset()
  h.getCurrentShift.mockReset().mockResolvedValue({ ok: true, code: 'not_clocked_in', openShift: null, lastClosed: null, serverNow: 'x' })
  h.getClockFlags.mockReset().mockResolvedValue(flags)
  h.insert.mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('startClockRuntime triggers', () => {
  it('sends on start, on "online" and on return to the app, and re-reads the switches on return', async () => {
    const flush = vi.spyOn(runtime.clockOutbox, 'flush')
    const stop = runtime.startClockRuntime()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(h.getClockFlags).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new Event('online'))
    expect(flush).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(flush).toHaveBeenCalledTimes(3)
    expect(h.getClockFlags).toHaveBeenCalledTimes(2)
    stop()
  })

  it('re-reads the kill switches after sign-in, and sends what was waiting (review M4)', async () => {
    vi.useFakeTimers()
    const flush = vi.spyOn(runtime.clockOutbox, 'flush')
    const stop = runtime.startClockRuntime()
    h.getClockFlags.mockClear()
    flush.mockClear()
    h.authCallback?.('SIGNED_IN')
    await vi.advanceTimersByTimeAsync(1)
    expect(h.getClockFlags).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith({ force: true })
    stop()
  })

  it('retries every 20 s only while scans wait', async () => {
    vi.useFakeTimers()
    const flush = vi.spyOn(runtime.clockOutbox, 'flush')
    const pending = vi.spyOn(runtime.clockOutbox, 'pending').mockReturnValue([])
    const stop = runtime.startClockRuntime()
    flush.mockClear()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(flush).not.toHaveBeenCalled()
    pending.mockReturnValue([{} as never])
    await vi.advanceTimersByTimeAsync(20_000)
    expect(flush).toHaveBeenCalledTimes(1)
    stop()
  })
})

describe('area-scan check (review M1)', () => {
  it('lets the scan through when the shift check does not answer in time', async () => {
    vi.useFakeTimers()
    h.getCurrentShift.mockReturnValue(new Promise(() => {}))
    const allowed = runtime.isOnShiftForAreaScan(USER)
    await vi.advanceTimersByTimeAsync(runtime.AREA_CHECK_TIMEOUT_MS)
    expect(await allowed).toBe(true)
  })
})

describe('sending', () => {
  it('stamps the phone clock at send time into device.sent_at_ms (review M6)', async () => {
    h.clockIn.mockResolvedValue({ ok: false, code: 'network', message: 'x', cause: { message: 'Failed to fetch' } })
    const before = Date.now()
    await runtime.submitClockScan({
      kind: 'clock_in',
      userId: USER,
      qrPayload: 'Adams Clock-in',
      scannedAtMs: before,
      location: null,
      device: { scanner: 'v2' },
    })
    const device = h.clockIn.mock.calls[0][0].device
    expect(device).toMatchObject({ scanner: 'v2' })
    expect(device.sent_at_ms).toBeGreaterThanOrEqual(before)
  })

  it('a scan that can never be saved is reported under its owner and kept as a message for next time (H1/H2)', async () => {
    h.clockIn.mockResolvedValue({ ok: false, code: 'network', message: 'x', cause: { code: '22003', message: 'out of range' } })
    const outcome = await runtime.submitClockScan({
      kind: 'clock_in',
      userId: USER,
      qrPayload: 'Adams Clock-in',
      scannedAtMs: Date.now(),
      location: null,
      device: {},
    })
    expect(outcome.status).toBe('failed')
    await vi.waitFor(() => expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'clock_in', reason: expect.stringContaining('22003') })))
    const view = runtime.getClockView(USER)
    expect(view.droppedScans).toHaveLength(1)
    expect(view.droppedScans[0]).toMatchObject({ kind: 'clock_in', reason: 'error' })

    runtime.dismissDroppedScans(USER)
    expect(runtime.getClockView(USER).droppedScans).toEqual([])
  })
})
