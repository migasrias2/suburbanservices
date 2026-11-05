/**
 * One scan session: open the right lens, prove frames arrive, decode, and
 * recover in a bounded way. Framework-free; QrCamera.tsx renders its view.
 *
 * Open sequence (plan §3.5, research 03 §5):
 *  1. permissions.query('camera') === 'denied' → "blocked" help; no open.
 *  2. enumerateDevices() (no probe stream) → chooseLens: remembered decoded
 *     lens → Android "camera 0, facing back" → plain back label → facingMode.
 *     iPhone: facingMode only.
 *  3. ONE getUserMedia; frame watchdog (3 s).
 *  4. No frames (or busy camera) → one clean reopen with facingMode after the
 *     controller's 400 ms gap. Still nothing → "no picture", camera released,
 *     photo fallback made prominent.
 *  5. First visit on Android (labels were unreadable): once live, if Chrome
 *     opened a lens other than "camera 0", move to camera 0 once.
 *  So at most 3 opens per start: initial, lens correction, one reopen.
 *  While live: a 3 s frame stall (or the track ending) uses the same single
 *  reopen; hidden page → release; visible again → start over.
 */
import type { CameraController, OpenRequest } from './cameraController'
import { waitForFrames, watchFrames } from './frameWatchdog'
import {
  chooseLens,
  findAndroidMainLens,
  nextCameraId,
  readDecodedCamera,
  rememberDecodedCamera,
  switchableCameras,
  type CameraOption,
} from './lensChoice'
import { detectPlatform } from './platform'
import * as D from './scanDiagnostics'
import type { DecoderInfo } from './decoder'

export type CameraStatus = 'idle' | 'starting' | 'live' | 'no-picture' | 'denied' | 'no-camera'
// 'timeout': the decoder didn't answer (still loading on weak signal).
// 'busy': a code was read while the screen was still saving the last scan.
export type PhotoStatus = 'idle' | 'decoding' | 'not-found' | 'failed' | 'timeout' | 'busy'
type Toggle = 'unsupported' | 'off' | 'on'

export interface ScanView {
  status: CameraStatus
  /** Still starting after slowStartMs (a hung camera, or an unanswered permission prompt). */
  slowStart: boolean
  /** The watchdog gave up: the photo fallback should be the main action. */
  watchdogFailed: boolean
  canSwitch: boolean
  torch: Toggle
  zoom: Toggle
  photo: PhotoStatus
  /** Several decodes in a row failed (the wasm didn't load). */
  decoderTrouble: boolean
}

export interface ScanTimings {
  watchdogMs: number
  reopenGapMs: number
  decodeIntervalMs: number
  capabilityDelayMs: number
  stallMs: number
  slowStartMs: number
  dedupeMs: number
  /** A live decode with no answer after this long counts as a failure (review M2). */
  decodeTimeoutMs: number
  /** Same for a photo, which is bigger and is read twice (whole, then centre). */
  photoTimeoutMs: number
}

export const DEFAULT_TIMINGS: ScanTimings = {
  watchdogMs: 3000,
  reopenGapMs: 400,
  // ~8 decodes a second at most, one in flight.
  decodeIntervalMs: 120,
  // getCapabilities() can be empty for ~500 ms after start (research 03 §1 row 4).
  capabilityDelayMs: 500,
  stallMs: 3000,
  slowStartMs: 8000,
  dedupeMs: 1500,
  decodeTimeoutMs: 8000,
  photoTimeoutMs: 15000,
}

export const INITIAL_VIEW: ScanView = {
  status: 'idle',
  slowStart: false,
  watchdogFailed: false,
  canSwitch: false,
  torch: 'unsupported',
  zoom: 'unsupported',
  photo: 'idle',
  decoderTrouble: false,
}

const CAMERA_OFF = { canSwitch: false, torch: 'unsupported', zoom: 'unsupported' } as const
const DECODER_TROUBLE_AFTER = 5
const ERROR_BACKOFF_MS = 1000
const ZOOM_LEVEL = 2

export interface ScanDecoder {
  decodeFrame(video: HTMLVideoElement, attempt: number): Promise<string | null>
  decodeImage(image: Blob): Promise<string | null>
  getDecoderInfo(): DecoderInfo
}

export interface ScanSessionOptions {
  video: HTMLVideoElement
  controller: CameraController
  decoder: ScanDecoder
  onView: (view: ScanView) => void
  onDecode: (text: string) => void
  onDiagnostics?: (diagnostics: D.ScanDiagnostics) => void
  timings?: Partial<ScanTimings>
  paused?: boolean
}

export interface ScanSession {
  start(): Promise<void>
  stop(): void
  retry(): Promise<void>
  setPaused(paused: boolean): void
  switchCamera(): Promise<void>
  toggleTorch(): Promise<void>
  toggleZoom(): Promise<void>
  decodePhoto(file: Blob): Promise<void>
  dispose(): void
}

