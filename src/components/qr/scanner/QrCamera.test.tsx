import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { installTestLocalStorage } from '@/test/localStorage'
import {
  FakeMediaDevices,
  installCameraPermission,
  installFakeMediaDevices,
  installFakeVideo,
  setPageVisibility,
  type FakeDevice,
} from '@/test/fakeMedia'
import type { ScanDiagnostics } from '@/lib/scanner/scanDiagnostics'

/**
 * QrCamera against fake camera hardware and a fake decoder. The decoder module
 * is replaced so no wasm is loaded; everything about the camera (opens,
 * releases, gaps, frames) runs through the real controller and watchdog.
 */

const decoder = vi.hoisted(() => ({
  decodeFrame: vi.fn(async (..._args: unknown[]): Promise<string | null> => null),
  decodeImage: vi.fn(async (..._args: unknown[]): Promise<string | null> => null),
}))

vi.mock('@/lib/scanner/decoder', () => ({
  decodeFrame: (...args: unknown[]) => decoder.decodeFrame(...args),
  decodeImage: (...args: unknown[]) => decoder.decodeImage(...args),
  warmUpDecoder: async () => {},
  getDecoderInfo: () => ({ engine: 'worker', wasmLoadMs: 12, loadError: null }),
}))

const { QrCamera } = await import('./QrCamera')
const { readDecodedCamera } = await import('@/lib/scanner/lensChoice')

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-A256B) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36'
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'

// Fast clocks so the suite runs in seconds; the gap keeps its real 400 ms
// unless a test says otherwise.
const FAST = { watchdogMs: 150, decodeIntervalMs: 5, capabilityDelayMs: 0, stallMs: 400, reopenGapMs: 30 }

const SAMSUNG: FakeDevice[] = [
  { deviceId: 'f1', label: 'camera 1, facing front' },
  { deviceId: 'b0', label: 'camera 0, facing back' },
  { deviceId: 'b2', label: 'camera 2, facing back' },
]

let fake: FakeMediaDevices
const undos: (() => void)[] = []

const setUserAgent = (ua: string) => {
  const saved = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua })
  undos.push(() => {
    if (saved) Object.defineProperty(navigator, 'userAgent', saved)
    else delete (navigator as unknown as Record<string, unknown>).userAgent
  })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const deviceAsked = (index: number) =>
  ((fake.calls[index]?.video as MediaTrackConstraints)?.deviceId as ConstrainDOMStringParameters | undefined)?.exact

const renderCamera = (props: Partial<React.ComponentProps<typeof QrCamera>> = {}) => {
  const onDecode = vi.fn()
  const onDiagnostics = vi.fn<(d: ScanDiagnostics) => void>()
  const all = { active: true, onDecode, onDiagnostics, timings: FAST, ...props }
  const view = render(<QrCamera {...all} />)
  const rerender = (next: Partial<React.ComponentProps<typeof QrCamera>>) =>
    view.rerender(<QrCamera {...all} {...next} />)
  return { ...view, onDecode, onDiagnostics, rerender }
}

const waitLive = () => waitFor(() => expect(screen.getByTestId('qr-camera')).toHaveAttribute('data-status', 'live'))

beforeEach(() => {
  installTestLocalStorage()
  fake = new FakeMediaDevices(SAMSUNG)
  undos.push(installFakeVideo(), installFakeMediaDevices(fake), installCameraPermission('prompt'))
  setUserAgent(ANDROID_UA)
  decoder.decodeFrame.mockReset().mockResolvedValue(null)
  decoder.decodeImage.mockReset().mockResolvedValue(null)
  setPageVisibility('visible')
})

afterEach(async () => {
  cleanup()
  fake.settlePending()
  while (undos.length) undos.pop()?.()
  // Let any late releases settle before the next test's controller starts.
  await sleep(5)
})

