import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}))

import { clockIn, clockOut, getCurrentShift } from './clockApi'

const EVENT_ID = '7b0f3c9e-2d4a-4c1b-9f3e-5a6b7c8d9e01'

const shiftRow = {
  id: 4196,
  worker_role: 'cleaner',
  customer_name: 'Adams',
  site_name: 'Adams',
  clock_in: '2026-11-04T20:59:23.824+00:00',
  clock_out: null,
  business_day: '2026-11-04',
  needs_review: false,
  clock_in_source: 'scan',
  close_source: null,
  auto_closed: false,
  clock_out_missing: false,
}

const serverResult = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  code: 'clocked_in',
  message: 'Clocked in at Adams, 20:59.',
  shift: shiftRow,
  flags: [],
  qr: { id: 'Adams Clock-in', kind: 'CLOCK_IN', status: 'registered', customer_name: 'Adams', site_name: 'Adams' },
  replay: false,
  server_now: '2026-11-04T20:59:23.824+00:00',
  ...overrides,
})

beforeEach(() => {
  rpc.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('clockIn', () => {
  it('calls clock_in with the server parameter names and safe defaults', async () => {
    rpc.mockResolvedValue({ data: serverResult(), error: null })
    await clockIn({ eventId: EVENT_ID, qrPayload: 'Adams Clock-in' })
    expect(rpc).toHaveBeenCalledWith('clock_in', {
      p_event_id: EVENT_ID,
      p_qr_payload: 'Adams Clock-in',
      p_scanned_at: null,
      p_wait_ms: 0,
      p_lat: null,
      p_lng: null,
      p_device: {},
    })
  })

  it('maps a saved clock-in to an ok result with a camelCase shift', async () => {
    rpc.mockResolvedValue({ data: serverResult(), error: null })
    const result = await clockIn({ eventId: EVENT_ID, qrPayload: 'Adams Clock-in' })
    expect(result).toEqual({
      ok: true,
      code: 'clocked_in',
      message: 'Clocked in at Adams, 20:59.',
      flags: [],
      replay: false,
      serverNow: '2026-11-04T20:59:23.824+00:00',
      qr: { id: 'Adams Clock-in', kind: 'CLOCK_IN', status: 'registered', customerName: 'Adams', siteName: 'Adams' },
      shift: {
        id: 4196,
        workerRole: 'cleaner',
        customerName: 'Adams',
        siteName: 'Adams',
        clockIn: '2026-11-04T20:59:23.824+00:00',
        clockOut: null,
        businessDay: '2026-11-04',
        needsReview: false,
        clockInSource: 'scan',
        closeSource: null,
        autoClosed: false,
        clockOutMissing: false,
      },
    })
  })

  it('keeps the replay marker and flags from the server', async () => {
    rpc.mockResolvedValue({ data: serverResult({ replay: true, flags: ['queued_over_2min'] }), error: null })
    const result = await clockIn({ eventId: EVENT_ID, qrPayload: 'x' })
    expect(result.ok && result.replay).toBe(true)
    expect(result.ok && result.flags).toEqual(['queued_over_2min'])
  })

  it('returns an already-open shift as ok', async () => {
    rpc.mockResolvedValue({ data: serverResult({ code: 'already_clocked_in', flags: ['open_shift_other_site'] }), error: null })
    const result = await clockIn({ eventId: EVENT_ID, qrPayload: 'x' })
    expect(result).toMatchObject({ ok: true, code: 'already_clocked_in', shift: { id: 4196 } })
  })

  it('maps a business refusal to a typed failure with the QR kind', async () => {
    rpc.mockResolvedValue({
      data: serverResult({
        ok: false,
        code: 'wrong_qr_type',
        message: 'That is the Clock Out code.',
        shift: null,
        qr: { id: 'Adams Clock-out', kind: 'CLOCK_OUT', status: 'registered', customer_name: 'Adams', site_name: 'Adams' },
      }),
      error: null,
    })
    const result = await clockIn({ eventId: EVENT_ID, qrPayload: 'x' })
    expect(result).toMatchObject({ ok: false, code: 'wrong_qr_type', shift: null, qr: { kind: 'CLOCK_OUT' } })
  })

  it('maps a PostgREST error to network, keeping the cause for the outbox', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'JWT expired', code: 'PGRST301' } })
    const result = await clockIn({ eventId: EVENT_ID, qrPayload: 'x' })
    expect(result).toEqual({ ok: false, code: 'network', message: expect.any(String), cause: { code: 'PGRST301', message: 'JWT expired' } })
  })

  it('maps a thrown fetch failure to network', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'))
    const result = await clockIn({ eventId: EVENT_ID, qrPayload: 'x' })
    expect(result).toMatchObject({ ok: false, code: 'network', cause: { message: 'Failed to fetch' } })
  })

  it('treats a malformed or unknown answer as invalid_response', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await clockIn({ eventId: EVENT_ID, qrPayload: 'x' })).toMatchObject({ ok: false, code: 'invalid_response' })
    rpc.mockResolvedValue({ data: serverResult({ code: 'something_new' }), error: null })
    expect(await clockIn({ eventId: EVENT_ID, qrPayload: 'x' })).toMatchObject({ ok: false, code: 'invalid_response' })
    rpc.mockResolvedValue({ data: serverResult({ ok: true, shift: null }), error: null })
    expect(await clockIn({ eventId: EVENT_ID, qrPayload: 'x' })).toMatchObject({ ok: false, code: 'invalid_response' })
  })

  it('refuses a bad event id or empty payload without calling the server', async () => {
    expect(await clockIn({ eventId: 'not-a-uuid', qrPayload: 'x' })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(await clockIn({ eventId: EVENT_ID, qrPayload: '   ' })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('clockOut', () => {
  it('calls clock_out with location, wait and scan time', async () => {
    rpc.mockResolvedValue({ data: serverResult({ code: 'clocked_out' }), error: null })
    await clockOut({
      eventId: EVENT_ID,
      qrPayload: 'Adams Clock-out',
      scannedAt: new Date('2026-11-04T21:00:00Z'),
      waitMs: 300000.7,
      location: { latitude: 51.1, longitude: -1.2 },
      device: { ua: 'test' },
    })
    expect(rpc).toHaveBeenCalledWith('clock_out', {
      p_event_id: EVENT_ID,
      p_qr_payload: 'Adams Clock-out',
      p_scanned_at: '2026-11-04T21:00:00.000Z',
      p_wait_ms: 300001,
      p_lat: 51.1,
      p_lng: -1.2,
      p_device: { ua: 'test' },
    })
  })

  it('never sends a negative or non-finite wait', async () => {
    rpc.mockResolvedValue({ data: serverResult({ code: 'clocked_out' }), error: null })
    await clockOut({ eventId: EVENT_ID, qrPayload: 'x', waitMs: -50 })
    await clockOut({ eventId: EVENT_ID, qrPayload: 'x', waitMs: Number.NaN })
    expect(rpc.mock.calls.map((call) => (call[1] as { p_wait_ms: number }).p_wait_ms)).toEqual([0, 0])
  })

  it('maps late and too-late clock-outs', async () => {
    rpc.mockResolvedValue({ data: serverResult({ code: 'late_clock_out', flags: ['late_after_auto_close'] }), error: null })
    expect(await clockOut({ eventId: EVENT_ID, qrPayload: 'x' })).toMatchObject({ ok: true, code: 'late_clock_out' })
    rpc.mockResolvedValue({ data: serverResult({ ok: false, code: 'too_late' }), error: null })
    expect(await clockOut({ eventId: EVENT_ID, qrPayload: 'x' })).toMatchObject({ ok: false, code: 'too_late', shift: { id: 4196 } })
  })

  it('maps the per-person throttle (rate_limited) as a server refusal, not an unreadable answer', async () => {
    rpc.mockResolvedValue({ data: serverResult({ ok: false, code: 'rate_limited', shift: null, qr: null }), error: null })
    expect(await clockOut({ eventId: EVENT_ID, qrPayload: 'x' })).toMatchObject({ ok: false, code: 'rate_limited', shift: null })
  })

  it('maps stale_scan (waited too long on the phone) as a server refusal', async () => {
    rpc.mockResolvedValue({ data: serverResult({ ok: false, code: 'stale_scan', shift: null, qr: null }), error: null })
    expect(await clockIn({ eventId: EVENT_ID, qrPayload: 'x' })).toMatchObject({ ok: false, code: 'stale_scan' })
  })

  it('never sends a wait over 7 days (p_wait_ms is a database integer; review H1)', async () => {
    rpc.mockResolvedValue({ data: serverResult(), error: null })
    await clockIn({ eventId: EVENT_ID, qrPayload: 'x', waitMs: 30 * 86_400_000 })
    expect(rpc.mock.calls[0][1].p_wait_ms).toBe(7 * 86_400_000)
  })

  it('keeps the capped queued clock-in flag', async () => {
    rpc.mockResolvedValue({ data: serverResult({ flags: ['queued_over_2min', 'queued_clock_in_capped'] }), error: null })
    expect(await clockIn({ eventId: EVENT_ID, qrPayload: 'x' })).toMatchObject({
      ok: true,
      flags: ['queued_over_2min', 'queued_clock_in_capped'],
    })
  })
})

describe('getCurrentShift', () => {
  it('returns the open shift', async () => {
    rpc.mockResolvedValue({
      data: { ok: true, code: 'clocked_in', open_shift: shiftRow, last_closed: null, server_now: 'n', london_today: '2026-11-04' },
      error: null,
    })
    const result = await getCurrentShift()
    expect(rpc).toHaveBeenCalledWith('current_shift')
    expect(result).toMatchObject({ ok: true, code: 'clocked_in', openShift: { id: 4196, siteName: 'Adams' }, lastClosed: null, londonToday: '2026-11-04' })
  })

  it('returns null when not clocked in', async () => {
    rpc.mockResolvedValue({
      data: { ok: true, code: 'not_clocked_in', open_shift: null, last_closed: { ...shiftRow, clock_out: 'x' }, server_now: 'n', london_today: 'd' },
      error: null,
    })
    expect(await getCurrentShift()).toMatchObject({ ok: true, code: 'not_clocked_in', openShift: null, lastClosed: { clockOut: 'x' } })
  })

  it('maps not signed in and transport failures', async () => {
    rpc.mockResolvedValue({ data: { ok: false, code: 'not_signed_in', open_shift: null, last_closed: null, server_now: 'n' }, error: null })
    expect(await getCurrentShift()).toMatchObject({ ok: false, code: 'not_signed_in' })
    rpc.mockResolvedValue({ data: null, error: { message: 'offline' } })
    expect(await getCurrentShift()).toMatchObject({ ok: false, code: 'network' })
  })
})