type OpenResult = 'live' | 'no-frames' | 'denied' | 'no-camera' | 'lens-missing' | 'cancelled'
type OpenReason = NonNullable<D.OpenAttempt['reason']>

const DENIED = new Set(['NotAllowedError', 'SecurityError', 'PermissionDeniedError'])
const MISSING = new Set(['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'])

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The decoder didn't answer in time: almost always the wasm still downloading. */
export class DecoderTimeoutError extends Error {
  constructor() {
    super('The decoder did not answer in time')
    this.name = 'DecoderTimeoutError'
  }
}

// The decode itself carries on; we just stop waiting for it.
const within = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new DecoderTimeoutError()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })

const queryCameraPermission = async (): Promise<PermissionState | 'unknown'> => {
  try {
    const status = await navigator.permissions?.query?.({ name: 'camera' as PermissionName })
    return status?.state ?? 'unknown'
  } catch {
    return 'unknown' // Firefox doesn't know the 'camera' permission name.
  }
}

export const createScanSession = (options: ScanSessionOptions): ScanSession => {
  const { video, controller, decoder } = options
  const t: ScanTimings = { ...DEFAULT_TIMINGS, ...options.timings }
  const now = () => performance.now()
  const platform = detectPlatform()
  const isIOS = platform === 'ios'

  let view: ScanView = INITIAL_VIEW
  let run = 0
  let abort = new AbortController()
  let wanted = false
  let paused = options.paused ?? false
  let disposed = false
  let reopenUsed = false
  let correctionUsed = false
  let resumeOnVisible = false
  let active: { deviceId: string | null } | null = null
  let cameras: CameraOption[] = []
  let lastEmit: { text: string; at: number } | null = null
  let attempt = 0
  let decodeErrorsInRow = 0
  let liveCleanups: (() => void)[] = []
  let startedAt = now()
  let diag = D.startDiagnostics({ userAgent: navigator.userAgent, platform, startedAt: Date.now() })
  let diagClosed = false

  const setView = (patch: Partial<ScanView>) => {
    view = { ...view, ...patch }
    if (!disposed) options.onView(view)
  }
  const elapsed = () => now() - startedAt
  const publish = () => {
    const info = decoder.getDecoderInfo()
    options.onDiagnostics?.({ ...diag, decoderEngine: info.engine, wasmLoadMs: info.wasmLoadMs })
  }
  const noteError = (error: unknown) => {
    const name = error instanceof Error ? error.name : 'Error'
    const message = error instanceof Error ? error.message : String(error)
    diag = D.withError(diag, name, message, elapsed())
  }

  const stopLive = () => {
    liveCleanups.forEach((undo) => undo())
    liveCleanups = []
  }
  /** Starts a new run: everything belonging to the previous one stops. */
  const newRun = () => {
    run += 1
    abort.abort()
    abort = new AbortController()
    stopLive()
    return run
  }
  const isStale = (myRun: number) => myRun !== run || disposed

  const openOnce = async (myRun: number, request: OpenRequest, reason: OpenReason): Promise<OpenResult> => {
    const began = now()
    const kind = request.deviceId ? 'device' : 'facing-mode'
    let opened
    try {
      opened = await controller.open(request)
    } catch (error) {
      if (isStale(myRun)) return 'cancelled'
      const name = error instanceof Error ? error.name : 'Error'
      diag = D.withOpenAttempt(diag, { request: kind, reason, ok: false, ms: Math.round(now() - began), errorName: name })
      noteError(error)
      if (DENIED.has(name)) return 'denied'
      if (MISSING.has(name)) return request.deviceId ? 'lens-missing' : 'no-camera'
      return 'no-frames' // NotReadableError (camera busy), AbortError and the like.
    }
    if (!opened || isStale(myRun)) return 'cancelled'
    active = { deviceId: opened.deviceId }
    const s = opened.settings as MediaTrackSettings & { zoom?: number }
    diag = D.withOpenAttempt(diag, {
      request: kind,
      reason,
      ok: true,
      ms: Math.round(now() - began),
      label: opened.label,
      width: s.width,
      height: s.height,
      frameRate: s.frameRate,
      zoom: s.zoom,
    })
    const frames = await waitForFrames(video, { timeoutMs: t.watchdogMs, signal: abort.signal })
    if (isStale(myRun)) return 'cancelled'
    diag = D.withFramesResult(diag, frames)
    if (frames) diag = D.withFirstFrame(diag, elapsed())
    return frames ? 'live' : 'no-frames'
  }

  /** The single clean reopen, if still unused; facingMode, after the controller's gap. */
  const reopen = async (myRun: number, request: OpenRequest = { deviceId: null }): Promise<OpenResult> => {
    reopenUsed = true
    diag = D.withPatch(diag, { reopenUsed: true })
    controller.release()
    return openOnce(myRun, request, 'reopen')
  }

  const finish = (myRun: number, result: OpenResult) => {
    if (isStale(myRun) || result === 'cancelled' || result === 'live') return
    newRun()
    controller.release()
    const status: CameraStatus = result === 'denied' ? 'denied' : result === 'no-camera' ? 'no-camera' : 'no-picture'
    diag = D.withOutcome(diag, status)
    setView({ ...CAMERA_OFF, status, slowStart: false, watchdogFailed: status === 'no-picture' })
    publish()
  }

  const emitDecode = (text: string, source: 'camera' | 'photo') => {
    if (paused || disposed) return
    const at = now()
    if (source === 'camera' && lastEmit && lastEmit.text === text && at - lastEmit.at < t.dedupeMs) return
    lastEmit = { text, at }
    diag = D.withOutcome(D.withDecode(diag, elapsed()), source === 'photo' ? 'photo' : 'decoded')
    if (source === 'camera' && !isIOS && active?.deviceId) rememberDecodedCamera(active.deviceId)
    publish()
    options.onDecode(text)
  }

  const decodeLoop = async (myRun: number) => {
    while (!isStale(myRun)) {
      if (!paused) {
        attempt += 1
        diag = D.withDecodeAttempt(diag)
        let text: string | null = null
        try {
          text = await within(decoder.decodeFrame(video, attempt), t.decodeTimeoutMs)
          decodeErrorsInRow = 0
          if (view.decoderTrouble) setView({ decoderTrouble: false })
        } catch (error) {
          decodeErrorsInRow += 1
          diag = D.withPatch(diag, { decodeErrors: diag.decodeErrors + 1 })
          if (decodeErrorsInRow === 1) noteError(error)
          // A timeout is the loading wasm itself: say so at once, not after 5 tries.
          const loading = error instanceof DecoderTimeoutError
          if ((loading || decodeErrorsInRow >= DECODER_TROUBLE_AFTER) && !view.decoderTrouble) setView({ decoderTrouble: true })
        }
        if (isStale(myRun)) return
        if (text) emitDecode(text, 'camera')
      }
      await sleep(decodeErrorsInRow > 0 ? Math.max(t.decodeIntervalMs, ERROR_BACKOFF_MS) : t.decodeIntervalMs)
    }
  }

  const onStall = async (myRun: number) => {
    if (isStale(myRun)) return
    diag = D.withPatch(diag, { stalls: diag.stalls + 1 })
    if (reopenUsed) {
      finish(myRun, 'no-frames')
      return
    }
    const next = newRun()
    setView({ ...CAMERA_OFF, status: 'starting' })
    const result = await reopen(next, isIOS ? { deviceId: null } : { deviceId: active?.deviceId ?? null })
    if (result === 'live') enterLive(next)
    else finish(next, result === 'lens-missing' ? 'no-frames' : result)
  }

  const enterLive = (myRun: number) => {
    if (isStale(myRun)) return
    setView({
      status: 'live',
      slowStart: false,
      watchdogFailed: false,
      canSwitch: switchableCameras(cameras, isIOS).length > 1,
      torch: 'unsupported',
      zoom: 'unsupported',
    })
    publish()
    liveCleanups.push(watchFrames(video, { stallMs: t.stallMs, onStall: () => void onStall(myRun) }))
    const capabilityTimer = setTimeout(() => {
      if (isStale(myRun)) return
      const caps = controller.capabilities()
      setView({
        torch: caps.torch ? 'off' : 'unsupported',
        zoom: caps.zoom && caps.zoom.max >= 1.5 ? 'off' : 'unsupported',
      })
    }, t.capabilityDelayMs)
    liveCleanups.push(() => clearTimeout(capabilityTimer))
    void decodeLoop(myRun)
  }

  /** First visit on Android: Chrome chose; move to "camera 0" once if it chose another lens. */
  const correctLens = async (myRun: number, choseByFacingMode: boolean): Promise<OpenResult> => {
    cameras = await controller.listCameras()
    if (isStale(myRun)) return 'cancelled'
    diag = D.withCameras(diag, cameras)
    if (isIOS || !choseByFacingMode || correctionUsed) return 'live'
    const main = findAndroidMainLens(cameras)
    if (!main || !active?.deviceId || main.id === active.deviceId) return 'live'
    correctionUsed = true
    diag = D.withPatch(diag, { lensCorrected: true })
    const result = await openOnce(myRun, { deviceId: main.id }, 'lens-correction')
    if (result === 'live' || result === 'cancelled' || reopenUsed) return result
    return reopen(myRun)
  }

  const start = async (reason: OpenReason): Promise<void> => {
    if (disposed) return
    wanted = true
    resumeOnVisible = false
    const myRun = newRun()
    if (diagClosed) {
      startedAt = now()
      diag = D.startDiagnostics({ userAgent: navigator.userAgent, platform, startedAt: Date.now() })
      diagClosed = false
      lastEmit = null
    }
    reopenUsed = false
    correctionUsed = false
    setView({ ...CAMERA_OFF, status: 'starting', slowStart: false, watchdogFailed: false })
    const slowTimer = setTimeout(() => {
      if (!isStale(myRun) && view.status === 'starting') setView({ slowStart: true })
    }, t.slowStartMs)
    liveCleanups.push(() => clearTimeout(slowTimer))

    const permission = await queryCameraPermission()
    if (isStale(myRun)) return
    diag = D.withPatch(diag, { permissionState: permission })
    if (permission === 'denied') {
      finish(myRun, 'denied')
      return
    }
    cameras = await controller.listCameras()
    if (isStale(myRun)) return
    diag = D.withCameras(diag, cameras)
    const choice = chooseLens(cameras, { isIOS, remembered: readDecodedCamera() })
    diag = D.withChoice(diag, choice)

    let result = await openOnce(myRun, { deviceId: choice.deviceId }, reason)
    if ((result === 'no-frames' || result === 'lens-missing') && !reopenUsed) result = await reopen(myRun)
    if (result === 'live') result = await correctLens(myRun, choice.deviceId === null)
    if (isStale(myRun)) return
    if (result === 'live') {
      stopLive()
      enterLive(myRun)
    } else {
      finish(myRun, result === 'lens-missing' ? 'no-frames' : result)
    }
  }

  const stop = () => {
    wanted = false
    resumeOnVisible = false
    newRun()
    controller.release()
    if (!diagClosed) {
      if (diag.outcome === 'in-progress') diag = D.withOutcome(diag, 'stopped')
      publish()
      diagClosed = true
    }
    setView({ ...CAMERA_OFF, status: 'idle', slowStart: false, watchdogFailed: false, photo: 'idle' })
  }

  const onHidden = () => {
    if (!wanted || disposed || (view.status !== 'live' && view.status !== 'starting')) return
    resumeOnVisible = true
    newRun()
    controller.release()
    diag = D.withPatch(diag, { visibilityReleases: diag.visibilityReleases + 1 })
    setView({ ...CAMERA_OFF, status: 'starting', slowStart: false })
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      onHidden()
      return
    }
    if (resumeOnVisible && wanted && !disposed) void start('resume')
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', onHidden)

  return {
    start: () => start('initial'),
    retry: () => start('retry'),
    stop,

    setPaused(next) {
      paused = next
    },

    async switchCamera() {
      const next = nextCameraId(switchableCameras(cameras, isIOS), active?.deviceId ?? null)
      if (!next || view.status !== 'live') return
      const myRun = newRun()
      diag = D.withPatch(diag, { switches: diag.switches + 1 })
      setView({ ...CAMERA_OFF, status: 'starting' })
      const result = await openOnce(myRun, { deviceId: next }, 'switch')
      if (result === 'live') enterLive(myRun)
      else finish(myRun, result === 'lens-missing' ? 'no-frames' : result)
    },

    async toggleTorch() {
      if (view.torch === 'unsupported') return
      const on = view.torch === 'off'
      if (await controller.setTorch(on)) {
        diag = D.withPatch(diag, { torchUsed: true })
        setView({ torch: on ? 'on' : 'off' })
      }
    },

    async toggleZoom() {
      if (view.zoom === 'unsupported') return
      const on = view.zoom === 'off'
      const range = controller.capabilities().zoom
      if (!range) return
      if (await controller.setZoom(on ? Math.min(ZOOM_LEVEL, range.max) : range.min)) {
        diag = D.withPatch(diag, { zoomUsed: true })
        setView({ zoom: on ? 'on' : 'off' })
      }
    },

    async decodePhoto(file) {
      setView({ photo: 'decoding' })
      let text: string | null = null
      try {
        text = await within(decoder.decodeImage(file), t.photoTimeoutMs)
      } catch (error) {
        noteError(error)
        diag = D.withStillPhoto(diag, false)
        // Always ends in a message, never a spinner that never stops.
        setView({ photo: error instanceof DecoderTimeoutError ? 'timeout' : 'failed' })
        publish()
        return
      }
      diag = D.withStillPhoto(diag, Boolean(text))
      // Read while the screen is still saving the last scan: say so rather
      // than drop it silently (review L6).
      if (text && paused) {
        setView({ photo: 'busy' })
        publish()
        return
      }
      setView({ photo: text ? 'idle' : 'not-found' })
      if (text) emitDecode(text, 'photo')
      else publish()
    },

    dispose() {
      if (disposed) return
      stop()
      disposed = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onHidden)
    },
  }
}