describe('QrCamera: opening the camera', () => {
  it('opens one stream and goes live', async () => {
    renderCamera()
    expect(screen.getByText(/starting camera/i)).toBeInTheDocument()
    await waitLive()
    expect(fake.calls).toHaveLength(1)
    expect(fake.liveStreams).toHaveLength(1)
    expect(screen.getByLabelText(/camera preview/i)).toBeInTheDocument()
  })

  it('does nothing while inactive, and releases when made inactive', async () => {
    const { rerender } = renderCamera({ active: false })
    await sleep(50)
    expect(fake.calls).toHaveLength(0)
    rerender({ active: true })
    await waitLive()
    rerender({ active: false })
    expect(fake.liveStreams).toHaveLength(0)
  })

  it('opens the main lens straight away when labels are already readable (installed app)', async () => {
    fake.labelsBeforeGrant = true
    renderCamera()
    await waitLive()
    expect(deviceAsked(0)).toBe('b0')
    expect(fake.calls).toHaveLength(1)
  })

  it('on a first visit, lets the browser choose, then moves once to the main lens', async () => {
    fake.devices = [
      { deviceId: 'b2', label: 'camera 2, facing back' },
      { deviceId: 'b0', label: 'camera 0, facing back' },
    ]
    renderCamera()
    await waitFor(() => expect(fake.calls).toHaveLength(2))
    await waitLive()
    expect(deviceAsked(0)).toBeUndefined()
    expect(deviceAsked(1)).toBe('b0')
    expect(fake.maxSimultaneousLive).toBe(1)
    await sleep(100)
    expect(fake.calls).toHaveLength(2)
  })

  it('never picks by label on iPhone', async () => {
    setUserAgent(IPHONE_UA)
    fake.labelsBeforeGrant = true
    fake.devices = [
      { deviceId: 'i-front', label: 'Front Camera' },
      { deviceId: 'i-wide', label: 'Back Ultra Wide Camera' },
      { deviceId: 'i-back', label: 'Back Camera' },
    ]
    renderCamera()
    await waitLive()
    await sleep(50)
    expect(fake.calls).toHaveLength(1)
    expect(deviceAsked(0)).toBeUndefined()
    expect(screen.queryByRole('button', { name: /switch camera/i })).not.toBeInTheDocument()
  })
})

describe('QrCamera: a camera that shows no picture', () => {
  it('reopens exactly once after a gap of at least 400 ms, then shows "no picture" and releases', async () => {
    fake.script = ['black', 'black']
    renderCamera({ timings: { ...FAST, reopenGapMs: 400 } })
    await waitFor(() => expect(screen.getByTestId('qr-camera')).toHaveAttribute('data-status', 'no-picture'), {
      timeout: 3000,
    })
    expect(fake.calls).toHaveLength(2)
    // The controller measures with performance.now, the fake with Date.now: allow 1 ms of rounding.
    expect(fake.callTimes[1] - fake.stopTimeOf(0)).toBeGreaterThanOrEqual(399)
    expect(fake.liveStreams).toHaveLength(0)
    expect(screen.getByText(/not showing a picture/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /take a photo of the code/i })).toHaveAttribute('data-prominent', 'true')
    await sleep(300)
    expect(fake.calls).toHaveLength(2)
  })

  it('recovers when the reopen shows a picture', async () => {
    fake.script = ['black', 'ok']
    renderCamera()
    await waitLive()
    expect(fake.calls).toHaveLength(2)
    expect(fake.liveStreams).toHaveLength(1)
  })

  it('treats a busy camera (NotReadableError) like no picture: one reopen', async () => {
    fake.script = [{ error: 'NotReadableError' }, 'ok']
    renderCamera()
    await waitLive()
    expect(fake.calls).toHaveLength(2)
  })

  it('Try again starts a fresh attempt with its own reopen', async () => {
    fake.script = ['black', 'black', 'black', 'ok']
    renderCamera()
    await waitFor(() => expect(screen.getByTestId('qr-camera')).toHaveAttribute('data-status', 'no-picture'))
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    await waitLive()
    expect(fake.calls).toHaveLength(4)
  })

  it('reopens once when frames stop while scanning', async () => {
    renderCamera()
    await waitLive()
    fake.streams[0].flowing = false
    await waitFor(() => expect(fake.calls).toHaveLength(2), { timeout: 2000 })
    await waitLive()
    expect(fake.maxSimultaneousLive).toBe(1)
  })

  it('never opens more than 3 times in one session', async () => {
    fake.devices = [
      { deviceId: 'b2', label: 'camera 2, facing back' },
      { deviceId: 'b0', label: 'camera 0, facing back' },
    ]
    fake.script = ['ok', 'black', 'black', 'black']
    renderCamera()
    await waitFor(() => expect(screen.getByTestId('qr-camera')).toHaveAttribute('data-status', 'no-picture'), {
      timeout: 3000,
    })
    await sleep(200)
    expect(fake.calls.length).toBeLessThanOrEqual(3)
  })
})

