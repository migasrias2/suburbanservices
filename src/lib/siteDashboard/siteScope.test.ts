import { describe, expect, it } from 'vitest'
import { buildNameFilter, buildSiteMatcher, collectMatchNames, pickSelectedSite, titleCaseLabel } from './siteScope'
import { SEAS } from './testFixtures'

describe('buildSiteMatcher — fails closed', () => {
  it('matches nothing at all when the site has no names', () => {
    const matches = buildSiteMatcher([])
    expect(matches('South of England Showground')).toBe(false)
    expect(matches('')).toBe(false)
    expect(matches(null, undefined)).toBe(false)
  })

  it('treats blank names as no names', () => {
    expect(buildSiteMatcher(['  ', null, undefined])('anything')).toBe(false)
  })

  it("never matches another client's name", () => {
    expect(buildSiteMatcher(SEAS.matchNames)('PSM Marine')).toBe(false)
  })

  it('does not match by substring, so "Adams" never sees "Adams Foods"', () => {
    const matches = buildSiteMatcher(['Adams'])
    expect(matches('Adams Foods')).toBe(false)
    expect(matches('adams')).toBe(true)
  })

  it('ignores case and surrounding / repeated whitespace', () => {
    expect(buildSiteMatcher(SEAS.matchNames)('  south of  england showground ')).toBe(true)
  })

  it('matches when any one of several fields is the site', () => {
    expect(buildSiteMatcher(SEAS.matchNames)('Clock In', null, 'SEAS')).toBe(true)
  })
})

describe('buildNameFilter', () => {
  it('returns null instead of an unfiltered query when there are no names', () => {
    expect(buildNameFilter(['customer_name'], [])).toBeNull()
    expect(buildNameFilter([], ['SEAS'])).toBeNull()
  })

  it('builds one quoted ilike per column and name', () => {
    expect(buildNameFilter(['customer_name', 'site_name'], ['SEAS'])).toBe(
      'customer_name.ilike."SEAS",site_name.ilike."SEAS"',
    )
  })

  it('escapes wildcards and quotes so a name cannot widen the filter', () => {
    expect(buildNameFilter(['customer_name'], ['100%_Clean "Co", Ltd'])).toBe(
      'customer_name.ilike."100\\\\%\\\\_Clean \\"Co\\", Ltd"',
    )
  })

  it('collapses duplicate spellings', () => {
    expect(buildNameFilter(['customer_name'], ['SEAS', ' seas '])).toBe('customer_name.ilike."SEAS"')
  })
})

describe('pickSelectedSite', () => {
  const other = { ...SEAS, key: 'cust-other', name: 'Other' }

  it('ignores a ?site= key the login is not allowed, so the URL cannot widen scope', () => {
    expect(pickSelectedSite([SEAS], 'cust-not-mine', true)).toBe(SEAS)
    expect(pickSelectedSite([SEAS], 'cust-not-mine', false)).toBeNull()
  })

  it('honours an allowed key', () => {
    expect(pickSelectedSite([SEAS, other], 'cust-other', true)).toBe(other)
  })

  it('gives a client their first site and leaves admins to choose', () => {
    expect(pickSelectedSite([SEAS, other], null, true)).toBe(SEAS)
    expect(pickSelectedSite([SEAS, other], null, false)).toBeNull()
  })

  it('has nothing to pick from an empty list', () => {
    expect(pickSelectedSite([], 'cust-seas', true)).toBeNull()
  })
})

describe('name helpers', () => {
  it('keeps the first spelling of each name', () => {
    expect(collectMatchNames(['SEAS', 'seas', null, ' South  of England ', ''])).toEqual(['SEAS', 'South of England'])
  })

  it('title-cases a lowercased label for display', () => {
    expect(titleCaseLabel('south of england showground')).toBe('South Of England Showground')
  })
})
