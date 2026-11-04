import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { installTestLocalStorage } from '@/test/localStorage'
import type { QRCodeData } from '@/services/qrService'

/**
 * The area scanner on the new clock path: the "clock in first" gate uses the
 * server's open shift (no calendar day), and the camera is <QrCamera/>.
 */

const h = vi.hoisted(() => ({
  getCurrentShift: vi.fn(),
  hasOpenClockInToday: vi.fn(async () => false),
  processQRScan: vi.fn(async () => ({ success: true })),
}))

vi.mock('@/services/supabase', async () => {
  const { createFakeSupabase } = await import('@/test/fakeSupabase')
  const fake = createFakeSupabase()
  return { supabase: fake.supabase, __fake: fake }
})
vi.mock('@/services/clockApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/clockApi')>()
  return { ...original, getCurrentShift: () => h.getCurrentShift() }
})
vi.mock('@/services/attendanceService', () => ({ hasOpenClockInToday: (...a: unknown[]) => h.hasOpenClockInToday(...(a as [])) }))
vi.mock('@/services/managerService', () => ({ autoLinkCleanerToCustomer: async () => [] }))
vi.mock('@/components/qr/scanner/QrCamera', async () => ({ QrCamera: (await import('@/test/fakeQrCamera')).FakeQrCamera }))
vi.mock('qr-scanner', () => ({ default: class {} }))

const { emitScan, resetFakeCamera, fakeCamera } = await import('@/test/fakeQrCamera')
const { setClockSwitchesForTests } = await import('@/lib/clock/clockFlags')
const { resetClockRuntimeForTests } = await import('@/lib/clock/clockRuntime')
const { QRService } = await import('@/services/qrService')
const { QRScanner } = await import('./QRScanner')
const fakeDb = ((await import('@/services/supabase')) as unknown as {
  __fake: ReturnType<typeof import('@/test/fakeSupabase').createFakeSupabase>
}).__fake

const USER = 'user-1'
const AREA = JSON.stringify({ id: 'area-1', type: 'AREA', customerName: 'Adams', metadata: { areaName: 'Kitchen' } })
const nightShift = {
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
}

const renderScanner = (props: Partial<React.ComponentProps<typeof QRScanner>> = {}) => {
  const onScanSuccess = vi.fn()
  const onWrongType = vi.fn((_data: QRCodeData) => true)
  render(
    <MemoryRouter>
      <QRScanner
        cleanerId={USER}
        cleanerName="Jean Test"
        allowedTypes={['AREA']}
        onScanSuccess={onScanSuccess}
        onWrongType={onWrongType}
        {...props}
      />
    </MemoryRouter>,
  )
  return { onScanSuccess, onWrongType }
}

const startAndScan = async (text: string) => {
  fireEvent.click(await screen.findByRole('button', { name: /start scanning/i }))
  await act(async () => {
    expect(emitScan(text)).toBe(true)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-11-05T01:00:00Z') })
  installTestLocalStorage()
  localStorage.setItem('userId', USER)
  localStorage.setItem('userType', 'cleaner')
  resetFakeCamera()
  resetClockRuntimeForTests()
  setClockSwitchesForTests({ clockV2: true, scannerV2: true })
  h.getCurrentShift.mockReset()
  h.hasOpenClockInToday.mockClear()
  h.processQRScan.mockClear()
  vi.spyOn(QRService, 'processQRScan').mockImplementation(h.processQRScan)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('QRScanner area scans, new clock', () => {
  it('lets a night shift scan areas after midnight (open shift, not calendar day)', async () => {
    h.getCurrentShift.mockResolvedValue({ ok: true, code: 'clocked_in', openShift: nightShift, lastClosed: null, serverNow: 'x' })
    const { onScanSuccess } = renderScanner()
    await startAndScan(AREA)

    await waitFor(() => expect(onScanSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'area-1' })))
    expect(h.hasOpenClockInToday).not.toHaveBeenCalled()
    // The server already answered "on shift": the old shift lookups are skipped.
    expect(h.processQRScan).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'area-1' }),
      USER,
      'Jean Test',
      undefined,
      { shiftChecked: true },
    )
  })

  it('asks to clock in first when the server says there is no open shift', async () => {
    h.getCurrentShift.mockResolvedValue({ ok: true, code: 'not_clocked_in', openShift: null, lastClosed: null, serverNow: 'x' })
    const { onScanSuccess } = renderScanner()
    await startAndScan(AREA)

    expect(await screen.findByText('Clock in first')).toBeInTheDocument()
    expect(onScanSuccess).not.toHaveBeenCalled()
    expect(h.processQRScan).not.toHaveBeenCalled()
  })

  it('lets the scan through when the server cannot be reached (as before)', async () => {
    h.getCurrentShift.mockResolvedValue({ ok: false, code: 'network', message: 'x' })
    const { onScanSuccess } = renderScanner()
    await startAndScan(AREA)
    await waitFor(() => expect(onScanSuccess).toHaveBeenCalled())
  })

  it('hands a Clock Out code over at once, with its raw text and decode time, before any lookup (review M5)', async () => {
    fakeDb.reset()
    const raw = JSON.stringify({ id: 'qr-out-1', type: 'CLOCK_OUT', customerName: 'Adams' })
    const { onWrongType } = renderScanner()
    const decodedAt = Date.now()
    await startAndScan(raw)
    await waitFor(() => expect(onWrongType).toHaveBeenCalled())
    expect(onWrongType.mock.calls[0][0]).toMatchObject({ rawPayload: raw })
    expect(onWrongType.mock.calls[0][0].scannedAtMs).toBeGreaterThanOrEqual(decodedAt)
    expect(onWrongType.mock.calls[0][0].scannedAtMs).toBeLessThanOrEqual(Date.now())
    expect(fakeDb.calls.filter((c) => c.table === 'building_qr_codes')).toEqual([])
  })

  it('hands a Clock Out code over with its raw text', async () => {
    const raw = JSON.stringify({ id: 'qr-out-1', type: 'CLOCK_OUT', customerName: 'Adams' })
    const { onWrongType } = renderScanner()
    await startAndScan(raw)
    await waitFor(() => expect(onWrongType).toHaveBeenCalledWith(expect.objectContaining({ type: 'CLOCK_OUT', rawPayload: raw })))
  })

  it('uses the new camera and pauses it while saving', async () => {
    let finish!: (value: { success: boolean }) => void
    h.processQRScan.mockImplementation(() => new Promise((r) => (finish = r)))
    h.getCurrentShift.mockResolvedValue({ ok: true, code: 'clocked_in', openShift: nightShift, lastClosed: null, serverNow: 'x' })
    renderScanner()
    await startAndScan(AREA)
    expect(screen.getByTestId('qr-camera')).toBeInTheDocument()
    await waitFor(() => expect(fakeCamera.paused).toBe(true))
    expect(screen.getByRole('status')).toHaveTextContent(/saving/i)
    await act(async () => finish({ success: true }))
  })
})

describe('QRScanner area scans, clock_v2 off', () => {
  it('keeps the old calendar-day check', async () => {
    setClockSwitchesForTests({ clockV2: false, scannerV2: true })
    h.hasOpenClockInToday.mockResolvedValue(true)
    const { onScanSuccess } = renderScanner()
    await startAndScan(AREA)
    await waitFor(() => expect(onScanSuccess).toHaveBeenCalled())
    expect(h.hasOpenClockInToday).toHaveBeenCalledWith(USER)
    expect(h.getCurrentShift).not.toHaveBeenCalled()
    expect(h.processQRScan.mock.calls[0]).toHaveLength(4)
  })
})
