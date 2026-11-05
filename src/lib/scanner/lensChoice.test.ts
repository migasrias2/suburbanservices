import { describe, it, expect, beforeEach } from 'vitest'
import { installTestLocalStorage } from '@/test/localStorage'
import {
  chooseLens,
  DECODED_CAMERA_STORAGE_KEY,
  nextCameraId,
  pickScanCamera,
  readDecodedCamera,
  rememberDecodedCamera,
  switchableCameras,
} from './lensChoice'
import { detectPlatform } from './platform'

const samsungNew = [
  { id: 'f1', label: 'camera 1, facing front' },
  { id: 'b2', label: 'camera 2, facing back' },
  { id: 'b0', label: 'camera 0, facing back' },
  { id: 'b3', label: 'camera 3, facing back' },
]
const samsungOld = [
  { id: 'f1', label: 'camera2 1, facing front' },
  { id: 'b2', label: 'camera2 2, facing back' },
  { id: 'b0', label: 'camera2 0, facing back' },
]
const iphone = [
  { id: 'i-front', label: 'Front Camera' },
  { id: 'i-back', label: 'Back Camera' },
  { id: 'i-wide', label: 'Back Ultra Wide Camera' },
  { id: 'i-triple', label: 'Back Triple Camera' },
]
const firstRun = [
  { id: 'a', label: '' },
  { id: 'b', label: '' },
]

describe('chooseLens', () => {
  it('picks "camera 0, facing back" on current Chrome for Android', () => {
    expect(chooseLens(samsungNew, { isIOS: false })).toEqual({
      deviceId: 'b0',
      rung: 'android-main',
      label: 'camera 0, facing back',
    })
  })

  it('picks "camera2 0, facing back" on older Chrome and lagging Chromium forks', () => {
    expect(chooseLens(samsungOld, { isIOS: false })).toMatchObject({ deviceId: 'b0', rung: 'android-main' })
  })

  it('does not take "camera 10, facing back" for the main lens', () => {
    const cams = [{ id: 'b10', label: 'camera 10, facing back' }]
    expect(chooseLens(cams, { isIOS: false }).rung).not.toBe('android-main')
  })

  it('uses only facingMode on iPhone, whatever the labels or memory say', () => {
    expect(chooseLens(iphone, { isIOS: true, remembered: 'i-back' })).toEqual({
      deviceId: null,
      rung: 'facing-mode',
      label: null,
    })
  })

  it('lets the browser choose when labels are not readable yet (first visit)', () => {
    expect(chooseLens(firstRun, { isIOS: false })).toEqual({ deviceId: null, rung: 'facing-mode', label: null })
  })

  it('prefers a camera remembered because it decoded a code, while it still exists', () => {
    expect(chooseLens(samsungNew, { isIOS: false, remembered: 'b2' })).toMatchObject({
      deviceId: 'b2',
      rung: 'remembered',
    })
    expect(chooseLens(samsungNew, { isIOS: false, remembered: 'gone' })).toMatchObject({
      deviceId: 'b0',
      rung: 'android-main',
    })
  })

  it('falls back to a plain back camera on other platforms', () => {
    const cams = [
      { id: 'u', label: 'Front webcam' },
      { id: 'w', label: 'Back ultra wide' },
      { id: 'r', label: 'Rear camera' },
    ]
    expect(chooseLens(cams, { isIOS: false })).toMatchObject({ deviceId: 'r', rung: 'back-label' })
  })
})

describe('switchableCameras', () => {
  it('offers only back cameras on Android', () => {
    expect(switchableCameras(samsungNew, false).map((c) => c.id)).toEqual(['b2', 'b0', 'b3'])
  })

  it('offers nothing on iPhone (the virtual camera switches lenses itself)', () => {
    expect(switchableCameras(iphone, true)).toEqual([])
  })

  it('offers nothing while labels are unreadable', () => {
    expect(switchableCameras(firstRun, false)).toEqual([])
  })

  it('offers every unlabelled-but-not-front camera on desktops', () => {
    const cams = [
      { id: 'x', label: 'Integrated Webcam' },
      { id: 'y', label: 'USB Camera' },
    ]
    expect(switchableCameras(cams, false).map((c) => c.id)).toEqual(['x', 'y'])
  })
})

describe('the decoded-camera memory', () => {
  beforeEach(() => {
    installTestLocalStorage()
  })

  it('round-trips through its own storage key, not the old scanner one', () => {
    expect(readDecodedCamera()).toBeNull()
    rememberDecodedCamera('b0')
    expect(readDecodedCamera()).toBe('b0')
    expect(localStorage.getItem(DECODED_CAMERA_STORAGE_KEY)).toBe('b0')
    expect(DECODED_CAMERA_STORAGE_KEY).not.toBe('qrScanCameraId')
  })
})

describe('detectPlatform', () => {
  it('spots iPhones, iPads posing as Macs, Android and the rest', () => {
    expect(
      detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', 5),
    ).toBe('ios')
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 5)).toBe(
      'ios',
    )
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 0)).toBe(
      'other',
    )
    expect(
      detectPlatform('Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36', 5),
    ).toBe('android')
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0', 0)).toBe('other')
  })
})

// Labels as Chrome on Android reports them (Samsung Galaxy S22, after camera
// permission is granted). Four back lenses; only camera2 0 is the main one.
const samsungS22 = [
  { id: 'front', label: 'camera2 1, facing front' },
  { id: 'main', label: 'camera2 0, facing back' },
  { id: 'ultrawide', label: 'camera2 2, facing back' },
  { id: 'tele', label: 'camera2 3, facing back' },
]

describe('pickScanCamera', () => {
  it("picks the Android phone's main back lens, not the ultra-wide that cannot focus close", () => {
    expect(pickScanCamera(samsungS22)).toBe('main')
  })

  it('picks the main lens whatever order the browser lists them in', () => {
    expect(pickScanCamera([...samsungS22].reverse())).toBe('main')
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
    expect(nextCameraId(samsungS22, 'main')).toBe('ultrawide')
    expect(nextCameraId(samsungS22, 'tele')).toBe('front')
  })

  it('starts from the first camera when the current one is unknown', () => {
    expect(nextCameraId(samsungS22, null)).toBe('front')
  })

  it('has nothing to switch to with one camera or none', () => {
    expect(nextCameraId([samsungS22[1]], 'main')).toBeNull()
    expect(nextCameraId([], null)).toBeNull()
  })
})
