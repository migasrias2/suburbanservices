import { describe, expect, it } from 'vitest'
import { startDiagnostics, withCameras, withChoice, withError, withOpenAttempt, withPatch } from '@/lib/scanner/scanDiagnostics'
import { buildClockDevice, MAX_DEVICE_BYTES } from './deviceInfo'

const UA = 'Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'

const busyDiagnostics = () => {
  let d = startDiagnostics({ userAgent: UA, platform: 'android', startedAt: Date.parse('2026-11-04T07:00:00Z') })
  d = withCameras(d, Array.from({ length: 12 }, (_, i) => ({ id: `id-${i}`, label: `camera ${i}, facing back` })))
  d = withChoice(d, { rung: 'android-main', label: 'camera 0, facing back' })
  for (let i = 0; i < 3; i += 1) d = withOpenAttempt(d, { request: 'device', ok: true, frames: true, ms: 420, label: 'camera 0, facing back' })
  for (let i = 0; i < 10; i += 1) d = withError(d, 'NotReadableError', 'x'.repeat(200), i)
  return withPatch(d, { timeToFirstFrameMs: 380, timeToFirstDecodeMs: 1200, decodeAttempts: 9, decodes: 1, decoderEngine: 'worker', wasmLoadMs: 640, outcome: 'decoded' })
}

describe('buildClockDevice', () => {
  it('says which client and scanner made the scan, even without diagnostics', () => {
    expect(buildClockDevice()).toMatchObject({ scanner: 'v2', client: 'clock_v2' })
  })

  it('keeps a compact summary of the scan session', () => {
    const device = buildClockDevice({ diagnostics: busyDiagnostics() })
    expect(device.scan).toMatchObject({
      platform: 'android',
      cameras: 12,
      lens: 'camera 0, facing back',
      opens: 3,
      firstFrameMs: 380,
      firstDecodeMs: 1200,
      engine: 'worker',
      wasmMs: 640,
      outcome: 'decoded',
    })
    // Error names only, no free text.
    expect(device.scan?.errors).toEqual(['NotReadableError'])
  })

  it('stays under the 2 KB the server accepts', () => {
    const device = buildClockDevice({ diagnostics: busyDiagnostics() })
    expect(new TextEncoder().encode(JSON.stringify(device)).length).toBeLessThanOrEqual(MAX_DEVICE_BYTES)
    expect(MAX_DEVICE_BYTES).toBeLessThan(2048)
  })

  it('drops the scan summary rather than go over the limit', () => {
    const huge = withPatch(busyDiagnostics(), { userAgent: 'U'.repeat(5000) })
    const device = buildClockDevice({ diagnostics: huge })
    expect(new TextEncoder().encode(JSON.stringify(device)).length).toBeLessThanOrEqual(MAX_DEVICE_BYTES)
  })
})
