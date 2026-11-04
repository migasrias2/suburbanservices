import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installTestLocalStorage } from '@/test/localStorage'
import {
  pickScanCamera,
  nextCameraId,
  framesAreFlowing,
  readRememberedCamera,
  rememberCamera,
  SCAN_CAMERA_STORAGE_KEY,
} from './cameraChoice'

// Labels as Chrome on Android reports them (Samsung Galaxy S22, after camera
// permission is granted). Four back lenses; only camera2 0 is the main one.
const samsung = [
  { id: 'front', label: 'camera2 1, facing front' },
  { id: 'main', label: 'camera2 0, facing back' },
  { id: 'ultrawide', label: 'camera2 2, facing back' },
  { id: 'tele', label: 'camera2 3, facing back' },
]

describe('pickScanCamera', () => {
  it("picks the Android phone's main back lens, not the ultra-wide that cannot focus close", () => {
    expect(pickScanCamera(samsung)).toBe('main')
  })

  it('picks the main lens whatever order the browser lists them in', () => {
    expect(pickScanCamera([...samsung].reverse())).toBe('main')
  })

  it('keeps the camera the person switched to last time, if it still exists', () => {
    expect(pickScanCamera(samsung, 'tele')).toBe('tele')
    expect(pickScanCamera(samsung, 'gone')).toBe('main')
  })

  it('skips ultra-wide, telephoto and macro lenses on phones that name them', () => {
    expect(
      pickScanCamera([
        { id: 'uw', label: 'Back Ultra Wide Camera' },
        { id: 'back', label: 'Back Camera' },
        { id: 'tele', label: 'Back Telephoto Camera' },
      ]),
    ).toBe('back')
  })

  it("leaves the choice to the browser when it can't tell the lenses apart", () => {
    expect(pickScanCamera([{ id: 'a', label: '' }, { id: 'b', label: '' }])).toBeNull()
    expect(pickScanCamera([])).toBeNull()
  })

  it('never picks a front camera', () => {
    expect(pickScanCamera([{ id: 'front', label: 'camera2 1, facing front' }])).toBeNull()
  })

  // Chrome renamed "camera2 0" to "camera 0" in 2025. Listed ultra-wide first,
  // as some Samsungs do, so a plain "first back camera" guess would be wrong.
  const chrome2025 = [
    { id: 'ultrawide', label: 'camera 2, facing back' },
    { id: 'front', label: 'camera 1, facing front' },
    { id: 'main', label: 'camera 0, facing back' },
    { id: 'tele', label: 'camera 3, facing back' },
  ]

  it('picks the main lens under the newer "camera 0" label too', () => {
    expect(pickScanCamera(chrome2025)).toBe('main')
  })

  it('picks "camera 0" over "camera 10" listed before it', () => {
    expect(
      pickScanCamera([
        { id: 'ten', label: 'camera 10, facing back' },
        { id: 'main', label: 'camera 0, facing back' },
      ]),
    ).toBe('main')
  })

  it('does not take a label that only contains "camera2 0, facing back"', () => {
    expect(
      pickScanCamera([
        { id: 'aux', label: 'aux camera2 0, facing back (depth)' },
        { id: 'main', label: 'camera2 0, facing back' },
      ]),
    ).toBe('main')
  })
})

describe('nextCameraId', () => {
  it('moves to the next camera and wraps round', () => {
    expect(nextCameraId(samsung, 'main')).toBe('ultrawide')
    expect(nextCameraId(samsung, 'tele')).toBe('front')
  })

  it('starts from the first camera when the current one is unknown', () => {
    expect(nextCameraId(samsung, null)).toBe('front')
  })

  it('has nothing to switch to with one camera or none', () => {
    expect(nextCameraId([samsung[1]], 'main')).toBeNull()
    expect(nextCameraId([], null)).toBeNull()
  })
})