describe('QrCamera: leaving never leaks a stream', () => {
  it('unmount while getUserMedia is still pending releases the late stream', async () => {
    fake.script = ['hang']
    const { unmount } = renderCamera()
    await waitFor(() => expect(fake.calls).toHaveLength(1))
    unmount()
    fake.settlePending()
    await sleep(10)
    expect(fake.streams).toHaveLength(1)
    expect(fake.liveStreams).toHaveLength(0)
  })

  it('stopping (active=false) while opening releases the late stream', async () => {
    fake.script = ['hang']
    const { rerender } = renderCamera()
    await waitFor(() => expect(fake.calls).toHaveLength(1))
    rerender({ active: false })
    fake.settlePending()
    await sleep(10)
    expect(fake.liveStreams).toHaveLength(0)
  })

  it('unmount when live stops the tracks at once', async () => {
    const { unmount } = renderCamera()
    await waitLive()
    unmount()
    expect(fake.liveStreams).toHaveLength(0)
  })

  it('releases the camera when the page is hidden, and reopens when it is visible again', async () => {
    renderCamera()
    await waitLive()
    act(() => setPageVisibility('hidden'))
    expect(fake.liveStreams).toHaveLength(0)
    await sleep(50)
    expect(fake.calls).toHaveLength(1)
    act(() => setPageVisibility('visible'))
    await waitLive()
    expect(fake.calls).toHaveLength(2)
    expect(fake.liveStreams).toHaveLength(1)
  })

  it('does not reopen on visible if it was not running', async () => {
    renderCamera({ active: false })
    act(() => setPageVisibility('hidden'))
    act(() => setPageVisibility('visible'))
    await sleep(50)
    expect(fake.calls).toHaveLength(0)
  })
})

