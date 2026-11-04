import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { installTestLocalStorage } from '@/test/localStorage'

/**
 * The clock-in page on the new clock path (clock_v2), driven through the real
 * page, QRScanner, outbox and current-shift store. Only the network edge
 * (clockApi, supabase) and the camera are fakes.
 */

const h = vi.hoisted(() => ({
  clockIn: vi.fn(),
  clockOut: vi.fn(),
  getCurrentShift: vi.fn(),
  autoLink: vi.fn(async () => []),
}))

vi.mock('@/services/supabase', async () => {
  const { createFakeSupabase } = await import('@/test/fakeSupabase')
  const fake = createFakeSupabase()
  return { supabase: fake.supabase, __fake: fake }
})
vi.mock('@/services/clockApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/clockApi')>()
  return {
    ...original,
    clockIn: (...a: unknown[]) => h.clockIn(...a),
    clockOut: (...a: unknown[]) => h.clockOut(...a),
    getCurrentShift: () => h.getCurrentShift(),
  }
})
vi.mock('@/services/managerService', () => ({ autoLinkCleanerToCustomer: (...a: unknown[]) => h.autoLink(...(a as [])) }))
vi.mock('@/components/qr/scanner/QrCamera', async () => ({ QrCamera: (await import('@/test/fakeQrCamera')).FakeQrCamera }))
vi.mock('qr-scanner', () => ({ default: class {} }))
vi.mock('@/components/layout/Sidebar07Layout', () => ({
  Sidebar07Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const supabaseModule = (await import('@/services/supabase')) as unknown as {
  __fake: ReturnType<typeof import('@/test/fakeSupabase').createFakeSupabase>
}
const fakeDb = supabaseModule.__fake
const { emitScan, resetFakeCamera } = await import('@/test/fakeQrCamera')
const { setClockSwitchesForTests } = await import('@/lib/clock/clockFlags')
const { resetClockRuntimeForTests, clockOutbox, getClockView } = await import('@/lib/clock/clockRuntime')
const { default: ClockInPage } = await import('./ClockInPage')

const USER = 'user-1'

const shiftRow = (overrides: Record<string, unknown> = {}) => ({
  id: 4196,
  workerRole: 'cleaner',
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
  ...overrides,
})

const serverResult = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  code: 'clocked_in',
  message: '',
  shift: shiftRow(),
  flags: [],
  qr: null,
  replay: false,
  serverNow: '2026-11-04T07:02:00.000Z',
  ...overrides,
})

const notClockedIn = { ok: true, code: 'not_clocked_in', openShift: null, lastClosed: null, serverNow: 'x', londonToday: '2026-11-04' }
const onShift = (shift = shiftRow()) => ({ ok: true, code: 'clocked_in', openShift: shift, lastClosed: null, serverNow: 'x', londonToday: '2026-11-04' })

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/clock-in']}>
      <Routes>
        <Route path="/clock-in" element={<ClockInPage />} />
        <Route path="/login" element={<div>Login screen</div>} />
      </Routes>
    </MemoryRouter>,
  )

const startScanning = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /start clock in/i }))
  fireEvent.click(await screen.findByRole('button', { name: /start scanning/i }))
}

const scan = async (text: string) => {
  await act(async () => {
    expect(emitScan(text)).toBe(true)
  })
}

const directClockWrites = () =>
  ['time_attendance', 'cleaner_logs', 'live_tracking'].flatMap((table) => fakeDb.writesTo(table))

