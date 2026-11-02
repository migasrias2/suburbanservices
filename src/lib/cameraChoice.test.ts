import { describe, expect, it } from 'vitest'
import { pickScanCamera, nextCameraId } from './cameraChoice'

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