describe('QrCamera: decoding', () => {
  it('hands a decoded code to onDecode once per dedupe window', async () => {
    decoder.decodeFrame.mockResolvedValue('{"id":"qr-1","type":"CLOCK_IN"}')
    const { onDecode } = renderCamera()
    await waitLive()
    await sleep(400)
    expect(decoder.decodeFrame.mock.calls.length).toBeGreaterThan(5)
    expect(onDecode).toHaveBeenCalledTimes(1)
    expect(onDecode).toHaveBeenCalledWith('{"id":"qr-1","type":"CLOCK_IN"}')
  })

  it('hands it over again once the window has passed', async () => {
    decoder.decodeFrame.mockResolvedValue('CODE')
    const { onDecode } = renderCamera({ timings: { ...FAST, dedupeMs: 100 } })
    await waitLive()
    await waitFor(() => expect(onDecode).toHaveBeenCalledTimes(2), { timeout: 1000 })
  })

  it('a different code is handed over straight away', async () => {
    decoder.decodeFrame.mockResolvedValueOnce('A').mockResolvedValue('B')
    const { onDecode } = renderCamera()
    await waitFor(() => expect(onDecode).toHaveBeenCalledTimes(2))
    expect(onDecode.mock.calls.map((c) => c[0])).toEqual(['A', 'B'])
  })

  it('does not decode or call onDecode while paused, and resumes after', async () => {
    decoder.decodeFrame.mockResolvedValue('CODE')
    const { onDecode, rerender } = renderCamera({ paused: true })
    await waitLive()
    await sleep(100)
    expect(decoder.decodeFrame).not.toHaveBeenCalled()
    expect(onDecode).not.toHaveBeenCalled()
    expect(fake.liveStreams).toHaveLength(1)
    rerender({ paused: false })
    await waitFor(() => expect(onDecode).toHaveBeenCalledTimes(1))
  })

  it('drops a decode that lands after pause was set', async () => {
    let finish: (value: string) => void = () => {}
    decoder.decodeFrame.mockImplementationOnce(() => new Promise<string>((resolve) => (finish = resolve)))
    const { onDecode, rerender } = renderCamera()
    await waitFor(() => expect(decoder.decodeFrame).toHaveBeenCalledTimes(1))
    rerender({ paused: true })
    await act(async () => finish('LATE'))
    await sleep(30)
    expect(onDecode).not.toHaveBeenCalled()
  })

  it('remembers the lens only after it has decoded a code', async () => {
    fake.labelsBeforeGrant = true
    let answer: string | null = null
    decoder.decodeFrame.mockImplementation(async () => answer)
    renderCamera()
    await waitLive()
    await sleep(50)
    expect(readDecodedCamera()).toBeNull()
    answer = 'CODE'
    await waitFor(() => expect(readDecodedCamera()).toBe('b0'))
  })

  it('keeps going when one decode throws', async () => {
    decoder.decodeFrame.mockRejectedValueOnce(new Error('boom')).mockResolvedValue('CODE')
    const { onDecode } = renderCamera()
    // After an error the loop backs off for a second before the next attempt.
    await waitFor(() => expect(onDecode).toHaveBeenCalledWith('CODE'), { timeout: 2500 })
  })
})

describe('QrCamera: still-photo fallback', () => {
  const photoInput = () => screen.getByTestId('qr-photo-input') as HTMLInputElement

  it('is always offered while active, and accepts a camera photo', async () => {
    renderCamera()
    await waitLive()
    expect(screen.getByRole('button', { name: /camera not showing\? take a photo of the code/i })).toBeInTheDocument()
    expect(photoInput()).toHaveAttribute('accept', 'image/*')
    expect(photoInput()).toHaveAttribute('capture', 'environment')
  })

  it('decodes the photo and calls onDecode', async () => {
    decoder.decodeImage.mockResolvedValue('PHOTO-CODE')
    const { onDecode } = renderCamera()
    await waitLive()
    const file = new File(['x'], 'qr.jpg', { type: 'image/jpeg' })
    fireEvent.change(photoInput(), { target: { files: [file] } })
    await waitFor(() => expect(onDecode).toHaveBeenCalledWith('PHOTO-CODE'))
    expect(decoder.decodeImage).toHaveBeenCalledWith(file)
  })

  it('works when the camera never opened at all', async () => {
    fake.script = [{ error: 'NotAllowedError' }]
    decoder.decodeImage.mockResolvedValue('PHOTO-CODE')
    const { onDecode } = renderCamera()
    await screen.findByText(/camera access is blocked/i)
    fireEvent.change(photoInput(), { target: { files: [new File(['x'], 'qr.jpg')] } })
    await waitFor(() => expect(onDecode).toHaveBeenCalledWith('PHOTO-CODE'))
  })

  it('says so when the photo has no readable code', async () => {
    renderCamera()
    await waitLive()
    fireEvent.change(photoInput(), { target: { files: [new File(['x'], 'qr.jpg')] } })
    expect(await screen.findByText(/no qr code found in that photo/i)).toBeInTheDocument()
  })
})

