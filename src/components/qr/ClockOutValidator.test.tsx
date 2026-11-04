import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { installTestLocalStorage } from '@/test/localStorage'

/** ClockOutValidator's camera lifecycle, against a fake qr-scanner. */

const fake = vi.hoisted(() => {
  class FakeScanner {
    static instances: FakeScanner[] = []
    static listCameras = (): Promise<{ id: string; label: string }[]> => fake.listCameras()
    pauseCalls: boolean[] = []
    destroyed = false
    started = false
    setCameraCalls: string[] = []
    constructor() {
      FakeScanner.instances.push(this)
    }
    async start() {
      this.started = true
      await fake.startGate()
    }
    stop() {}
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
    switchGate: (): Promise<void> => Promise.resolve(),
    startGate: (): Promise<void> => Promise.resolve(),
    reportClockFailure: vi.fn(async () => {}),
  }
})

vi.mock('qr-scanner', () => ({ default: fake.FakeScanner }))
vi.mock('@/lib/cameraChoice', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/cameraChoice')>()
  return { ...original, framesAreFlowing: async () => true }
})
vi.mock('../../services/supabase', () => ({ supabase: { from: () => ({}) } }))
vi.mock('../../services/clockFailureService', () => ({
  reportClockFailure: (...args: unknown[]) => fake.reportClockFailure(...(args as [])),
}))

const { ClockOutValidator } = await import('./ClockOutValidator')
// These tests cover the old path: both kill switches off (P3 keeps it intact behind them).
const { setClockSwitchesForTests } = await import('@/lib/clock/clockFlags')

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const renderValidator = () => render(<ClockOutValidator cleanerId="cleaner-1" cleanerName="Jean Test" />)

beforeEach(() => {
  fake.FakeScanner.instances.length = 0
  fake.listCameras = () => Promise.resolve([])
  fake.switchGate = () => Promise.resolve()
  fake.startGate = () => Promise.resolve()
  fake.reportClockFailure.mockClear()
  installTestLocalStorage()
  setClockSwitchesForTests({ clockV2: false, scannerV2: false })
})

afterEach(() => cleanup())

describe('Stop during a start that is still listing cameras', () => {
  it('opens no camera', async () => {
    const listing = deferred<{ id: string; label: string }[]>()
    fake.listCameras = () => listing.promise
    renderValidator()

    fireEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    fireEvent.click(await screen.findByRole('button', { name: /stop scanning/i }))
    await act(async () => listing.resolve([]))

    expect(fake.FakeScanner.instances.filter((s) => s.started && !s.destroyed)).toEqual([])
  })
})

describe('leaving the screen during a start', () => {
  it('opens no camera and logs no false "camera did not start" failure', async () => {
    const listing = deferred<{ id: string; label: string }[]>()
    fake.listCameras = () => listing.promise
    const { unmount } = renderValidator()

    fireEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    unmount()
    await act(async () => listing.resolve([]))

    expect(fake.FakeScanner.instances.filter((s) => s.started && !s.destroyed)).toEqual([])
    expect(fake.reportClockFailure).not.toHaveBeenCalled()
  })
})

describe('Stop', () => {
  it('releases the camera at once', async () => {
    renderValidator()
    fireEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => expect(fake.FakeScanner.instances[0]?.started).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: /stop scanning/i }))
    await act(async () => {})

    expect(fake.FakeScanner.instances[0].pauseCalls).toContain(true)
    expect(fake.FakeScanner.instances[0].destroyed).toBe(true)
  })
})

describe('Switch camera', () => {
  it('ignores a second tap while a switch is still going', async () => {
    fake.listCameras = () =>
      Promise.resolve([
        { id: 'main', label: 'camera 0, facing back' },
        { id: 'wide', label: 'camera 2, facing back' },
      ])
    renderValidator()
    fireEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    const button = await screen.findByRole('button', { name: /switch camera/i })
    const switching = deferred<void>()
    fake.switchGate = () => switching.promise

    fireEvent.click(button)
    fireEvent.click(button)
    await act(async () => switching.resolve())

    expect(fake.FakeScanner.instances[0].setCameraCalls).toHaveLength(1)
  })
})

describe('Stop during the camera start itself', () => {
  it('leaves no camera open, and Start works again', async () => {
    const opening = deferred<void>()
    fake.startGate = () => opening.promise
    renderValidator()
    fireEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => expect(fake.FakeScanner.instances[0]?.started).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: /stop scanning/i }))
    await act(async () => opening.resolve())

    expect(fake.FakeScanner.instances[0].destroyed).toBe(true)
    fake.startGate = () => Promise.resolve()
    fireEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    expect(await screen.findByRole('button', { name: /stop scanning/i })).toBeInTheDocument()
  })
})

describe('a cancelled start whose camera then fails to open', () => {
  it('does not release the camera a newer start has opened', async () => {
    let failFirstOpen!: (reason: unknown) => void
    const firstOpen = new Promise<void>((_resolve, reject) => {
      failFirstOpen = reject
    })
    let opens = 0
    fake.startGate = () => (opens++ === 0 ? firstOpen : Promise.resolve())
    renderValidator()

    fireEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => expect(fake.FakeScanner.instances[0]?.started).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: /stop scanning/i }))
    fireEvent.click(screen.getByRole('button', { name: /start scanning/i }))
    await waitFor(() => expect(fake.FakeScanner.instances[1]?.started).toBe(true))
    await act(async () => {})

    // The first, cancelled start only now hears that its camera failed.
    await act(async () => failFirstOpen(new Error('Could not start video source')))

    expect(fake.FakeScanner.instances[1].destroyed).toBe(false)
    expect(fake.reportClockFailure).not.toHaveBeenCalled()
  })
})
