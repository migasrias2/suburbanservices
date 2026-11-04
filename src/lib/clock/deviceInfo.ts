import type { ScanDiagnostics } from '@/lib/scanner/scanDiagnostics'

/**
 * The `device` field sent with each clock scan: which client and scanner made
 * it, plus a short summary of the camera session that read the code. It holds
 * no names or ids, only browser and camera facts (the same kind of thing the
 * user agent already says). The server refuses anything over 2 KB, so the
 * summary is cut down to fit, and dropped entirely rather than go over.
 */
export const MAX_DEVICE_BYTES = 1800

const MAX_UA = 160
const MAX_LABEL = 60
const MAX_ERROR_NAMES = 5

export interface ClockDevice {
  client: 'clock_v2'
  scanner: 'v1' | 'v2'
  build?: string
  scan?: Record<string, unknown> & { errors?: string[] }
}

const clip = (value: string | null | undefined, max: number) => (value ? value.slice(0, max) : null)

const summarise = (d: ScanDiagnostics) => ({
  ua: clip(d.userAgent, MAX_UA),
  platform: d.platform,
  permission: d.permissionState,
  cameras: d.cameraCount,
  rung: d.chosenRung,
  lens: clip(d.chosenLabel, MAX_LABEL),
  opens: d.openAttempts.length,
  reopen: d.reopenUsed,
  lensCorrected: d.lensCorrected,
  watchdogTrips: d.watchdogTrips,
  stalls: d.stalls,
  switches: d.switches,
  firstFrameMs: d.timeToFirstFrameMs,
  firstDecodeMs: d.timeToFirstDecodeMs,
  decodeAttempts: d.decodeAttempts,
  engine: d.decoderEngine,
  wasmMs: d.wasmLoadMs,
  photo: d.stillPhoto.used,
  outcome: d.outcome,
  errors: [...new Set(d.errors.map((e) => e.name))].slice(0, MAX_ERROR_NAMES),
})

const byteSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length

declare const __APP_BUILD_ID__: string | undefined

const buildId = (): string | undefined => {
  try {
    return typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__ : undefined
  } catch {
    return undefined
  }
}

export function buildClockDevice(input: { scanner: 'v1' | 'v2'; diagnostics?: ScanDiagnostics | null }): ClockDevice {
  const base: ClockDevice = { client: 'clock_v2', scanner: input.scanner, build: buildId() }
  if (!input.diagnostics) return base
  const withScan = { ...base, scan: summarise(input.diagnostics) }
  return byteSize(withScan) <= MAX_DEVICE_BYTES ? withScan : base
}
