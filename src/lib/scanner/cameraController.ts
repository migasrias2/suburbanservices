/**
 * The only code that opens or closes the camera.
 *
 * Rules (research 03 §1, §4; plan §3.5):
 * - Every open runs through one queue shared by the whole page, so two
 *   getUserMedia calls never overlap and there is never more than one stream.
 * - Release stops the tracks at once (the camera light goes off now, not on a
 *   timer), and the next open waits until REOPEN_GAP_MS after it, also across
 *   controllers: Android needs a moment to let the camera go.
 * - The latest request wins. A release or a newer open makes an older open
 *   stale; a stale open stops whatever stream arrives for it. A stale open that
 *   is still waiting on getUserMedia stops blocking the queue straight away.
 * - Sizes are `ideal` only, never min/exact, and focusMode is never touched
 *   (Chrome on Android is already in continuous autofocus).
 */
import { createSerialQueue, type SerialQueue } from './serialQueue'
import type { CameraOption } from './lensChoice'

export const REOPEN_GAP_MS = 400
export const PLAY_TIMEOUT_MS = 3000
const IDEAL_WIDTH = 1280
const IDEAL_HEIGHT = 720

export interface OpenRequest {
  /** Pin this lens; null/undefined asks for the back camera by facingMode. */
  deviceId?: string | null
}

export interface OpenedCamera {
  deviceId: string | null
  label: string
  settings: MediaTrackSettings
}

export interface ZoomRange {
  min: number
  max: number
  step: number
}

export interface CameraCapabilities {
  torch: boolean
  zoom: ZoomRange | null
}

export interface ReleaseClock {
  mark(at: number): void
  readonly lastReleaseAt: number
}

export interface CameraController {
  open(request: OpenRequest): Promise<OpenedCamera | null>
  release(): void
  listCameras(): Promise<CameraOption[]>
  capabilities(): CameraCapabilities
  setTorch(on: boolean): Promise<boolean>
  setZoom(level: number): Promise<boolean>
  activeTrack(): MediaStreamTrack | null
  dispose(): void
}

export interface CameraControllerOptions {
  mediaDevices?: () => MediaDevices | undefined
  gapMs?: number
  playTimeoutMs?: number
  queue?: SerialQueue
  releaseClock?: ReleaseClock
  now?: () => number
}

export const createReleaseClock = (): ReleaseClock => {
  let last = Number.NEGATIVE_INFINITY
  return {
    mark(at: number) {
      last = at
    },
    get lastReleaseAt() {
      return last
    },
  }
}

// One camera per device: every controller on the page shares these.
const pageQueue = createSerialQueue()
const pageReleaseClock = createReleaseClock()

export const buildVideoConstraints = (request: OpenRequest): MediaTrackConstraints => {
  const lens: MediaTrackConstraints = request.deviceId
    ? { deviceId: { exact: request.deviceId } }
    : { facingMode: { ideal: 'environment' } }
  return { ...lens, width: { ideal: IDEAL_WIDTH }, height: { ideal: IDEAL_HEIGHT } }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const stopStream = (stream: MediaStream | null | undefined): void => {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop()
    } catch {
      // A track that is already gone is fine.
    }
  })
}

const readCapabilities = (track: MediaStreamTrack | null): CameraCapabilities => {
  const caps = (track?.getCapabilities?.() ?? {}) as Record<string, unknown>
  const zoom = caps.zoom as Partial<ZoomRange> | undefined
  const zoomRange =
    zoom && typeof zoom.max === 'number' && typeof zoom.min === 'number' && zoom.max > zoom.min
      ? { min: zoom.min, max: zoom.max, step: typeof zoom.step === 'number' ? zoom.step : 0.1 }
      : null
  return { torch: caps.torch === true, zoom: zoomRange }
}

interface Cancellation {
  promise: Promise<'cancelled'>
  cancel: () => void
}

const createCancellation = (): Cancellation => {
  let cancel = () => {}
  const promise = new Promise<'cancelled'>((resolve) => {
    cancel = () => resolve('cancelled')
  })
  return { promise, cancel }
}

