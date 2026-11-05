import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { installTestLocalStorage } from '@/test/localStorage'

/** ClockOutValidator: clock_out RPC, outbox, QrCamera. */

const h = vi.hoisted(() => ({
  clockOut: vi.fn(),
  getCurrentShift: vi.fn(),
  processQRScan: vi.fn(),
}))

vi.mock('@/services/supabase', async () => {
  const { createFakeSupabase } = await import('@/test/fakeSupabase')
  const fake = createFakeSupabase()
  return { supabase: fake.supabase, __fake: fake }
})
vi.mock('@/services/clockApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/clockApi')>()
  return { ...original, clockOut: (...a: unknown[]) => h.clockOut(...a), getCurrentShift: () => h.getCurrentShift() }
})
vi.mock('@/services/managerService', () => ({ autoLinkCleanerToCustomer: async () => [] }))
vi.mock('@/components/qr/scanner/QrCamera', async () => ({ QrCamera: (await import('@/test/fakeQrCamera')).FakeQrCamera }))

const fakeDb = ((await import('@/services/supabase')) as unknown as {
  __fake: ReturnType<typeof import('@/test/fakeSupabase').createFakeSupabase>
}).__fake
const { emitScan, resetFakeCamera } = await import('@/test/fakeQrCamera')
const { resetClockRuntimeForTests, clockOutbox, getClockView } = await import('@/lib/clock/clockRuntime')
const { QRService } = await import('@/services/qrService')
const { ClockOutValidator } = await import('./ClockOutValidator')

const USER = 'user-1'

const shift = (overrides: Record<string, unknown> = {}) => ({
  id: 4196,
  workerRole: 'cleaner',
  customerName: 'Adams',
  siteName: 'Adams',
  clockIn: '2026-11-04T07:02:00.000Z',
  clockOut: '2026-11-04T16:30:00.000Z',
  businessDay: '2026-11-04',
  needsReview: false,
  clockInSource: 'scan',
  closeSource: 'scan',
  autoClosed: false,
  clockOutMissing: false,
  ...overrides,
})

const result = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  code: 'clocked_out',
  message: '',
  shift: shift(),
  flags: [],
  qr: null,
  replay: false,
  serverNow: '2026-11-04T16:30:00.000Z',
  ...overrides,
})

const renderValidator = (props: Partial<React.ComponentProps<typeof ClockOutValidator>> = {}) => {
  const onClockOutSuccess = vi.fn()
  render(
    <MemoryRouter>
      <ClockOutValidator cleanerId={USER} cleanerName="Jean Test" onClockOutSuccess={onClockOutSuccess} {...props} />
    </MemoryRouter>,
  )
  return { onClockOutSuccess }
}

const startAndScan = async (text: string) => {
  fireEvent.click(await screen.findByRole('button', { name: /start scanning/i }))
  await act(async () => {
    expect(emitScan(text)).toBe(true)
  })
}

