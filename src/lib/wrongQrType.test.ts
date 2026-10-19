import { describe, expect, it } from 'vitest'
import { describeWrongQrType, isClockCode } from './wrongQrType'

describe('isClockCode', () => {
  it('is true only for clock-in and clock-out codes', () => {
    expect(isClockCode('CLOCK_IN')).toBe(true)
    expect(isClockCode('CLOCK_OUT')).toBe(true)
    expect(isClockCode('AREA')).toBe(false)
    expect(isClockCode(null)).toBe(false)
  })
})

describe('describeWrongQrType', () => {
  it('tells someone on the clock-in screen that they scanned the clock-out code', () => {
    expect(describeWrongQrType('CLOCK_OUT', ['CLOCK_IN'])).toBe(
      'That is the Clock Out code. This screen needs the Clock In code.',
    )
  })

  it('tells someone on the area screen that they scanned the clock-in code', () => {
    expect(describeWrongQrType('CLOCK_IN', ['AREA'])).toBe(
      'That is the Clock In code. This screen needs an area code.',
    )
  })

  it('names every allowed type when there are several', () => {
    expect(describeWrongQrType('FEEDBACK', ['CLOCK_IN', 'AREA'])).toBe(
      'That is a feedback code. This screen needs the Clock In code or an area code.',
    )
  })

  it('still says something useful when the scanned type is unknown', () => {
    expect(describeWrongQrType(null, ['CLOCK_OUT'])).toBe(
      'That code is not recognised. This screen needs the Clock Out code.',
    )
  })
})
