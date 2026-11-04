import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { installTestLocalStorage } from '@/test/localStorage'

/**
 * QRScanner against a fake qr-scanner. The real library calls the decode
 * callback for every frame it reads (up to 25 a second) without waiting for
 * the previous call, so the component's own guards are all that stop one
 * poster being processed twice.
 */

const fake = vi.hoisted(() => {
  type Decode = (result: { data: string }) => Promise<void> | void
  class FakeScanner {
    static instances: FakeScanner[] = []
    static listCameras = (..._args: unknown[]): Promise<{ id: string; label: string }[]> =>
      fake.listCameras()
    onDecode: Decode
    options: Record<string, unknown>
    pauseCalls: boolean[] = []
    destroyed = false
    stopCalls = 0
    startedAt: number | null = null
    setCameraCalls: string[] = []
    constructor(_video: unknown, onDecode: Decode, options: Record<string, unknown>) {
      this.onDecode = onDecode
      this.options = options
      FakeScanner.instances.push(this)
    }
    async start() {
      this.startedAt = performance.now()
      await fake.startGate()
    }
    stop() {
      this.stopCalls += 1
    }
    async pause(now = false) {
      this.pauseCalls.push(now)
      return true
    }
    destroy() {
      this.destroyed = true
    }
    async setCamera(id: string) {
      this.setCameraCalls.push(id)
      await fake.switchGate()
    }
  }
  return {
    FakeScanner,
    listCameras: (): Promise<{ id: string; label: string }[]> => Promise.resolve([]),
    startGate: (): Promise<void> => Promise.resolve(),
    switchGate: (): Promise<void> => Promise.resolve(),
    frames: (): Promise<boolean> => Promise.resolve(true),
  }
})

vi.mock('qr-scanner', () => ({ default: fake.FakeScanner }))

vi.mock('@/lib/cameraChoice', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/cameraChoice')>()
  return { ...original, framesAreFlowing: () => fake.frames() }
})

// The canonical-code lookup finds nothing, so the scanned payload is used as is.
vi.mock('../../services/supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'limit', 'is', 'gte', 'lt', 'order']) chain[name] = () => chain
  chain.maybeSingle = async () => ({ data: null, error: null })
  return { supabase: { from: () => chain } }
})

vi.mock('../../services/clockFailureService', () => ({ reportClockFailure: async () => {} }))

const { QRService, SHIFT_CHECK_FAILED_MESSAGE } = await import('@/services/qrService')
const { QRScanner } = await import('./QRScanner')
// These tests cover the old path: both kill switches off (P3 keeps it intact behind them).
const { setClockSwitchesForTests } = await import('@/lib/clock/clockFlags')

const CLOCK_IN = JSON.stringify({ id: 'qr-in-1', type: 'CLOCK_IN', customerName: 'Avtrade' })
const OTHER_CLOCK_IN = JSON.stringify({ id: 'qr-in-2', type: 'CLOCK_IN', customerName: 'Metalex' })

let clock = 1_000_000
const processQRScan = vi.spyOn(QRService, 'processQRScan')

const renderScanner = () =>
  render(
    <MemoryRouter>
      <QRScanner cleanerId="cleaner-1" cleanerName="Jean Test" />
    </MemoryRouter>,
  )

const lastScanner = () => fake.FakeScanner.instances[fake.FakeScanner.instances.length - 1]

const startScanning = async () => {
  const before = fake.FakeScanner.instances.length
  fireEvent.click(screen.getByRole('button', { name: /start scanning/i }))
  await waitFor(() => {
    expect(fake.FakeScanner.instances.length).toBeGreaterThan(before)
    expect(lastScanner().startedAt).not.toBeNull()
  })
  // Let the frame check and camera listing that follow start() settle.
  await act(async () => {})
}

/** One camera frame that decodes, `atMs` after the test's start. */
const decode = async (data: string, atMs: number) => {
  clock = 1_000_000 + atMs
  await act(async () => {
    void lastScanner().onDecode({ data })
  })
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  fake.FakeScanner.instances.length = 0
  fake.listCameras = () => Promise.resolve([])
  fake.startGate = () => Promise.resolve()
  fake.switchGate = () => Promise.resolve()
  fake.frames = () => Promise.resolve(true)
  clock = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  processQRScan.mockReset()
  installTestLocalStorage()
  setClockSwitchesForTests({ clockV2: false, scannerV2: false })
})

afterEach(() => {
  cleanup()
  vi.mocked(Date.now).mockRestore()
})

