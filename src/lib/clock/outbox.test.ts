import { describe, expect, it, vi } from 'vitest'
import type { ClockResult } from '@/services/clockApi'
import { createClockOutbox, MAX_SEND_ATTEMPTS, type SessionState } from './outbox'
import { createMemoryOutboxStorage } from './outboxStorage'
import type { ClockEvent } from './clockEvents'

const USER = 'user-1'

const shift = {
  id: 4196,
  workerRole: 'cleaner' as const,
  customerName: 'Adams',
  siteName: 'Adams',
  clockIn: '2026-11-04T07:02:00.000Z',
  clockOut: null,
  businessDay: '2026-11-04',
  needsReview: false,
  clockInSource: 'scan',
  closeSource: null,
  autoClosed: false,
  clockOutMissing: false,
}

const answer = (overrides: Partial<Record<string, unknown>> = {}): ClockResult =>
  ({
    ok: true,
    code: 'clocked_in',
    message: 'Clocked in at Adams, 07:02.',
    shift,
    flags: [],
    qr: null,
    replay: false,
    serverNow: '2026-11-04T07:02:00.000Z',
    ...overrides,
  }) as ClockResult

const networkDown: ClockResult = {
  ok: false,
  code: 'network',
  message: "Couldn't reach the server.",
  cause: { message: 'TypeError: Failed to fetch' },
}

const event = (overrides: Partial<ClockEvent> = {}): ClockEvent => ({
  eventId: '7b0f3c9e-2d4a-4c1b-9f3e-5a6b7c8d9e01',
  userId: USER,
  kind: 'clock_in',
  qrPayload: 'Adams Clock-in',
  scannedAtMs: 1_000_000,
  location: null,
  device: { scanner: 'v2' },
  attempts: 0,
  nextAttemptAtMs: 0,
  ...overrides,
})

type SetupOptions = {
  session?: SessionState
  send?: (e: ClockEvent, waitMs: number) => Promise<ClockResult>
  readSession?: () => Promise<SessionState>
  storage?: ReturnType<typeof createMemoryOutboxStorage>
  start?: number
}

const setup = (opts: SetupOptions = {}) => {
  let clock = opts.start ?? 1_000_000
  let session: SessionState = opts.session ?? { status: 'signed_in', userId: USER }
  const storage = opts.storage ?? createMemoryOutboxStorage()
  const send = vi.fn(opts.send ?? (async () => answer()))
  const onSettled = vi.fn()
  const onFailed = vi.fn()
  const outbox = createClockOutbox({
    storage,
    send,
    readSession: opts.readSession ?? (async () => session),
    now: () => clock,
    onSettled,
    onFailed,
    timeoutMs: 12_000,
    sessionTimeoutMs: 5_000,
  })
  return {
    outbox,
    storage,
    send,
    onSettled,
    onFailed,
    advance: (ms: number) => {
      clock += ms
    },
    setSession: (next: SessionState) => {
      session = next
    },
  }
}

describe('clock outbox: sending', () => {
  it('saves the scan before sending, sends it once and removes it after the answer', async () => {
    const t = setup({
      send: async () => {
        // The event is already on the phone while the request is in flight.
        expect(t.storage.read()).toHaveLength(1)
        return answer()
      },
    })
    const outcome = await t.outbox.submit(event())

    expect(outcome.status).toBe('answered')
    expect(outcome.status === 'answered' && outcome.result.code).toBe('clocked_in')
    expect(t.send).toHaveBeenCalledTimes(1)
    expect(t.storage.read()).toEqual([])
    expect(t.onSettled).toHaveBeenCalledWith(expect.objectContaining({ eventId: event().eventId }), expect.objectContaining({ code: 'clocked_in' }))
  })

  it('sends the wait measured on the phone at send time', async () => {
    const t = setup()
    t.advance(1500)
    await t.outbox.submit(event())
    expect(t.send.mock.calls[0][1]).toBe(1500)
  })
})

