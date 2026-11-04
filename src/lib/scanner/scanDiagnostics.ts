/**
 * Facts about one scan session, as a plain JSON-safe object. The caller sends
 * it to the server later (P3/P4 wiring: `log_scan_session`); nothing here
 * touches the network. Every helper returns a new object.
 *
 * These answer the open questions in research 03 §5: which lens Chrome really
 * opened, whether a black preview is stream churn or eviction (time to first
 * frame per open, watchdog trips), and how often the photo fallback is needed.
 */
import type { LensRung, CameraOption } from './lensChoice'
import type { ScanPlatform } from './platform'

export const MAX_DIAGNOSTIC_ERRORS = 10
const MAX_MESSAGE = 200
const MAX_LABELS = 12

export type ScanOutcome = 'in-progress' | 'decoded' | 'photo' | 'no-picture' | 'denied' | 'no-camera' | 'stopped'

export interface OpenAttempt {
  request: 'device' | 'facing-mode'
  /** Why this open happened. */
  reason?: 'initial' | 'reopen' | 'lens-correction' | 'switch' | 'resume' | 'retry'
  ok: boolean
  /** Whether frames arrived after it opened; undefined when it failed to open. */
  frames?: boolean
  ms: number
  label?: string
  errorName?: string
  width?: number
  height?: number
  zoom?: number
  frameRate?: number
}

export interface ScanDiagnostics {
  startedAt: string
  userAgent: string
  platform: ScanPlatform
  permissionState: PermissionState | 'unknown'
  cameraCount: number
  cameraLabels: string[]
  chosenRung: LensRung | null
  chosenLabel: string | null
  openAttempts: OpenAttempt[]
  reopenUsed: boolean
  lensCorrected: boolean
  watchdogTrips: number
  stalls: number
  visibilityReleases: number
  switches: number
  torchUsed: boolean
  zoomUsed: boolean
  timeToFirstFrameMs: number | null
  decodeAttempts: number
  decodeErrors: number
  decodes: number
  timeToFirstDecodeMs: number | null
  decoderEngine: 'worker' | 'main' | null
  wasmLoadMs: number | null
  stillPhoto: { used: boolean; attempts: number; decoded: boolean }
  outcome: ScanOutcome
  errorCount: number
  errors: { name: string; message: string; atMs: number }[]
}

export const startDiagnostics = (env: {
  userAgent: string
  platform: ScanPlatform
  startedAt: number
}): ScanDiagnostics => ({
  startedAt: new Date(env.startedAt).toISOString(),
  userAgent: env.userAgent,
  platform: env.platform,
  permissionState: 'unknown',
  cameraCount: 0,
  cameraLabels: [],
  chosenRung: null,
  chosenLabel: null,
  openAttempts: [],
  reopenUsed: false,
  lensCorrected: false,
  watchdogTrips: 0,
  stalls: 0,
  visibilityReleases: 0,
  switches: 0,
  torchUsed: false,
  zoomUsed: false,
  timeToFirstFrameMs: null,
  decodeAttempts: 0,
  decodeErrors: 0,
  decodes: 0,
  timeToFirstDecodeMs: null,
  decoderEngine: null,
  wasmLoadMs: null,
  stillPhoto: { used: false, attempts: 0, decoded: false },
  outcome: 'in-progress',
  errorCount: 0,
  errors: [],
})

type Patchable = Omit<ScanDiagnostics, 'openAttempts' | 'errors' | 'cameraLabels' | 'stillPhoto'>

export const withPatch = (d: ScanDiagnostics, patch: Partial<Patchable>): ScanDiagnostics => ({ ...d, ...patch })

export const withCameras = (d: ScanDiagnostics, cameras: CameraOption[]): ScanDiagnostics => ({
  ...d,
  cameraCount: cameras.length,
  cameraLabels: cameras.slice(0, MAX_LABELS).map((camera) => camera.label),
})

export const withChoice = (d: ScanDiagnostics, choice: { rung: LensRung; label: string | null }): ScanDiagnostics => ({
  ...d,
  chosenRung: choice.rung,
  chosenLabel: choice.label,
})

export const withOpenAttempt = (d: ScanDiagnostics, attempt: OpenAttempt): ScanDiagnostics => ({
  ...d,
  openAttempts: [...d.openAttempts, { ...attempt }],
})

/** Marks whether frames arrived for the most recent open. */
export const withFramesResult = (d: ScanDiagnostics, frames: boolean): ScanDiagnostics => {
  if (d.openAttempts.length === 0) return d
  const last = d.openAttempts[d.openAttempts.length - 1]
  return {
    ...d,
    openAttempts: [...d.openAttempts.slice(0, -1), { ...last, frames }],
    watchdogTrips: frames ? d.watchdogTrips : d.watchdogTrips + 1,
  }
}

export const withFirstFrame = (d: ScanDiagnostics, ms: number): ScanDiagnostics =>
  d.timeToFirstFrameMs === null ? { ...d, timeToFirstFrameMs: Math.round(ms) } : d

export const withDecodeAttempt = (d: ScanDiagnostics): ScanDiagnostics => ({ ...d, decodeAttempts: d.decodeAttempts + 1 })

export const withDecode = (d: ScanDiagnostics, ms: number): ScanDiagnostics => ({
  ...d,
  decodes: d.decodes + 1,
  timeToFirstDecodeMs: d.timeToFirstDecodeMs ?? Math.round(ms),
})

export const withStillPhoto = (d: ScanDiagnostics, decoded: boolean): ScanDiagnostics => ({
  ...d,
  stillPhoto: {
    used: true,
    attempts: d.stillPhoto.attempts + 1,
    decoded: d.stillPhoto.decoded || decoded,
  },
})

export const withOutcome = (d: ScanDiagnostics, outcome: ScanOutcome): ScanDiagnostics => ({ ...d, outcome })

export const withError = (d: ScanDiagnostics, name: string, message: string, atMs: number): ScanDiagnostics => {
  const errorCount = d.errorCount + 1
  if (d.errors.length >= MAX_DIAGNOSTIC_ERRORS) return { ...d, errorCount }
  return {
    ...d,
    errorCount,
    errors: [...d.errors, { name: name || 'Error', message: String(message).slice(0, MAX_MESSAGE), atMs: Math.round(atMs) }],
  }
}
