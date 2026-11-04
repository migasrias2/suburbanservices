import { describe, expect, it } from 'vitest'
import { formatClock, formatClockWithDay, formatMinutes, initials, pluralize, startOfSiteDay } from './format'

const utc = (iso: string) => new Date(iso)

describe('startOfSiteDay — London midnight, whatever the browser zone', () => {
  it('is UTC midnight in winter (GMT)', () => {
    expect(startOfSiteDay(utc('2026-11-01T14:52:00Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })

  it('is 23:00 UTC the evening before in summer (BST)', () => {
    expect(startOfSiteDay(utc('2026-07-01T10:00:00Z')).toISOString()).toBe('2026-06-30T23:00:00.000Z')
  })

  it('treats 23:30 UTC in summer as already the next London day', () => {
    expect(startOfSiteDay(utc('2026-07-01T23:30:00Z')).toISOString()).toBe('2026-07-01T23:00:00.000Z')
  })

  it('handles the day the clocks go forward (29 Mar 2026)', () => {
    expect(startOfSiteDay(utc('2026-03-29T12:00:00Z')).toISOString()).toBe('2026-03-29T00:00:00.000Z')
  })

  it('handles the day the clocks go back (25 Oct 2026)', () => {
    expect(startOfSiteDay(utc('2026-10-25T12:00:00Z')).toISOString()).toBe('2026-10-24T23:00:00.000Z')
  })
})

describe('formatClock', () => {
  it('shows London time on a 24-hour clock', () => {
    expect(formatClock('2026-11-01T09:05:00Z')).toBe('09:05')
    expect(formatClock('2026-07-01T13:05:00Z')).toBe('14:05')
  })

  it('shows a dash for a missing or unreadable time', () => {
    expect(formatClock(null)).toBe('—')
    expect(formatClock('not a date')).toBe('—')
  })
})

describe('formatClockWithDay', () => {
  const dayStart = utc('2026-11-02T00:00:00Z')

  it('shows just the time for today', () => {
    expect(formatClockWithDay('2026-11-02T08:15:00Z', dayStart)).toBe('08:15')
  })

  it('adds the date to anything from before today', () => {
    expect(formatClockWithDay('2026-11-01T22:10:00Z', dayStart)).toBe('1 Nov 22:10')
  })
})

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