beforeEach(() => {
  installTestLocalStorage()
  localStorage.setItem('userId', USER)
  localStorage.setItem('userType', 'cleaner')
  localStorage.setItem('userName', 'Jean Test')
  fakeDb.reset()
  resetFakeCamera()
  resetClockRuntimeForTests()
  setClockSwitchesForTests({ clockV2: true, scannerV2: true })
  h.clockIn.mockReset()
  h.clockOut.mockReset()
  h.getCurrentShift.mockReset()
  h.autoLink.mockClear()
  h.getCurrentShift.mockResolvedValue(notClockedIn)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ClockInPage, new clock: clocking in', () => {
  it('sends the scan to clock_in and shows the server time, then the shift', async () => {
    h.clockIn.mockResolvedValue(serverResult())
    renderPage()
    await startScanning()
    await scan('Adams Clock-in')

    expect(await screen.findByText('Clocked in at 07:02')).toBeInTheDocument()
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument()
    expect(h.clockIn).toHaveBeenCalledTimes(1)
    const params = h.clockIn.mock.calls[0][0]
    expect(params.qrPayload).toBe('Adams Clock-in')
    expect(params.eventId).toMatch(/^[0-9a-f-]{36}$/)
    expect(params.waitMs).toBeGreaterThanOrEqual(0)
    expect(params.device).toMatchObject({ client: 'clock_v2', scanner: 'v2', scan: expect.objectContaining({ platform: 'android' }) })
  })

  it('links the cleaner to the customer, and writes no clock rows itself', async () => {
    h.clockIn.mockResolvedValue(serverResult())
    renderPage()
    await startScanning()
    await scan('Adams Clock-in')
    await screen.findByText('Clocked in at 07:02')

    expect(h.autoLink).toHaveBeenCalledWith('Adams', USER)
    expect(directClockWrites()).toEqual([])
    // And no name-based lookups on this path.
    expect(fakeDb.calls.filter((c) => c.op === 'eq' && c.args[0] === 'cleaner_name')).toEqual([])
  })

  it('already clocked in: shows the open shift and a way to clock out', async () => {
    h.clockIn.mockResolvedValue(serverResult({ code: 'already_clocked_in' }))
    renderPage()
    await startScanning()
    await scan('Adams Clock-in')

    expect(await screen.findByText("You're already clocked in")).toBeInTheDocument()
    expect(screen.getByText(/Adams since 07:02/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /clock out/i }).length).toBeGreaterThan(0)
  })

  it('no signal: keeps the scan on the phone and carries on as clocked in', async () => {
    h.clockIn.mockResolvedValue({ ok: false, code: 'network', message: 'x', cause: { message: 'Failed to fetch' } })
    renderPage()
    await startScanning()
    await scan('Adams Clock-in')

    expect((await screen.findAllByText(/saved on this phone/i)).length).toBeGreaterThan(0)
    expect(screen.getByText(/welcome back/i)).toBeInTheDocument()
    expect(clockOutbox.pending(USER)).toHaveLength(1)
  })

  it('expired login: keeps the scan, sends nothing and offers to sign in again', async () => {
    fakeDb.signOut()
    renderPage()
    await startScanning()
    await scan('Adams Clock-in')

    expect((await screen.findAllByText(/your login has expired/i)).length).toBeGreaterThan(0)
    expect(h.clockIn).not.toHaveBeenCalled()
    expect(clockOutbox.pending(USER)).toHaveLength(1)
    fireEvent.click(screen.getAllByRole('button', { name: /sign in again/i })[0])
    expect(await screen.findByText('Login screen')).toBeInTheDocument()
  })

  it('an area code on the clock-in screen is explained, not sent', async () => {
    renderPage()
    await startScanning()
    await scan(JSON.stringify({ id: 'area-1', type: 'AREA', customerName: 'Adams' }))

    expect(await screen.findByText(/That's an area code/)).toBeInTheDocument()
    expect(h.clockIn).not.toHaveBeenCalled()
  })

  it("a role that can't clock is told so", async () => {
    h.clockIn.mockResolvedValue(serverResult({ ok: false, code: 'role_not_allowed', shift: null }))
    renderPage()
    await startScanning()
    await scan('Adams Clock-in')
    expect(await screen.findByText(/your account can't clock in/i)).toBeInTheDocument()
  })
})

describe('ClockInPage, new clock: the server decides the phase', () => {
  it('opens on the shift when the server has one open, even after midnight', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-11-05T01:00:00Z') })
    try {
      h.getCurrentShift.mockResolvedValue(onShift(shiftRow({ clockIn: '2026-11-04T22:00:00.000Z' })))
      renderPage()
      expect(await screen.findByText(/welcome back/i)).toBeInTheDocument()
      expect(screen.getByText(/22:00|10:00 PM/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers to record the finish time when the last shift was closed automatically', async () => {
    h.getCurrentShift.mockResolvedValue({
      ...notClockedIn,
      lastClosed: shiftRow({ clockOut: '2026-11-04T19:02:00.000Z', autoClosed: true, clockOutMissing: true }),
    })
    renderPage()
    expect(await screen.findByText(/closed automatically/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /record my finish time/i })).toBeInTheDocument()
  })
})

describe('ClockInPage, new clock: clocking out', () => {
  const goToClockOut = async () => {
    h.getCurrentShift.mockResolvedValue(onShift())
    renderPage()
    fireEvent.click((await screen.findAllByRole('button', { name: /^clock out$/i }))[0])
    fireEvent.click(await screen.findByRole('button', { name: /start scanning/i }))
  }

  it('late clock-out after an auto-close: saved, and the cleaner is told the manager will confirm', async () => {
    h.clockOut.mockResolvedValue(
      serverResult({
        code: 'late_clock_out',
        flags: ['late_after_auto_close'],
        shift: shiftRow({ clockOut: '2026-11-04T19:30:00.000Z', needsReview: true, autoClosed: true }),
      }),
    )
    await goToClockOut()
    await scan('Adams Clock-out')

    expect(await screen.findByText('Clock-out recorded at 19:30')).toBeInTheDocument()
    expect(screen.getByText(/manager will confirm the hours/i)).toBeInTheDocument()
    await waitFor(() => expect(fakeDb.rpcCalls).toContainEqual({ name: 'shift_summary', args: { p_attendance_id: 4196 } }))
    expect(directClockWrites()).toEqual([])
  })

  it('no open shift: says so and goes back to clock in', async () => {
    h.clockOut.mockResolvedValue(serverResult({ ok: false, code: 'no_open_shift', shift: null }))
    await goToClockOut()
    await scan('Adams Clock-out')

    expect(await screen.findByText("You're not clocked in")).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /start clock in/i })).toBeInTheDocument()
  })
})

describe('ClockInPage, new clock: review fixes', () => {
  it('already clocked in at another site: warns, and Clock out opens the clock-out scanner (M3)', async () => {
    h.clockIn.mockResolvedValue(
      serverResult({ code: 'already_clocked_in', flags: ['open_shift_other_site'], shift: shiftRow({ siteName: 'Avtrade', customerName: 'Avtrade' }) }),
    )
    renderPage()
    await startScanning()
    await scan('Adams Clock-in')

    expect(await screen.findByText("You're still clocked in at Avtrade")).toBeInTheDocument()
    const panel = screen.getByText("You're still clocked in at Avtrade").closest('[role]') as HTMLElement
    fireEvent.click(within(panel).getByRole('button', { name: /^clock out$/i }))
    expect(await screen.findByText('Scan the Clock Out QR code to finish your shift')).toBeInTheDocument()
  })

  it("a clock-in the server can't ever save is explained, and the next scan isn't blocked (H1)", async () => {
    h.clockIn
      .mockResolvedValueOnce({ ok: false, code: 'network', message: 'x', cause: { code: '22003', message: 'out of range' } })
      .mockResolvedValueOnce(serverResult())
    renderPage()
    await startScanning()
    await scan('Adams Clock-in')
    expect(await screen.findByText(/Your clock-in couldn't be saved\. Tell your manager the time you started\./)).toBeInTheDocument()
    expect(clockOutbox.pending(USER)).toEqual([])
    // Shown on screen already, so not again next time.
    expect(getClockView(USER).droppedScans).toEqual([])
  })

  it('tells the cleaner on the next visit about a scan that was too old to send (H2)', async () => {
    localStorage.setItem(
      'clock.droppedScans.v1',
      JSON.stringify([{ userId: USER, eventId: 'e-old', kind: 'clock_out', scannedAtMs: Date.parse('2026-11-01T17:30:00Z'), reason: 'stale' }]),
    )
    renderPage()
    expect(await screen.findByText("Your clock-out couldn't be saved")).toBeInTheDocument()
    expect(screen.getByText(/17:30/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /got it/i }))
    await waitFor(() => expect(screen.queryByText("Your clock-out couldn't be saved")).not.toBeInTheDocument())
  })
})

describe('ClockInPage with clock_v2 off', () => {
  it('keeps the old path: no clock RPC, the old reconcile by name', async () => {
    setClockSwitchesForTests({ clockV2: false, scannerV2: false })
    renderPage()
    expect(await screen.findByRole('button', { name: /start clock in/i })).toBeInTheDocument()
    await waitFor(() =>
      expect(fakeDb.calls).toContainEqual({ table: 'time_attendance', op: 'eq', args: ['cleaner_name', 'Jean Test'] }),
    )
    expect(h.getCurrentShift).not.toHaveBeenCalled()
    expect(h.clockIn).not.toHaveBeenCalled()
  })
})
