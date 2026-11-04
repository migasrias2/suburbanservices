import { describe, expect, it } from 'vitest'
import { buildSiteSnapshot, scopeRawData, type SiteRawData } from './snapshot'
import {
  CLEANER_ID,
  NOW,
  QR_ECO_MENS,
  QR_OTHER_CLIENT,
  QR_PAVILION_LADIES,
  SEAS,
  SEAS_QR_ROWS,
  assistRow,
  at,
  attendanceRow,
  photoRow,
  qrRow,
  selectionRow,
} from './testFixtures'

const OTHER = 'PSM Marine'

const raw = (overrides: Partial<SiteRawData> = {}): SiteRawData => ({
  qrRows: [...SEAS_QR_ROWS, qrRow({ qr_code_id: QR_OTHER_CLIENT, customer_name: OTHER, building_area: 'Workshop' })],
  areaTaskRows: [],
  attendance: [
    attendanceRow({}),
    attendanceRow({ id: 9, cleaner_uuid: 'psm-cleaner', cleaner_name: 'Other Person', customer_name: OTHER, site_name: OTHER }),
  ],
  selections: [
    selectionRow({ id: 1, completed_tasks: null }),
    selectionRow({ id: 2, timestamp: at(11) }),
    selectionRow({ id: 3, qr_code_id: QR_OTHER_CLIENT, timestamp: at(11, 30) }),
  ],
  photoRows: [photoRow({ id: 100, photo_timestamp: at(10, 59) }), photoRow({ id: 900, qr_code_id: QR_OTHER_CLIENT, photo_timestamp: at(11, 29) })],
  scans: [{ cleaner_id: CLEANER_ID, timestamp: at(14), scanned_qr_id: QR_ECO_MENS }],
  assists: [
    assistRow({}),
    assistRow({ id: 'r', status: 'resolved', reported_at: at(13, 22), resolved_at: at(13, 30), resolved_by_name: 'Toyeeb' }),
    assistRow({ id: 'other', customer_name: OTHER, qr_code_id: QR_OTHER_CLIENT }),
  ],
  ...overrides,
})

describe('scopeRawData — the second lock', () => {
  it("drops every row that belongs to another client, even if a query let it through", () => {
    const scoped = scopeRawData(SEAS, raw())
    expect(scoped.qrRows.some((row) => row.customer_name === OTHER)).toBe(false)
    expect(scoped.attendance.map((row) => row.id)).toEqual([1])
    expect(scoped.selections.map((row) => row.id)).toEqual([1, 2])
    expect(scoped.photoRows.map((row) => row.id)).toEqual([100])
    expect(scoped.assists.map((row) => row.id)).toEqual(['req-1', 'r'])
  })

  it('returns nothing at all for a site with no names', () => {
    const scoped = scopeRawData({ ...SEAS, matchNames: [] }, raw())
    expect(scoped.qrRows).toEqual([])
    expect(scoped.attendance).toEqual([])
    expect(scoped.selections).toEqual([])
    expect(scoped.photoRows).toEqual([])
    expect(scoped.assists).toEqual([])
  })
})

describe('buildSiteSnapshot', () => {
  const snapshot = buildSiteSnapshot(SEAS, raw(), NOW)

  it('counts cleans whether or not they have photos', () => {
    expect(snapshot.kpis).toEqual({
      onSiteCount: 1,
      cleansCompleted: 2,
      inProgress: 1,
      photos: 1,
      openCalls: 1,
      resolvedToday: 1,
      avgResponseMinutes: 8,
    })
  })

  it("shows only this site's people, areas and requests", () => {
    expect(snapshot.onSite.map((person) => person.name)).toEqual(['Toyeeb Atunde'])
    expect(snapshot.coverage.items.map((item) => item.name)).not.toContain('Workshop')
    expect(snapshot.calls.open.map((call) => call.id)).toEqual(['req-1'])
  })

  it('reports the live clean in the people list, the coverage grid and the timeline', () => {
    expect(snapshot.onSite[0].activity).toMatchObject({ kind: 'cleaning', areaName: "Eco Block Men's" })
    expect(snapshot.coverage.items.find((item) => item.name === "Eco Block Men's")?.status).toBe('in_progress')
    expect(snapshot.timeline.some((item) => item.kind === 'in_progress')).toBe(true)
  })

  it('is empty, not someone else’s, when the site has no names', () => {
    const empty = buildSiteSnapshot({ ...SEAS, matchNames: [] }, raw(), NOW)
    expect(empty.timeline).toEqual([])
    expect(empty.onSite).toEqual([])
    expect(empty.photos).toEqual([])
    expect(empty.coverage.total).toBe(0)
    expect(empty.kpis.cleansCompleted).toBe(0)
  })

  it('never shows a QR id anywhere a client reads an area name', () => {
    const names = [
      ...snapshot.timeline.flatMap((item) =>
        item.kind === 'clean' ? [item.clean.areaName] : item.kind === 'call' ? [item.call.areaName] : item.kind === 'in_progress' ? [item.areaName] : [],
      ),
      ...snapshot.coverage.items.map((item) => item.name),
      ...snapshot.photos.map((photo) => photo.areaName),
      ...snapshot.areaOptions.map((option) => option.name),
    ]
    expect(names.length).toBeGreaterThan(0)
    names.forEach((name) => {
      expect(name).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i)
      expect(name).not.toBe(QR_PAVILION_LADIES)
    })
  })
})

describe('buildSiteSnapshot across midnight', () => {
  // 00:30 on 2 Nov. The shift started at 22:00 on 1 Nov; at 23:50 the cleaner
  // scanned Eco Block Men's and at 23:58 submitted it.
  const justAfterMidnight = new Date(Date.UTC(2026, 10, 2, 0, 30))
  const snapshot = buildSiteSnapshot(
    SEAS,
    {
      qrRows: SEAS_QR_ROWS,
      areaTaskRows: [],
      attendance: [attendanceRow({ clock_in: at(22, 0) })],
      selections: [selectionRow({ qr_code_id: QR_ECO_MENS, timestamp: at(23, 58) })],
      photoRows: [photoRow({ qr_code_id: QR_ECO_MENS, photo_timestamp: at(23, 56) })],
      scans: [{ cleaner_id: CLEANER_ID, timestamp: at(23, 50), scanned_qr_id: QR_ECO_MENS }],
      assists: [],
    },
    justAfterMidnight,
  )

  it("does not claim yesterday's finished area is still being cleaned", () => {
    expect(snapshot.onSite[0].activity).toMatchObject({ kind: 'last_cleaned', areaName: "Eco Block Men's", at: at(23, 58) })
    expect(snapshot.kpis.inProgress).toBe(0)
  })

  it("counts yesterday's clean and photo in none of today's numbers", () => {
    expect(snapshot.kpis.cleansCompleted).toBe(0)
    expect(snapshot.kpis.photos).toBe(0)
    expect(snapshot.coverage.done).toBe(0)
    expect(snapshot.timeline.some((item) => item.kind === 'clean')).toBe(false)
    expect(snapshot.dayStart).toBe(new Date(Date.UTC(2026, 10, 2)).toISOString())
  })
})