describe('one poster held in view', () => {
  it('is saved once, and "Saving…" stays up while the first save is still going', async () => {
    const save = deferred<{ success: boolean; message?: string }>()
    processQRScan.mockReturnValue(save.promise)
    renderScanner()
    await startScanning()

    await decode(CLOCK_IN, 0)
    await waitFor(() => expect(processQRScan).toHaveBeenCalledTimes(1))
    await decode(CLOCK_IN, 50)
    await decode(CLOCK_IN, 3100)

    expect(processQRScan).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('Saving…')

    await act(async () => save.resolve({ success: true }))
  })
})

// A definitive answer from the rules ("already clocked in"), as opposed to a
// save that failed on the way (network, database).
const ALREADY_IN = 'You are already clocked in. Please clock out first.'
const rejectWith = (message: string) =>
  processQRScan.mockResolvedValue({ success: false, message, definitive: true })
const failWith = (message: string) => processQRScan.mockResolvedValue({ success: false, message })

describe('after a failed scan', () => {
  it('does not retry the same code by itself, and the error stays on screen', async () => {
    rejectWith(ALREADY_IN)
    renderScanner()
    await startScanning()

    await decode(CLOCK_IN, 0)
    await screen.findByText(/already clocked in/i)
    await decode(CLOCK_IN, 5000)
    await decode(CLOCK_IN, 60_000)

    expect(processQRScan).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/already clocked in/i)).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('tells the cleaner how to scan again after a definitive rejection', async () => {
    rejectWith(ALREADY_IN)
    renderScanner()
    await startScanning()

    await decode(CLOCK_IN, 0)

    expect(await screen.findByText(/already clocked in.*tap ✕ to scan again/i)).toBeInTheDocument()
  })

  it('retries a save that failed on the way after 3 s, with no ✕ hint', async () => {
    failWith('Failed to log clock-in. Please try again.')
    renderScanner()
    await startScanning()

    await decode(CLOCK_IN, 0)
    const message = await screen.findByText(/failed to log clock-in/i)
    expect(message).not.toHaveTextContent(/tap ✕/i)
    await decode(CLOCK_IN, 2000)
    expect(processQRScan).toHaveBeenCalledTimes(1)
    await decode(CLOCK_IN, 3500)

    await waitFor(() => expect(processQRScan).toHaveBeenCalledTimes(2))
  })

  it('takes "Saving…" down and shows an error when the save throws', async () => {
    processQRScan.mockRejectedValue(new Error('boom'))
    renderScanner()
    await startScanning()

    await decode(CLOCK_IN, 0)

    expect(await screen.findByText(/error processing qr code/i)).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('reads the same code again after Stop and Start (a new Start is a retry)', async () => {
    rejectWith(ALREADY_IN)
    renderScanner()
    await startScanning()
    await decode(CLOCK_IN, 0)
    await screen.findByText(/already clocked in/i)
    fireEvent.click(screen.getByRole('button', { name: /stop scanning/i }))

    const save = deferred<{ success: boolean }>()
    processQRScan.mockReturnValue(save.promise)
    await startScanning()
    await decode(CLOCK_IN, 1000)

    await waitFor(() => expect(processQRScan).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('status')).toHaveTextContent('Saving…')
    await act(async () => save.resolve({ success: true }))
  })

  it('tries the same code again once the error is dismissed', async () => {
    rejectWith(ALREADY_IN)
    renderScanner()
    await startScanning()

    await decode(CLOCK_IN, 0)
    await screen.findByText(/already clocked in/i)
    fireEvent.click(screen.getByRole('button', { name: /dismiss message/i }))
    await decode(CLOCK_IN, 100)

    await waitFor(() => expect(processQRScan).toHaveBeenCalledTimes(2))
  })

  it('reads a different code straight away', async () => {
    rejectWith(ALREADY_IN)
    renderScanner()
    await startScanning()

    await decode(CLOCK_IN, 0)
    await screen.findByText(/already clocked in/i)
    await decode(OTHER_CLOCK_IN, 100)

    await waitFor(() => expect(processQRScan).toHaveBeenCalledTimes(2))
  })

  it('retries after 3 s when the shift could not be checked (no signal)', async () => {
    failWith(SHIFT_CHECK_FAILED_MESSAGE)
    renderScanner()
    await startScanning()

    await decode(CLOCK_IN, 0)
    await screen.findByText(/couldn't check your shift/i)
    await decode(CLOCK_IN, 2000)
    expect(processQRScan).toHaveBeenCalledTimes(1)
    await decode(CLOCK_IN, 3500)

    await waitFor(() => expect(processQRScan).toHaveBeenCalledTimes(2))
  })
})

describe('a second scan in the same visit', () => {
  it('is processed after a successful one (no stale "already handled")', async () => {
    processQRScan.mockResolvedValue({ success: true })
    renderScanner()
    await startScanning()
    await decode(CLOCK_IN, 0)
    await waitFor(() => expect(processQRScan).toHaveBeenCalledTimes(1))
    await screen.findByRole('button', { name: /start scanning/i })

    await startScanning()
    await decode(OTHER_CLOCK_IN, 10_000)

    await waitFor(() => expect(processQRScan).toHaveBeenCalledTimes(2))
  })
})

describe('Stop', () => {
  it('cancels a start that is still listing cameras: no camera is opened', async () => {
    const listing = deferred<{ id: string; label: string }[]>()
    fake.listCameras = () => listing.promise
    renderScanner()

    fireEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    fireEvent.click(await screen.findByRole('button', { name: /stop scanning/i }))
    await act(async () => listing.resolve([]))

    const opened = fake.FakeScanner.instances.filter((s) => s.startedAt !== null && !s.destroyed)
    expect(opened).toEqual([])
    expect(screen.getByRole('button', { name: /start scanning/i })).toBeInTheDocument()
  })

  it('releases the camera at once, not on a 300 ms timer', async () => {
    renderScanner()
    await startScanning()
    const scanner = lastScanner()

    fireEvent.click(screen.getByRole('button', { name: /stop scanning/i }))
    await act(async () => {})

    expect(scanner.pauseCalls).toContain(true)
    expect(scanner.destroyed).toBe(true)
  })

  it('makes a quick Start wait out the old scanner’s 300 ms release timer', async () => {
    renderScanner()
    await startScanning()
    fireEvent.click(screen.getByRole('button', { name: /stop scanning/i }))
    const stoppedAt = performance.now()

    await startScanning()

    expect(lastScanner().startedAt! - stoppedAt).toBeGreaterThanOrEqual(300)
  })
})

describe('Stop or leaving during the camera start itself', () => {
  it('Stop leaves no camera open, and Start works again', async () => {
    const opening = deferred<void>()
    fake.startGate = () => opening.promise
    renderScanner()
    fireEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => expect(lastScanner()?.startedAt).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: /stop scanning/i }))
    await act(async () => opening.resolve())

    expect(fake.FakeScanner.instances.every((s) => s.destroyed)).toBe(true)
    fake.startGate = () => Promise.resolve()
    await startScanning()
    expect(screen.getByRole('button', { name: /stop scanning/i })).toBeInTheDocument()
  })

  it('leaving the screen leaves no camera open', async () => {
    const opening = deferred<void>()
    fake.startGate = () => opening.promise
    const { unmount } = renderScanner()
    fireEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => expect(lastScanner()?.startedAt).not.toBeNull())

    unmount()
    await act(async () => opening.resolve())

    expect(fake.FakeScanner.instances.every((s) => s.destroyed)).toBe(true)
  })
})

