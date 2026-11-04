import { describe, it, expect } from 'vitest'
import {
  MAX_DIAGNOSTIC_ERRORS,
  startDiagnostics,
  withCameras,
  withChoice,
  withDecode,
  withDecodeAttempt,
  withError,
  withFirstFrame,
  withOpenAttempt,
  withOutcome,
  withPatch,
  withStillPhoto,
} from './scanDiagnostics'

const base = () =>
  startDiagnostics({ userAgent: 'UA/1', platform: 'android', startedAt: Date.UTC(2026, 10, 4, 9, 0, 0) })

describe('scanDiagnostics', () => {
  it('starts as a plain, serialisable object', () => {
    const d = base()
    expect(d).toMatchObject({
      startedAt: '2026-11-04T09:00:00.000Z',
      userAgent: 'UA/1',
      platform: 'android',
      cameraCount: 0,
      cameraLabels: [],
      openAttempts: [],
      reopenUsed: false,
      decodeAttempts: 0,
      timeToFirstFrameMs: null,
      timeToFirstDecodeMs: null,
      stillPhoto: { used: false, attempts: 0, decoded: false },
      outcome: 'in-progress',
      errors: [],
    })
    expect(JSON.parse(JSON.stringify(d))).toEqual(d)
  })

  it('never changes the object it was given', () => {
    const d = base()
    const frozen = JSON.stringify(d)
    withCameras(d, [{ id: 'a', label: 'camera 0, facing back' }])
    withChoice(d, { rung: 'android-main', label: 'camera 0, facing back' })
    withOpenAttempt(d, { request: 'device', ok: true, ms: 120 })
    withFirstFrame(d, 300)
    withDecodeAttempt(d)
    withDecode(d, 900)
    withError(d, 'NotReadableError', 'busy', 10)
    withStillPhoto(d, true)
    withOutcome(d, 'decoded')
    withPatch(d, { reopenUsed: true })
    expect(JSON.stringify(d)).toBe(frozen)
  })

  it('records cameras, the choice and each open attempt', () => {
    let d = withCameras(base(), [
      { id: 'a', label: 'camera 0, facing back' },
      { id: 'b', label: 'camera 1, facing front' },
    ])
    d = withChoice(d, { rung: 'android-main', label: 'camera 0, facing back' })
    d = withOpenAttempt(d, { request: 'device', ok: false, ms: 40, errorName: 'NotReadableError' })
    d = withOpenAttempt(d, { request: 'facing-mode', ok: true, ms: 220, label: 'camera 0, facing back' })
    expect(d.cameraCount).toBe(2)
    expect(d.cameraLabels).toEqual(['camera 0, facing back', 'camera 1, facing front'])
    expect(d.chosenRung).toBe('android-main')
    expect(d.openAttempts).toHaveLength(2)
    expect(d.openAttempts[0]).toMatchObject({ ok: false, errorName: 'NotReadableError' })
  })

  it('keeps the first time to first frame and first decode', () => {
    let d = withFirstFrame(base(), 300)
    d = withFirstFrame(d, 999)
    d = withDecode(withDecode(d, 1200), 5000)
    expect(d.timeToFirstFrameMs).toBe(300)
    expect(d.timeToFirstDecodeMs).toBe(1200)
    expect(d.decodes).toBe(2)
  })

  it('counts decode attempts and still photos', () => {
    let d = withDecodeAttempt(withDecodeAttempt(base()))
    d = withStillPhoto(withStillPhoto(d, false), true)
    expect(d.decodeAttempts).toBe(2)
    expect(d.stillPhoto).toEqual({ used: true, attempts: 2, decoded: true })
  })

  it(`keeps at most ${MAX_DIAGNOSTIC_ERRORS} errors, and short messages`, () => {
    let d = base()
    for (let i = 0; i < MAX_DIAGNOSTIC_ERRORS + 5; i += 1) d = withError(d, 'E', 'x'.repeat(500), i)
    expect(d.errors).toHaveLength(MAX_DIAGNOSTIC_ERRORS)
    expect(d.errors[0].message.length).toBeLessThanOrEqual(200)
    expect(d.errorCount).toBe(MAX_DIAGNOSTIC_ERRORS + 5)
  })
})