describe('clock outbox: no signal', () => {
  it('keeps the scan and retries it with the same event id and a growing wait', async () => {
    let online = false
    const t = setup({ send: async () => (online ? answer() : networkDown) })

    const first = await t.outbox.submit(event())
    expect(first.status).toBe('queued')
    expect(t.outbox.pending(USER)).toHaveLength(1)

    t.advance(30_000)
    await t.outbox.flush({ force: true })
    expect(t.outbox.pending(USER)).toHaveLength(1)

    online = true
    t.advance(60_000)
    await t.outbox.flush({ force: true })

    expect(t.send).toHaveBeenCalledTimes(3)
    const ids = t.send.mock.calls.map(([sent]) => sent.eventId)
    expect(new Set(ids)).toEqual(new Set([event().eventId]))
    const waits = t.send.mock.calls.map(([, waitMs]) => waitMs)
    expect(waits).toEqual([0, 30_000, 90_000])
    expect(t.outbox.pending(USER)).toEqual([])
  })

  it('backs off between automatic retries but sends at once when forced', async () => {
    const t = setup({ send: async () => networkDown })
    await t.outbox.submit(event())
    expect(t.send).toHaveBeenCalledTimes(1)

    await t.outbox.flush()
    expect(t.send).toHaveBeenCalledTimes(1)

    t.advance(2_000)
    await t.outbox.flush()
    expect(t.send).toHaveBeenCalledTimes(2)

    // The second wait is longer than the first.
    t.advance(2_000)
    await t.outbox.flush()
    expect(t.send).toHaveBeenCalledTimes(2)

    await t.outbox.flush({ force: true })
    expect(t.send).toHaveBeenCalledTimes(3)
  })

  it('treats a request that never answers as "saved on the phone"', async () => {
    vi.useFakeTimers()
    try {
      const t = setup({ send: () => new Promise<ClockResult>(() => {}) })
      const pendingSubmit = t.outbox.submit(event())
      await vi.advanceTimersByTimeAsync(12_000)
      const outcome = await pendingSubmit
      expect(outcome.status).toBe('queued')
      expect(t.outbox.pending(USER)).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not call it a lost login when the phone is just offline', async () => {
    const t = setup({ session: { status: 'unreachable' } })
    const outcome = await t.outbox.submit(event())
    expect(outcome.status).toBe('queued')
    // Counted as tried, so screens show it as waiting.
    expect(t.outbox.pending(USER)[0].attempts).toBe(1)
    expect(t.outbox.needsSignIn()).toBe(false)
    expect(t.send).not.toHaveBeenCalled()
  })

  it('sends a clock-in before a later clock-out', async () => {
    let online = false
    const t = setup({ send: async (e) => (online ? answer({ code: e.kind === 'clock_in' ? 'clocked_in' : 'clocked_out' }) : networkDown) })
    await t.outbox.submit(event({ eventId: 'aaaaaaaa-0000-4000-8000-000000000001', scannedAtMs: 1_000_000 }))
    t.advance(5_000)
    const later = await t.outbox.submit(
      event({ eventId: 'aaaaaaaa-0000-4000-8000-000000000002', kind: 'clock_out', scannedAtMs: 1_005_000 }),
    )
    // The clock-out waits behind the clock-in that hasn't gone yet.
    expect(later.status).toBe('queued')
    expect(t.send.mock.calls.map(([e]) => e.kind)).toEqual(['clock_in', 'clock_in'])

    online = true
    await t.outbox.flush({ force: true })
    expect(t.send.mock.calls.slice(-2).map(([e]) => e.kind)).toEqual(['clock_in', 'clock_out'])
    expect(t.outbox.pending(USER)).toEqual([])
  })
})

describe('clock outbox: definitive answers', () => {
  it.each([
    ['already_clocked_in', true],
    ['no_open_shift', false],
    ['wrong_qr_type', false],
    ['too_late', false],
    ['role_not_allowed', false],
    ['unknown_qr', false],
    ['duplicate_clock_in', false],
    ['stale_scan', false],
  ])('%s removes the scan from the phone', async (code, ok) => {
    const t = setup({ send: async () => answer({ ok, code, shift: ok ? shift : null }) })
    const outcome = await t.outbox.submit(event())
    expect(outcome.status).toBe('answered')
    expect(t.outbox.pending(USER)).toEqual([])
  })

  it('hands a replayed answer back like the original', async () => {
    const t = setup({ send: async () => answer({ replay: true }) })
    const outcome = await t.outbox.submit(event())
    expect(outcome.status === 'answered' && outcome.result).toMatchObject({ ok: true, code: 'clocked_in', replay: true })
    expect(t.onSettled).toHaveBeenCalledTimes(1)
    expect(t.outbox.pending(USER)).toEqual([])
  })

  it('keeps a throttled scan (rate_limited) and waits at least a minute before trying again', async () => {
    let throttled = true
    const t = setup({ send: async () => (throttled ? answer({ ok: false, code: 'rate_limited', shift: null }) : answer()) })
    const outcome = await t.outbox.submit(event())
    expect(outcome).toMatchObject({ status: 'queued', reason: 'rate_limited' })
    expect(t.outbox.pending(USER)).toHaveLength(1)
    expect(t.onSettled).not.toHaveBeenCalled()

    t.advance(30_000)
    await t.outbox.flush()
    expect(t.send).toHaveBeenCalledTimes(1)

    throttled = false
    t.advance(30_000)
    await t.outbox.flush()
    expect(t.send).toHaveBeenCalledTimes(2)
    expect(t.send.mock.calls[1][0].eventId).toBe(event().eventId)
    expect(t.outbox.pending(USER)).toEqual([])
  })

  it('drops an answer this app cannot read (the server already logged it)', async () => {
    const t = setup({ send: async () => ({ ok: false, code: 'invalid_response', message: 'x' }) })
    const outcome = await t.outbox.submit(event())
    expect(outcome.status).toBe('answered')
    expect(t.outbox.pending(USER)).toEqual([])
  })
})

describe('clock outbox: expired login', () => {
  it('keeps the scan, asks for a sign-in and never sends without a session', async () => {
    const t = setup({ session: { status: 'signed_out' } })
    const outcome = await t.outbox.submit(event())

    expect(outcome.status).toBe('needs_sign_in')
    expect(t.send).not.toHaveBeenCalled()
    expect(t.outbox.needsSignIn()).toBe(true)
    expect(t.outbox.pending(USER)).toHaveLength(1)

    t.setSession({ status: 'signed_in', userId: USER })
    await t.outbox.flush({ force: true })
    expect(t.send).toHaveBeenCalledTimes(1)
    expect(t.outbox.pending(USER)).toEqual([])
    expect(t.outbox.needsSignIn()).toBe(false)
  })

  it.each([
    ['server says not signed in', answer({ ok: false, code: 'not_signed_in', shift: null })],
    ['expired JWT', { ok: false, code: 'network', message: 'x', cause: { code: 'PGRST301', message: 'JWT expired' } }],
    ['sent with the anon key', { ok: false, code: 'network', message: 'x', cause: { code: '42501', message: 'permission denied for function clock_in' } }],
  ])('%s: keeps the scan and asks for a sign-in', async (_name, result) => {
    const t = setup({ send: async () => result as ClockResult })
    const outcome = await t.outbox.submit(event())
    expect(outcome.status).toBe('needs_sign_in')
    expect(t.outbox.pending(USER)).toHaveLength(1)
    expect(t.outbox.needsSignIn()).toBe(true)
  })

  it("never sends another person's saved scan", async () => {
    const t = setup()
    t.setSession({ status: 'signed_out' })
    await t.outbox.submit(event({ userId: 'someone-else' }))
    t.setSession({ status: 'signed_in', userId: USER })
    await t.outbox.flush({ force: true })
    expect(t.send).not.toHaveBeenCalled()
    expect(t.outbox.pending('someone-else')).toHaveLength(1)
  })
})

describe('clock outbox: listeners', () => {
  it('tells subscribers when the saved scans change', async () => {
    const t = setup({ send: async () => networkDown })
    const listener = vi.fn()
    const unsubscribe = t.outbox.subscribe(listener)
    await t.outbox.submit(event())
    expect(listener).toHaveBeenCalled()
    unsubscribe()
    listener.mockClear()
    await t.outbox.flush({ force: true })
    expect(listener).not.toHaveBeenCalled()
  })
})

const HOUR = 3_600_000
const sqlError = (code: string): ClockResult => ({
  ok: false,
  code: 'network',
  message: 'x',
  cause: { code, message: `error ${code}` },
})

describe('review H1: errors that will never go away', () => {
  it('a deterministic database error (22003) is not retried and does not block the next scan', async () => {
    const t = setup({
      send: async (e) => (e.kind === 'clock_in' ? sqlError('22003') : answer({ code: 'clocked_out' })),
    })
    const first = await t.outbox.submit(event({ eventId: 'aaaaaaaa-0000-4000-8000-000000000001' }))
    expect(first).toMatchObject({ status: 'failed', reason: 'error', code: '22003' })
    expect(t.outbox.pending(USER)).toEqual([])
    expect(t.onFailed).toHaveBeenCalledWith(expect.objectContaining({ kind: 'clock_in' }), { reason: 'error', code: '22003' })

    const second = await t.outbox.submit(event({ eventId: 'aaaaaaaa-0000-4000-8000-000000000002', kind: 'clock_out' }))
    expect(second.status).toBe('answered')
  })

  it.each(['P0001', '23505', '22003', 'PGRST116'])('%s is permanent', async (code) => {
    const t = setup({ send: async () => sqlError(code) })
    expect((await t.outbox.submit(event())).status).toBe('failed')
    expect(t.outbox.pending(USER)).toEqual([])
  })

  // 42883/PGRST202: the function is briefly missing while a migration replaces it (review 15, N1).
  it.each(['08006', '40001', '53300', '57014', '58000', 'PGRST000', 'PGRST003', '503', 'timeout', '42883', 'PGRST202', '25006', '55P03', 'ECONNRESET'])(
    '%s is transient: kept for a retry',
    async (code) => {
      const t = setup({ send: async () => sqlError(code) })
      expect((await t.outbox.submit(event())).status).toBe('queued')
      expect(t.outbox.pending(USER)).toHaveLength(1)
    },
  )

  it('gives up after the attempt limit, so nothing blocks the line forever', async () => {
    const t = setup({ send: async () => sqlError('08006') })
    const storage = t.storage
    storage.write([{ ...event(), attempts: MAX_SEND_ATTEMPTS, nextAttemptAtMs: 0, seq: 1 }])
    await t.outbox.flush({ force: true })
    expect(t.send).not.toHaveBeenCalled()
    expect(t.outbox.pending(USER)).toEqual([])
    expect(t.onFailed).toHaveBeenCalledWith(expect.anything(), { reason: 'gave_up', code: undefined })
  })
})

describe('review H2: scans too old to send', () => {
  it('drops a clock-in that waited more than 16 h on the phone, without sending it', async () => {
    const t = setup({ send: async () => sqlError('08006') })
    await t.outbox.submit(event())
    t.advance(16 * HOUR + 1)
    await t.outbox.flush({ force: true })
    expect(t.send).toHaveBeenCalledTimes(1)
    expect(t.outbox.pending(USER)).toEqual([])
    expect(t.onFailed).toHaveBeenCalledWith(expect.objectContaining({ kind: 'clock_in' }), { reason: 'stale', code: undefined })
  })

  it('drops a clock-out after 24 h, but still sends one that waited 23 h', async () => {
    const t = setup({ session: { status: 'signed_out' } })
    await t.outbox.submit(event({ eventId: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'clock_out' }))
    t.advance(23 * HOUR)
    t.setSession({ status: 'signed_in', userId: USER })
    await t.outbox.flush({ force: true })
    expect(t.send).toHaveBeenCalledTimes(1)

    const old = setup({ session: { status: 'signed_out' } })
    await old.outbox.submit(event({ kind: 'clock_out' }))
    old.advance(24 * HOUR + 1)
    old.setSession({ status: 'signed_in', userId: USER })
    await old.outbox.flush({ force: true })
    expect(old.send).not.toHaveBeenCalled()
    expect(old.outbox.pending(USER)).toEqual([])
  })

  it("drops another person's stale scan too, reporting it under them", async () => {
    const t = setup({ session: { status: 'signed_out' } })
    await t.outbox.submit(event({ userId: 'someone-else' }))
    t.advance(17 * HOUR)
    t.setSession({ status: 'signed_in', userId: USER })
    await t.outbox.flush({ force: true })
    expect(t.outbox.pending('someone-else')).toEqual([])
    expect(t.onFailed).toHaveBeenCalledWith(expect.objectContaining({ userId: 'someone-else' }), expect.objectContaining({ reason: 'stale' }))
  })
})

describe('review M1: a login check that never answers', () => {
  it('still settles the scan as "saved on the phone"', async () => {
    vi.useFakeTimers()
    try {
      const t = setup({ readSession: () => new Promise<SessionState>(() => {}) })
      const pendingSubmit = t.outbox.submit(event())
      await vi.advanceTimersByTimeAsync(5_000)
      const outcome = await pendingSubmit
      expect(outcome).toMatchObject({ status: 'queued', reason: 'network' })
      expect(t.outbox.pending(USER)).toHaveLength(1)
      expect(t.send).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('review L1: order does not depend on the phone clock', () => {
  it('sends the earlier clock-in first even after the clock went back an hour', async () => {
    let online = false
    const t = setup({
      start: 10 * HOUR,
      send: async (e) => (online ? answer({ code: e.kind === 'clock_in' ? 'clocked_in' : 'clocked_out' }) : networkDown),
    })
    await t.outbox.submit(event({ eventId: 'aaaaaaaa-0000-4000-8000-000000000001', scannedAtMs: 10 * HOUR }))
    t.advance(-HOUR)
    await t.outbox.submit(
      event({ eventId: 'aaaaaaaa-0000-4000-8000-000000000002', kind: 'clock_out', scannedAtMs: 9 * HOUR + 60_000 }),
    )
    online = true
    t.send.mockClear()
    await t.outbox.flush({ force: true })
    expect(t.send.mock.calls.map(([e]) => e.kind)).toEqual(['clock_in', 'clock_out'])
  })
})

describe('review L2: two tabs', () => {
  it("a tab whose send failed does not bring back a scan the other tab finished", async () => {
    const storage = createMemoryOutboxStorage()
    let releaseA!: (r: ClockResult) => void
    const tabA = setup({ storage, send: () => new Promise((r) => (releaseA = r)) })
    const tabB = setup({ storage, send: async () => answer() })

    const aSubmit = tabA.outbox.submit(event())
    await vi.waitFor(() => expect(tabA.send).toHaveBeenCalled())
    await tabB.outbox.flush({ force: true })
    expect(storage.read()).toEqual([])

    releaseA(networkDown)
    await aSubmit
    expect(storage.read()).toEqual([])
  })
})

describe('review L3: the person changes mid-batch', () => {
  it('stops sending when the login is no longer the owner', async () => {
    let session: SessionState = { status: 'signed_out' }
    const t = setup({ readSession: async () => session })
    await t.outbox.submit(event({ eventId: 'aaaaaaaa-0000-4000-8000-000000000001' }))
    await t.outbox.submit(event({ eventId: 'aaaaaaaa-0000-4000-8000-000000000002', kind: 'clock_out' }))
    let sends = 0
    t.send.mockImplementation(async () => {
      sends += 1
      // While the first scan is in flight, someone else signs in.
      session = { status: 'signed_in', userId: 'someone-else' }
      return answer()
    })
    session = { status: 'signed_in', userId: USER }
    await t.outbox.flush({ force: true })
    expect(sends).toBe(1)
    expect(t.outbox.pending(USER)).toHaveLength(1)
  })
})
