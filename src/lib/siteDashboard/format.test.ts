import { describe, expect, it } from 'vitest'
import { formatClock, formatMinutes, initials, pluralize } from './format'

describe('formatMinutes', () => {
  it.each([
    [0, '0 min'],
    [5, '5 min'],
    [59, '59 min'],
    [60, '1h'],
    [72, '1h 12m'],
    [312, '5h 12m'],
  ])('%s -> %s', (minutes, expected) => {
    expect(formatMinutes(minutes)).toBe(expected)
  })

  it('shows a dash for missing or nonsense values', () => {
    expect(formatMinutes(null)).toBe('—')
    expect(formatMinutes(-3)).toBe('—')
    expect(formatMinutes(Number.NaN)).toBe('—')
  })
})

describe('formatClock', () => {
  it('shows a dash for a missing or unreadable time', () => {
    expect(formatClock(null)).toBe('—')
    expect(formatClock('not a date')).toBe('—')
  })

  it('renders hours and minutes', () => {
    expect(formatClock(new Date(2026, 10, 1, 9, 5).toISOString())).toMatch(/09.05/)
  })
})

describe('small text helpers', () => {
  it('makes initials', () => {
    expect(initials('Toyeeb Atunde')).toBe('TA')
    expect(initials('  ')).toBe('?')
  })

  it('pluralises', () => {
    expect(pluralize(1, 'cleaner')).toBe('1 cleaner')
    expect(pluralize(2, 'cleaner')).toBe('2 cleaners')
  })
})