export const createCameraController = (
  video: HTMLVideoElement,
  options: CameraControllerOptions = {},
): CameraController => {
  const getDevices = options.mediaDevices ?? (() => (typeof navigator === 'undefined' ? undefined : navigator.mediaDevices))
  const gapMs = options.gapMs ?? REOPEN_GAP_MS
  const playTimeoutMs = options.playTimeoutMs ?? PLAY_TIMEOUT_MS
  const queue = options.queue ?? pageQueue
  const clock = options.releaseClock ?? pageReleaseClock
  const now = options.now ?? (() => performance.now())

  let generation = 0
  let current: MediaStream | null = null
  let cancellation = createCancellation()
  let disposed = false

  const detachVideo = () => {
    try {
      if (video.srcObject) video.srcObject = null
      video.load?.()
    } catch {
      // jsdom and some old WebViews don't implement load(); clearing srcObject is what matters.
    }
  }

  const releaseCurrent = () => {
    const stream = current
    current = null
    detachVideo()
    if (stream) {
      stopStream(stream)
      clock.mark(now())
    }
  }

  // Bumping the generation makes every open in flight stale.
  const invalidate = () => {
    generation += 1
    cancellation.cancel()
    cancellation = createCancellation()
  }

  // A loop, not one sleep: timers can fire a millisecond early.
  const waitForGap = async () => {
    let wait = clock.lastReleaseAt + gapMs - now()
    while (wait > 0) {
      await sleep(wait)
      wait = clock.lastReleaseAt + gapMs - now()
    }
  }

  const attach = async (stream: MediaStream) => {
    video.muted = true
    video.playsInline = true
    video.setAttribute('playsinline', '')
    video.setAttribute('muted', '')
    video.srcObject = stream
    // A play() that rejects or hangs isn't fatal: the frame watchdog decides.
    const playing = Promise.resolve()
      .then(() => video.play())
      .catch(() => undefined)
    await Promise.race([playing, sleep(playTimeoutMs)])
  }

  const openNow = async (request: OpenRequest, gen: number, cancelled: Promise<'cancelled'>) => {
    const isStale = () => gen !== generation || disposed
    if (isStale()) return null
    releaseCurrent()
    await waitForGap()
    if (isStale()) return null
    const devices = getDevices()
    if (!devices?.getUserMedia) {
      const error = new Error('This browser has no camera API')
      error.name = 'NotFoundError'
      throw error
    }

    const asking = devices.getUserMedia({ audio: false, video: buildVideoConstraints(request) })
    const outcome = await Promise.race([asking, cancelled])
    if (outcome === 'cancelled') {
      // Still waiting on the browser: free the queue, and stop the stream if it ever comes.
      asking.then(
        (late) => {
          stopStream(late)
          clock.mark(now())
        },
        () => undefined,
      )
      return null
    }
    const stream = outcome
    if (isStale()) {
      stopStream(stream)
      clock.mark(now())
      return null
    }
    current = stream
    await attach(stream)
    if (isStale()) return null

    const track = stream.getVideoTracks()[0] ?? null
    const settings = track?.getSettings?.() ?? {}
    return { deviceId: settings.deviceId ?? null, label: track?.label ?? '', settings }
  }

  const activeTrack = () => current?.getVideoTracks()[0] ?? null

  return {
    open(request) {
      invalidate()
      const gen = generation
      const cancelled = cancellation.promise
      return queue.run(() => openNow(request, gen, cancelled))
    },

    release() {
      invalidate()
      releaseCurrent()
    },

    async listCameras() {
      try {
        const all = (await getDevices()?.enumerateDevices?.()) ?? []
        return all.filter((d) => d.kind === 'videoinput').map((d) => ({ id: d.deviceId, label: d.label }))
      } catch {
        return []
      }
    },

    capabilities: () => readCapabilities(activeTrack()),

    async setTorch(on) {
      const track = activeTrack()
      if (!track || !readCapabilities(track).torch) return false
      try {
        await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
        return true
      } catch {
        return false
      }
    },

    async setZoom(level) {
      const track = activeTrack()
      const range = readCapabilities(track).zoom
      if (!track || !range) return false
      const zoom = Math.min(range.max, Math.max(range.min, level))
      try {
        await track.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] })
        return true
      } catch {
        return false
      }
    },

    activeTrack,

    dispose() {
      disposed = true
      invalidate()
      releaseCurrent()
    },
  }
}