describe('QrCamera: a decoder that never answers (review M2, L6)', () => {
  const photoInput = () => screen.getByTestId('qr-photo-input') as HTMLInputElement
  const hang = () => new Promise<string | null>(() => {})

  it('shows "still loading" when a live decode times out', async () => {
    decoder.decodeFrame.mockImplementation(hang)
    renderCamera({ timings: { ...FAST, decodeTimeoutMs: 40 } })
    await waitLive()
    expect(await screen.findByText(/the scanner is still loading/i)).toBeInTheDocument()
  })

  it('ends a photo read that never answers with a message, not a spinner', async () => {
    decoder.decodeImage.mockImplementation(hang)
    renderCamera({ timings: { ...FAST, photoTimeoutMs: 40 } })
    await waitLive()
    fireEvent.change(photoInput(), { target: { files: [new File(['x'], 'qr.jpg')] } })
    expect(await screen.findByText(/still loading.*try the photo again/i)).toBeInTheDocument()
    expect(screen.queryByText(/reading the photo/i)).not.toBeInTheDocument()
  })

  it('says to wait when a photo is read while the last scan is still saving', async () => {
    decoder.decodeImage.mockResolvedValue('PHOTO-CODE')
    const { onDecode } = renderCamera({ paused: true })
    await waitLive()
    fireEvent.change(photoInput(), { target: { files: [new File(['x'], 'qr.jpg')] } })
    expect(await screen.findByText('Still saving your last scan — try again in a moment')).toBeInTheDocument()
    expect(onDecode).not.toHaveBeenCalled()
  })
})

describe('QrCamera: permission and hardware states', () => {
  it('shows plain instructions for Android Chrome and iPhone Safari when access is denied', async () => {
    fake.script = [{ error: 'NotAllowedError' }]
    renderCamera()
    expect(await screen.findByText(/camera access is blocked/i)).toBeInTheDocument()
    expect(screen.getByText(/android/i)).toBeInTheDocument()
    expect(screen.getByText(/iphone/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(fake.calls).toHaveLength(1)
    expect(fake.liveStreams).toHaveLength(0)
  })

  it('does not even ask when the browser already says camera is denied', async () => {
    undos.push(installCameraPermission('denied'))
    renderCamera()
    expect(await screen.findByText(/camera access is blocked/i)).toBeInTheDocument()
    expect(fake.calls).toHaveLength(0)
  })

  it('Try again after a denial asks again', async () => {
    fake.script = [{ error: 'NotAllowedError' }]
    renderCamera()
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }))
    await waitLive()
    expect(fake.calls).toHaveLength(2)
  })

  it('shows "no camera" when the device has none', async () => {
    fake.script = [{ error: 'NotFoundError' }]
    renderCamera()
    expect(await screen.findByText(/no camera found/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /take a photo of the code/i })).toBeInTheDocument()
  })

  it('shows "no camera" when the browser has no camera API', async () => {
    undos.push(installFakeMediaDevices(undefined as unknown as FakeMediaDevices))
    renderCamera()
    expect(await screen.findByText(/no camera found/i)).toBeInTheDocument()
  })
})

