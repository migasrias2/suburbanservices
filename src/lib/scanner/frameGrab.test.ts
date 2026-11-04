import { describe, it, expect } from 'vitest'
import { centreCropRect, fitWithin, frameCropRect, PHOTO_MAX_SIDE } from './frameGrab'

describe('fitWithin', () => {
  it('shrinks a 12 MP phone photo to a 2000 px long side, keeping its shape', () => {
    expect(fitWithin(4000, 3000, PHOTO_MAX_SIDE)).toEqual({ width: 2000, height: 1500 })
    expect(fitWithin(3024, 4032, PHOTO_MAX_SIDE)).toEqual({ width: 1500, height: 2000 })
  })

  it('never enlarges a small image', () => {
    expect(fitWithin(640, 480, PHOTO_MAX_SIDE)).toEqual({ width: 640, height: 480 })
  })

  it('never returns a zero size', () => {
    expect(fitWithin(5000, 1, 100)).toEqual({ width: 100, height: 1 })
  })
})

describe('centreCropRect', () => {
  it('takes the middle square of the given fraction of the short side', () => {
    expect(centreCropRect(1280, 720, 0.5)).toEqual({ sx: 460, sy: 180, sw: 360, sh: 360 })
  })
})

describe('frameCropRect', () => {
  it('reads the centre ~70 % square at native resolution on most attempts', () => {
    const rect = frameCropRect(1280, 720, 1)
    expect(rect).toEqual({ sx: 388, sy: 108, sw: 504, sh: 504, dw: 504, dh: 504 })
  })

  it('caps the crop at 1000 px for big streams', () => {
    const rect = frameCropRect(3840, 2160, 1)
    expect(rect.sw).toBe(1512)
    expect(rect.dw).toBe(1000)
    expect(rect.dh).toBe(1000)
  })

  it('reads the whole frame every third attempt, capped at 1280 px', () => {
    expect(frameCropRect(1280, 720, 3)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720, dw: 1280, dh: 720 })
    expect(frameCropRect(1920, 1080, 6)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080, dw: 1280, dh: 720 })
  })
})
