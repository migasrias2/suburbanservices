import { describe, expect, it } from 'vitest'
import { buildAreaCatalog } from './areaCatalog'
import { buildCalls } from './callACleaner'
import { buildCleans } from './cleans'
import { buildOnSite } from './presence'
import { buildTimeline, filterTimeline, timelineAreaOptions } from './timeline'
import {
  CLEANER_ID,
  DAY_START,
  NOW,
  QR_ECO_MENS,
  QR_PAVILION_MENS,
  SEAS,
  SEAS_QR_ROWS,
  assistRow,
  at,
  attendanceRow,
  photoRow,
  selectionRow,
} from './testFixtures'

const catalog = buildAreaCatalog({ qrRows: SEAS_QR_ROWS, areaTaskRows: [], siteNames: SEAS.matchNames })

const buildDay = () => {
  const attendance = [attendanceRow({}), attendanceRow({ id: 2, cleaner_uuid: 'c2', cleaner_name: 'Sam Lee', clock_in: at(8), clock_out: at(11) })]
  const { cleans } = buildCleans(
    [selectionRow({ id: 1, timestamp: at(10, 5) }), selectionRow({ id: 2, qr_code_id: QR_PAVILION_MENS, timestamp: at(12, 30) })],
    [photoRow({ id: 100, photo_timestamp: at(10, 1) })],
    catalog,
  )
  const onSite = buildOnSite(attendance, [{ cleaner_id: CLEANER_ID, timestamp: at(14), scanned_qr_id: QR_ECO_MENS }], cleans, catalog, NOW)
  const calls = buildCalls(
    [assistRow({}), assistRow({ id: 'r', status: 'resolved', qr_code_id: QR_PAVILION_MENS, reported_at: at(13, 22), resolved_at: at(13, 30) })],
    catalog,
    NOW,
    DAY_START,
  )
  return buildTimeline({ attendance, cleans, onSite, calls, dayStart: DAY_START })
}

describe('buildTimeline', () => {
  it('puts arrivals, departures, cleans, live work and calls in one chronological list', () => {
    expect(buildDay().map((item) => [item.kind, item.at])).toEqual([
      ['clock_in', at(8)],
      ['clock_in', at(9, 40)],
      ['clean', at(10, 5)],
      ['clock_out', at(11)],
      ['clean', at(12, 30)],
      ['call', at(13, 22)],
      ['in_progress', at(14)],
      ['call', at(14, 41)],
    ])
  })

  it("leaves out yesterday's clock events", () => {
    const items = buildTimeline({
      attendance: [attendanceRow({ clock_in: at(20, 0, -1), clock_out: at(23, 0, -1) })],
      cleans: [],
      onSite: [],
      calls: { open: [], resolved: [] },
      dayStart: DAY_START,
    })
    expect(items).toEqual([])
  })
})

describe('filterTimeline', () => {
  const items = buildDay()
  const kinds = (filtered: typeof items) => filtered.map((item) => item.kind)

  it('filters to cleans (finished and in progress)', () => {
    expect(kinds(filterTimeline(items, { filter: 'cleans', areaKey: null, order: 'oldest' }))).toEqual(['clean', 'clean', 'in_progress'])
  })

  it('filters to Call a Cleaner requests', () => {
    expect(kinds(filterTimeline(items, { filter: 'calls', areaKey: null, order: 'oldest' }))).toEqual(['call', 'call'])
  })

  it('filters to cleans that have photos', () => {
    const withPhotos = filterTimeline(items, { filter: 'photos', areaKey: null, order: 'oldest' })
    expect(withPhotos.map((item) => item.at)).toEqual([at(10, 5)])
  })

  it('filters by area, dropping clock events that have no area', () => {
    const pavilionMens = filterTimeline(items, { filter: 'all', areaKey: "pavilion men's", order: 'oldest' })
    expect(kinds(pavilionMens)).toEqual(['clean', 'call'])
  })

  it('reverses for newest first', () => {
    const newest = filterTimeline(items, { filter: 'all', areaKey: null, order: 'newest' })
    expect(newest[0].at).toBe(at(14, 41))
    expect(newest[newest.length - 1].at).toBe(at(8))
  })

  it('offers only the areas that appear today, by name', () => {
    expect(timelineAreaOptions(items).map((option) => option.name)).toEqual([
      "Eco Block Men's",
      "Pavilion Ladies'",
      "Pavilion Men's",
    ])
  })
})