describe('QrCamera: switch camera and torch', () => {
  it('offers Switch camera only after frames are confirmed, cycling back lenses only', async () => {
    fake.labelsBeforeGrant = true
    fake.script = ['hang']
    renderCamera()
    await waitFor(() => expect(fake.calls).toHaveLength(1))
    expect(screen.queryByRole('button', { name: /switch camera/i })).not.toBeInTheDocument()
    fake.settlePending()
    await waitLive()
    fireEvent.click(await screen.findByRole('button', { name: /switch camera/i }))
    await waitFor(() => expect(fake.calls).toHaveLength(2))
    expect(deviceAsked(1)).toBe('b2')
    await waitLive()
    fireEvent.click(await screen.findByRole('button', { name: /switch camera/i }))
    await waitFor(() => expect(fake.calls).toHaveLength(3))
    expect(deviceAsked(2)).toBe('b0')
    expect(fake.maxSimultaneousLive).toBe(1)
  })

  it('hides Switch camera when there is only one back lens', async () => {
    fake.labelsBeforeGrant = true
    fake.devices = [
      { deviceId: 'f1', label: 'camera 1, facing front' },
      { deviceId: 'b0', label: 'camera 0, facing back' },
    ]
    renderCamera()
    await waitLive()
    await sleep(30)
    expect(screen.queryByRole('button', { name: /switch camera/i })).not.toBeInTheDocument()
  })

  it('shows a torch button only when the camera supports it, and toggles it on the live track', async () => {
    fake.capabilities = { torch: true }
    renderCamera()
    await waitLive()
    const torch = await screen.findByRole('button', { name: /turn light on/i })
    fireEvent.click(torch)
    await waitFor(() => expect(fake.streams[0].track.applied).toEqual([{ advanced: [{ torch: true }] }]))
    expect(await screen.findByRole('button', { name: /turn light off/i })).toHaveAttribute('aria-pressed', 'true')
    expect(fake.calls).toHaveLength(1)
  })

  it('shows no torch button without the capability', async () => {
    renderCamera()
    await waitLive()
    await sleep(30)
    expect(screen.queryByRole('button', { name: /turn light/i })).not.toBeInTheDocument()
  })

  it('never asks for focusMode', async () => {
    fake.capabilities = { torch: true, zoom: { min: 1, max: 4, step: 0.1 }, focusMode: ['continuous'] }
    renderCamera()
    await waitLive()
    fireEvent.click(await screen.findByRole('button', { name: /turn light on/i }))
    fireEvent.click(await screen.findByRole('button', { name: /zoom/i }))
    await sleep(30)
    const applied = JSON.stringify(fake.streams.flatMap((s) => s.track.applied))
    expect(applied).toMatch(/torch/)
    expect(applied).toMatch(/zoom/)
    expect(applied).not.toMatch(/focusMode/)
  })
})

describe('QrCamera: diagnostics', () => {
  it('reports a plain object with the facts of the session', async () => {
    fake.script = ['black', 'ok']
    decoder.decodeFrame.mockResolvedValue('CODE')
    const { onDiagnostics, unmount } = renderCamera()
    await waitFor(() => expect(onDiagnostics).toHaveBeenCalled())
    await waitFor(() => {
      const last = onDiagnostics.mock.calls.at(-1)?.[0]
      expect(last?.timeToFirstDecodeMs).not.toBeNull()
    })
    unmount()
    const last = onDiagnostics.mock.calls.at(-1)?.[0] as ScanDiagnostics
    expect(last).toMatchObject({
      userAgent: ANDROID_UA,
      platform: 'android',
      cameraCount: 3,
      reopenUsed: true,
      decoderEngine: 'worker',
      wasmLoadMs: 12,
    })
    expect(last.openAttempts).toHaveLength(2)
    expect(last.openAttempts[0]).toMatchObject({ ok: true, frames: false })
    expect(last.openAttempts[1]).toMatchObject({ ok: true, frames: true })
    expect(last.timeToFirstFrameMs).not.toBeNull()
    expect(last.decodeAttempts).toBeGreaterThan(0)
    expect(JSON.parse(JSON.stringify(last))).toEqual(last)
  })

  it('records a denial and the still photo', async () => {
    fake.script = [{ error: 'NotAllowedError' }]
    decoder.decodeImage.mockResolvedValue('PHOTO')
    const { onDiagnostics } = renderCamera()
    await screen.findByText(/camera access is blocked/i)
    fireEvent.change(screen.getByTestId('qr-photo-input'), { target: { files: [new File(['x'], 'qr.jpg')] } })
    await waitFor(() => {
      const last = onDiagnostics.mock.calls.at(-1)?.[0]
      expect(last?.stillPhoto).toEqual({ used: true, attempts: 1, decoded: true })
    })
    const last = onDiagnostics.mock.calls.at(-1)?.[0] as ScanDiagnostics
    expect(last.errors.map((e) => e.name)).toContain('NotAllowedError')
    expect(last.outcome).toBe('photo')
  })
})
