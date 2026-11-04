import { describe, it, expect, beforeEach } from 'vitest'
import { installTestLocalStorage } from '@/test/localStorage'
import {
  chooseLens,
  DECODED_CAMERA_STORAGE_KEY,
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
