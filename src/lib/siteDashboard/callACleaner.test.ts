import { describe, expect, it } from 'vitest'
import { buildAreaCatalog } from './areaCatalog'
import { averageResponseMinutes, buildCalls, describeOpenCall, describeResolvedCall } from './callACleaner'
import { DAY_START, NOW, QR_PAVILION_MENS, SEAS, SEAS_QR_ROWS, assistRow, at } from './testFixtures'

const catalog = buildAreaCatalog({ qrRows: SEAS_QR_ROWS, areaTaskRows: [], siteNames: SEAS.matchNames })

describe('buildCalls', () => {
  it('shows an open request with how long it has been waiting', () => {
    const { open, resolved } = buildCalls([assistRow({})], catalog, NOW, DAY_START)
    expect(resolved).toEqual([])
    expect(open[0]).toMatchObject({ areaName: "Pavilion Ladies'", waitingMinutes: 11, issue: 'Toilet roll has run out' })
    expect(describeOpenCall(open[0])).toBe('Open · waiting 11 min')
  })

  it('shows who resolved a request and how long it took', () => {
    const { resolved } = buildCalls(
      [assistRow({ status: 'resolved', reported_at: at(13, 22), resolved_at: at(13, 30), resolved_by_name: 'Toyeeb' })],
      catalog,
      NOW,
      DAY_START,
    )
    expect(resolved[0]).toMatchObject({ resolutionMinutes: 8, resolvedByName: 'Toyeeb', waitingMinutes: null })
    expect(describeResolvedCall(resolved[0])).toBe('Resolved in 8 min by Toyeeb')
  })

  it('puts the longest-waiting open request first and the latest resolution first', () => {
    const { open, resolved } = buildCalls(
      [
        assistRow({ id: 'late', reported_at: at(14, 40) }),
        assistRow({ id: 'early', status: 'escalated', reported_at: at(14, 0) }),
        assistRow({ id: 'r1', status: 'resolved', reported_at: at(9), resolved_at: at(9, 10) }),
        assistRow({ id: 'r2', status: 'resolved', reported_at: at(11), resolved_at: at(11, 6) }),
      ],
      catalog,
      NOW,
      DAY_START,
    )
    expect(open.map((call) => call.id)).toEqual(['early', 'late'])
    expect(resolved.map((call) => call.id)).toEqual(['r2', 'r1'])
  })

  it("keeps yesterday's still-open request but drops yesterday's resolutions and cancellations", () => {
    const { open, resolved } = buildCalls(
      [
        assistRow({ id: 'old-open', reported_at: at(22, 0, -1) }),
        assistRow({ id: 'old-done', status: 'resolved', reported_at: at(20, 0, -1), resolved_at: at(20, 30, -1) }),
        assistRow({ id: 'cancelled', status: 'cancelled' }),
      ],
      catalog,
      NOW,
      DAY_START,
    )
    expect(open.map((call) => call.id)).toEqual(['old-open'])
    expect(resolved).toEqual([])
  })

  it('names the area from the QR code, then the location label, never a code', () => {
    const { open } = buildCalls(
      [
        assistRow({ id: 'by-qr', qr_code_id: QR_PAVILION_MENS, location_label: 'PAV_MENS' }),
        assistRow({ id: 'by-label', qr_code_id: null, location_label: 'Rank Lodge' }),
        assistRow({ id: 'code-only', qr_code_id: 'nope', location_label: 'SEAS-RANK-01' }),
      ],
      catalog,
      NOW,
      DAY_START,
    )
    expect(Object.fromEntries(open.map((call) => [call.id, call.areaName]))).toEqual({
      'by-qr': "Pavilion Men's",
      'by-label': 'Rank Lodge',
      'code-only': null,
    })
  })

  it('says who is on the way once a cleaner has accepted', () => {
    const { open } = buildCalls([assistRow({ status: 'accepted', accepted_by_name: 'Toyeeb' })], catalog, NOW, DAY_START)
    expect(describeOpenCall(open[0])).toBe('Toyeeb on the way · waiting 11 min')
  })

  it('leaves out who resolved it when nobody was recorded', () => {
    const { resolved } = buildCalls(
      [assistRow({ status: 'resolved', reported_at: at(9), resolved_at: at(10, 15) })],
      catalog,
      NOW,
      DAY_START,
    )
    expect(describeResolvedCall(resolved[0])).toBe('Resolved in 1h 15m')
  })

  it('does not double-count a request returned by both queries', () => {
    const { open } = buildCalls([assistRow({}), assistRow({})], catalog, NOW, DAY_START)
    expect(open).toHaveLength(1)
  })
})

describe('averageResponseMinutes', () => {
  it('averages report-to-resolution time over resolved requests', () => {
    const { resolved } = buildCalls(
      [
        assistRow({ id: 'a', status: 'resolved', reported_at: at(11, 5), resolved_at: at(11, 11) }),
        assistRow({ id: 'b', status: 'resolved', reported_at: at(13, 22), resolved_at: at(13, 30) }),
      ],
      catalog,
      NOW,
      DAY_START,
    )
    expect(averageResponseMinutes(resolved)).toBe(7)
  })

  it('is null, not zero, when nothing has been resolved', () => {
    expect(averageResponseMinutes([])).toBeNull()
  })
})