describe('a start that fails after the camera opened', () => {
  it('releases that camera, so Start works again', async () => {
    fake.frames = () => Promise.reject(new Error('frame check broke'))
    renderScanner()
    await startScanning()
    const scanner = lastScanner()
    await screen.findByText(/failed to start camera/i)

    expect(scanner.destroyed).toBe(true)
    fake.frames = () => Promise.resolve(true)
    await startScanning()
    expect(screen.getByRole('button', { name: /stop scanning/i })).toBeInTheDocument()
  })
})

describe('Switch camera', () => {
  const cameras = [
    { id: 'main', label: 'camera 0, facing back' },
    { id: 'wide', label: 'camera 2, facing back' },
  ]

  it('is hidden until the frame check has finished', async () => {
    fake.listCameras = () => Promise.resolve(cameras)
    const frames = deferred<boolean>()
    renderScanner()
    await startScanning()
    expect(screen.queryByRole('button', { name: /switch camera/i })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /stop scanning/i }))

    fake.frames = () => frames.promise
    await startScanning()
    expect(screen.queryByRole('button', { name: /switch camera/i })).toBeNull()

    await act(async () => frames.resolve(true))
    expect(await screen.findByRole('button', { name: /switch camera/i })).toBeInTheDocument()
  })

  it('ignores a second tap while a switch is still going', async () => {
    fake.listCameras = () => Promise.resolve(cameras)
    renderScanner()
    await startScanning()
    const switching = deferred<void>()
    fake.switchGate = () => switching.promise

    const button = await screen.findByRole('button', { name: /switch camera/i })
    fireEvent.click(button)
    fireEvent.click(button)
    await act(async () => switching.resolve())

    expect(lastScanner().setCameraCalls).toHaveLength(1)
  })
})