// A video element as the browser leaves it. `times` is what currentTime reads
// on each successive poll. `frameAfterMs` makes requestVideoFrameCallback fire
// once after that delay; leave it out for a browser without the callback.
const fakeVideo = (fields: {
  readyState: number
  videoWidth: number
  times: number[]
  frameAfterMs?: number | 'never'
}) => {
  let reads = 0
  const cancelled: number[] = []
  const video: Record<string, unknown> = {
    readyState: fields.readyState,
    videoWidth: fields.videoWidth,
    paused: false,
    srcObject: null,
    get currentTime() {
      return fields.times[Math.min(reads++, fields.times.length - 1)]
    },
  }
  if (fields.frameAfterMs !== undefined) {
    video.requestVideoFrameCallback = (callback: () => void) => {
      if (fields.frameAfterMs !== 'never') setTimeout(callback, fields.frameAfterMs)
      return 7
    }
    video.cancelVideoFrameCallback = (handle: number) => cancelled.push(handle)
  }
  return { video: video as unknown as HTMLVideoElement, cancelled }
}

describe('framesAreFlowing', () => {
  it('is true once the video has a size and its clock is moving', async () => {
    const { video } = fakeVideo({ readyState: 4, videoWidth: 1280, times: [0.1, 0.3, 0.5] })
    await expect(framesAreFlowing(video, 500, 10)).resolves.toBe(true)
  })

  it('is false for a camera that opened but never delivered a frame (the black preview)', async () => {
    const { video } = fakeVideo({ readyState: 1, videoWidth: 0, times: [0] })
    await expect(framesAreFlowing(video, 80, 10)).resolves.toBe(false)
  })

  it('is false when the picture is frozen on one frame', async () => {
    const { video } = fakeVideo({ readyState: 4, videoWidth: 1280, times: [0.2] })
    await expect(framesAreFlowing(video, 80, 10)).resolves.toBe(false)
  })

  it('is false when there is no video element', async () => {
    await expect(framesAreFlowing(null, 50, 10)).resolves.toBe(false)
  })

  it('trusts a frame callback even when currentTime has not moved yet', async () => {
    const { video } = fakeVideo({ readyState: 4, videoWidth: 1280, times: [0.2], frameAfterMs: 5 })
    await expect(framesAreFlowing(video, 200, 10)).resolves.toBe(true)
  })

  it('still sees a moving clock on a browser whose frame callback stays silent', async () => {
    const { video } = fakeVideo({ readyState: 4, videoWidth: 1280, times: [0.1, 0.3], frameAfterMs: 'never' })
    await expect(framesAreFlowing(video, 200, 10)).resolves.toBe(true)
  })

  it('gives back the frame callback when it times out, so nothing fires later', async () => {
    const { video, cancelled } = fakeVideo({ readyState: 1, videoWidth: 0, times: [0], frameAfterMs: 'never' })
    await expect(framesAreFlowing(video, 50, 10)).resolves.toBe(false)
    expect(cancelled).toEqual([7])
  })

  it('does not judge the picture by how dark it is', async () => {
    // A dark room is not a dead camera. The old check drew the frame to a
    // canvas and called anything under 8/255 "black"; none of that now.
    const createElement = vi.spyOn(document, 'createElement')
    const { video } = fakeVideo({ readyState: 4, videoWidth: 1280, times: [0.1, 0.3] })
    await framesAreFlowing(video, 200, 10)
    expect(createElement).not.toHaveBeenCalledWith('canvas')
    createElement.mockRestore()
  })
})

describe('remembered camera', () => {
  beforeEach(() => {
    installTestLocalStorage()
  })

  it('reads back the camera the person switched to', () => {
    rememberCamera('tele')
    expect(readRememberedCamera()).toBe('tele')
    expect(localStorage.getItem(SCAN_CAMERA_STORAGE_KEY)).toBe('tele')
  })

  it('is null when nothing was remembered', () => {
    expect(readRememberedCamera()).toBeNull()
  })

  it('never throws when storage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('blocked')
        },
      },
      configurable: true,
      writable: true,
    })
    expect(() => rememberCamera('main')).not.toThrow()
    expect(readRememberedCamera()).toBeNull()
  })
})