beforeEach(() => {
  installTestLocalStorage()
  localStorage.setItem('userId', USER)
  fakeDb.reset()
  resetFakeCamera()
  resetClockRuntimeForTests()
  h.clockOut.mockReset()
  h.getCurrentShift.mockReset()
  h.getCurrentShift.mockResolvedValue({ ok: true, code: 'not_clocked_in', openShift: null, lastClosed: null, serverNow: 'x' })
  vi.spyOn(QRService, 'processQRScan').mockImplementation(h.processQRScan)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ClockOutValidator, new clock', () => {
  it('sends the Clock Out scan to clock_out and hands the answer up', async () => {
    h.clockOut.mockResolvedValue(result())
    const { onClockOutSuccess } = renderValidator()
    await startAndScan('Adams Clock-out')

    await waitFor(() => expect(onClockOutSuccess).toHaveBeenCalledTimes(1))
    expect(h.clockOut.mock.calls[0][0]).toMatchObject({ qrPayload: 'Adams Clock-out', device: expect.objectContaining({ scanner: 'v2' }) })
    expect(onClockOutSuccess.mock.calls[0][0]).toMatchObject({ status: 'answered', result: { code: 'clocked_out' } })
    expect(h.processQRScan).not.toHaveBeenCalled()
  })

  it('late clock-out after an auto-close is accepted, with its review flag', async () => {
    h.clockOut.mockResolvedValue(
      result({ code: 'late_clock_out', flags: ['late_after_auto_close'], shift: shift({ needsReview: true, autoClosed: true }) }),
    )
    const { onClockOutSuccess } = renderValidator()
    await startAndScan('Adams Clock-out')

    await waitFor(() => expect(onClockOutSuccess).toHaveBeenCalled())
    expect(onClockOutSuccess.mock.calls[0][0].result).toMatchObject({ code: 'late_clock_out', flags: ['late_after_auto_close'] })
    expect(getClockView(USER).status).toBe('off_shift')
  })

  it("another site's code is accepted (D5)", async () => {
    h.clockOut.mockResolvedValue(result({ flags: ['other_site_qr'] }))
    const { onClockOutSuccess } = renderValidator()
    await startAndScan('Avtrade Clock-out')
    await waitFor(() => expect(onClockOutSuccess).toHaveBeenCalled())
  })

  it('no open shift: handed up as the end of the attempt, and the shift reads as closed', async () => {
    h.clockOut.mockResolvedValue(result({ ok: false, code: 'no_open_shift', shift: null }))
    const { onClockOutSuccess } = renderValidator()
    await startAndScan('Adams Clock-out')

    await waitFor(() => expect(onClockOutSuccess).toHaveBeenCalled())
    expect(onClockOutSuccess.mock.calls[0][0].result).toMatchObject({ ok: false, code: 'no_open_shift' })
    expect(getClockView(USER).status).toBe('off_shift')
  })

  it('a Clock In code is explained on the spot and not sent', async () => {
    const { onClockOutSuccess } = renderValidator()
    await startAndScan('Adams Clock-in')
    expect(await screen.findByText("That's the Clock In code")).toBeInTheDocument()
    expect(h.clockOut).not.toHaveBeenCalled()
    expect(onClockOutSuccess).not.toHaveBeenCalled()
  })

  it('a code the server refuses stays on screen, with a way to scan again', async () => {
    h.clockOut.mockResolvedValue(result({ ok: false, code: 'unknown_qr', shift: null }))
    const { onClockOutSuccess } = renderValidator()
    await startAndScan('Adams Clock-out')
    expect(await screen.findByText(/isn't recognised/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /scan again/i })).toBeInTheDocument()
    expect(onClockOutSuccess).not.toHaveBeenCalled()
  })

  it('a code that is not a QR this app knows is not saved on the phone', async () => {
    const { onClockOutSuccess } = renderValidator()
    await startAndScan('{"broken": true}')
    expect(await screen.findByText(/isn't recognised/i)).toBeInTheDocument()
    expect(h.clockOut).not.toHaveBeenCalled()
    expect(clockOutbox.pending(USER)).toEqual([])
    expect(onClockOutSuccess).not.toHaveBeenCalled()
  })

  it('no signal: the clock-out is kept on the phone and the cleaner can carry on', async () => {
    h.clockOut.mockResolvedValue({ ok: false, code: 'network', message: 'x', cause: { message: 'Failed to fetch' } })
    const { onClockOutSuccess } = renderValidator()
    await startAndScan('Adams Clock-out')
    await waitFor(() => expect(onClockOutSuccess).toHaveBeenCalled())
    expect(onClockOutSuccess.mock.calls[0][0].status).toBe('queued')
    expect(clockOutbox.pending(USER)).toHaveLength(1)
  })

  it('a Clock Out code handed over from the area scanner is sent straight away, raw', async () => {
    h.clockOut.mockResolvedValue(result())
    const raw = JSON.stringify({ id: 'qr-out-1', type: 'CLOCK_OUT', customerName: 'Adams' })
    const { onClockOutSuccess } = renderValidator({
      pendingQrData: { id: 'qr-out-1', type: 'CLOCK_OUT', customerName: 'Adams', rawPayload: raw },
    })
    await waitFor(() => expect(onClockOutSuccess).toHaveBeenCalled())
    expect(h.clockOut.mock.calls[0][0].qrPayload).toBe(raw)
  })

  it('a handed-over clock-out keeps the time it was scanned, not the hand-over time (review M5)', async () => {
    h.clockOut.mockResolvedValue(result())
    const scannedAtMs = Date.now() - 4_000
    const { onClockOutSuccess } = renderValidator({
      pendingQrData: { id: 'Adams Clock-out', type: 'CLOCK_OUT', rawPayload: 'Adams Clock-out', scannedAtMs },
    })
    await waitFor(() => expect(onClockOutSuccess).toHaveBeenCalled())
    expect(new Date(h.clockOut.mock.calls[0][0].scannedAt).getTime()).toBe(scannedAtMs)
  })

  it('a clock-out that can never be saved says so and is not handed up (review H1)', async () => {
    h.clockOut.mockResolvedValue({ ok: false, code: 'network', message: 'x', cause: { code: 'P0001', message: 'bug' } })
    const { onClockOutSuccess } = renderValidator()
    await startAndScan('Adams Clock-out')
    expect(await screen.findByText("Your clock-out couldn't be saved")).toBeInTheDocument()
    expect(screen.getByText('Tell your manager the time you finished.')).toBeInTheDocument()
    expect(onClockOutSuccess).not.toHaveBeenCalled()
    expect(clockOutbox.pending(USER)).toEqual([])
  })

  it('writes no clock rows itself (no time_attendance, cleaner_logs or live_tracking)', async () => {
    h.clockOut.mockResolvedValue(result())
    const { onClockOutSuccess } = renderValidator()
    await startAndScan('Adams Clock-out')
    await waitFor(() => expect(onClockOutSuccess).toHaveBeenCalled())
    for (const table of ['time_attendance', 'cleaner_logs', 'live_tracking']) expect(fakeDb.writesTo(table)).toEqual([])
  })
})
