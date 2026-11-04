import { describe, expect, it } from 'vitest'
import { buildAreaCatalog } from './areaCatalog'
import { buildCleans } from './cleans'
import { buildOnSite } from './presence'
import {
  CLEANER_ID,
  NOW,
  QR_CLOCK_IN,
  QR_ECO_MENS,
  QR_OTHER_CLIENT,
  QR_PAVILION_LADIES,
  SEAS,
  SEAS_QR_ROWS,
  at,
  attendanceRow,
  selectionRow,
} from './testFixtures'

const catalog = buildAreaCatalog({ qrRows: SEAS_QR_ROWS, areaTaskRows: [], siteNames: SEAS.matchNames })
const scan = (qr: string | null, timestamp: string, cleanerId = CLEANER_ID) => ({
  cleaner_id: cleanerId,
  timestamp,
  scanned_qr_id: qr,
})

describe('buildOnSite', () => {
  it('lists open shifts with clock-in time and time on site', () => {
    const [person] = buildOnSite([attendanceRow({})], [], [], catalog, NOW)
    expect(person).toMatchObject({ name: 'Toyeeb Atunde', clockIn: at(9, 40), minutesOnSite: 312, activity: null })
  })

  it('leaves out people who have clocked out', () => {
    expect(buildOnSite([attendanceRow({ clock_out: at(12) })], [], [], catalog, NOW)).toEqual([])
  })

  it('treats an open shift older than 12 hours as a forgotten clock-out, not presence', () => {
    expect(buildOnSite([attendanceRow({ clock_in: at(2, 0) })], [], [], catalog, NOW)).toEqual([])
    expect(buildOnSite([attendanceRow({ clock_in: at(3, 0) })], [], [], catalog, NOW)).toHaveLength(1)
  })

  it('shows each person once, from their latest clock-in', () => {
    const onSite = buildOnSite(
      [attendanceRow({ id: 1, clock_in: at(7) }), attendanceRow({ id: 2, clock_in: at(9, 40) })],
      [],
      [],
      catalog,
      NOW,
    )
    expect(onSite).toHaveLength(1)
    expect(onSite[0].clockIn).toBe(at(9, 40))
  })

  it('stops calling a scan "in progress" after an hour with no submit', () => {
    const { cleans } = buildCleans([selectionRow({ qr_code_id: QR_PAVILION_LADIES, timestamp: at(13, 0) })], [], catalog)
    const at59 = buildOnSite([attendanceRow({})], [scan(QR_ECO_MENS, at(13, 53))], cleans, catalog, NOW)
    const at61 = buildOnSite([attendanceRow({})], [scan(QR_ECO_MENS, at(13, 51))], cleans, catalog, NOW)
    expect(at59[0].activity?.kind).toBe('cleaning')
    expect(at61[0].activity).toEqual({ kind: 'last_cleaned', areaKey: "pavilion ladies'", areaName: "Pavilion Ladies'", at: at(13, 0) })
  })

  it('says what they are cleaning from their latest area scan', () => {
    const [person] = buildOnSite(
      [attendanceRow({})],
      [scan(QR_PAVILION_LADIES, at(11)), scan(QR_ECO_MENS, at(14))],
      [],
      catalog,
      NOW,
    )
    expect(person.activity).toEqual({ kind: 'cleaning', areaKey: "eco block men's", areaName: "Eco Block Men's", since: at(14) })
  })

  it('switches to "last cleaned" once a clean is submitted after the scan', () => {
    const { cleans } = buildCleans([selectionRow({ qr_code_id: QR_ECO_MENS, timestamp: at(14, 20) })], [], catalog)
    const [person] = buildOnSite([attendanceRow({})], [scan(QR_ECO_MENS, at(14))], cleans, catalog, NOW)
    expect(person.activity).toEqual({ kind: 'last_cleaned', areaKey: "eco block men's", areaName: "Eco Block Men's", at: at(14, 20) })
  })

  it("ignores scans of other clients' posters and of clock posters", () => {
    const [person] = buildOnSite(
      [attendanceRow({})],
      [scan(QR_OTHER_CLIENT, at(14, 30)), scan(QR_CLOCK_IN, at(14, 31)), scan(null, at(14, 32))],
      [],
      catalog,
      NOW,
    )
    expect(person.activity).toBeNull()
  })

  it('ignores scans from before this shift and scans by someone else', () => {
    const [person] = buildOnSite(
      [attendanceRow({})],
      [scan(QR_ECO_MENS, at(9)), scan(QR_ECO_MENS, at(14), 'another-cleaner')],
      [],
      catalog,
      NOW,
    )
    expect(person.activity).toBeNull()
  })
})
