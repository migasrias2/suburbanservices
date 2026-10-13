import { describe, expect, it } from 'vitest'
import { hoursLabel } from './shiftHours'

describe('hoursLabel', () => {
  it('says the end is missing instead of showing 0h', () => {
    expect(hoursLabel({ clockOutMissing: true, durationHours: 0 })).toBe('End missing')
  })

  it('marks an end estimated from activity as approximate', () => {
    expect(hoursLabel({ clockOutMissing: true, durationHours: 1.3 })).toBe('~1.3h')
  })

  it('shows confirmed hours plainly', () => {
    expect(hoursLabel({ clockOutMissing: false, durationHours: 13.5 })).toBe('13.5h')
  })

  it('shows a dash when there is nothing to show', () => {
    expect(hoursLabel({ clockOutMissing: false, durationHours: null })).toBe('—')
  })
})
