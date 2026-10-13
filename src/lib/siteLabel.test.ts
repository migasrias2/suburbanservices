import { describe, expect, it } from 'vitest'
import { isClockAreaName, pickSiteLabel } from './siteLabel'

describe('isClockAreaName', () => {
  it.each(['Clock In', 'Clock Out', 'clock-in', 'CLOCK_OUT', ' Check In ', 'clockout'])(
    'treats %s as a clock poster',
    (name) => {
      expect(isClockAreaName(name)).toBe(true)
    },
  )

  it.each(['Avtrade Clock-in', 'The Orange Square', 'Clock Tower', '', null, undefined])(
    'does not treat %s as a clock poster',
    (name) => {
      expect(isClockAreaName(name)).toBe(false)
    },
  )
})

describe('pickSiteLabel', () => {
  it('skips a bare "Clock In" area and uses the customer', () => {
    expect(pickSiteLabel({ areaName: 'Clock In', customerName: 'The Orange Square' })).toBe('The Orange Square')
  })

  it('skips a bare "Clock Out" site name too', () => {
    expect(pickSiteLabel({ siteName: 'Clock Out', areaName: 'Clock Out', customerName: 'Metalex' })).toBe('Metalex')
  })

  it('keeps an area name that only contains the words', () => {
    expect(pickSiteLabel({ areaName: 'Avtrade Clock-in', customerName: 'Avtrade' })).toBe('Avtrade Clock-in')
  })

  it('prefers an explicit site name', () => {
    expect(pickSiteLabel({ siteName: 'Unit 2', areaName: 'Kitchen', customerName: 'Adams' })).toBe('Unit 2')
  })

  it('falls back to the id, then to "Site"', () => {
    expect(pickSiteLabel({ areaName: 'Clock In', siteId: 'site-7' })).toBe('site-7')
    expect(pickSiteLabel({ areaName: 'Clock In' })).toBe('Site')
  })
})
