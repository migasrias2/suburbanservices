import { describe, expect, it } from 'vitest'
import { buildAreaCatalog } from './areaCatalog'
import { buildCleans } from './cleans'
import { buildCoverage } from './coverage'
import { QR_PAVILION_LADIES, QR_PAVILION_MENS, SEAS, SEAS_QR_ROWS, at, selectionRow } from './testFixtures'

const catalog = buildAreaCatalog({ qrRows: SEAS_QR_ROWS, areaTaskRows: [], siteNames: SEAS.matchNames })

describe('buildCoverage', () => {
  it('marks every area as not yet when nothing has happened', () => {
    const coverage = buildCoverage(catalog.areas, [], [])
    expect(coverage).toMatchObject({ done: 0, total: 3 })
    expect(coverage.items.every((item) => item.status === 'not_yet')).toBe(true)
  })

  it('counts an area as done after one clean, photo or not, and counts repeat cleans', () => {
    const { cleans } = buildCleans(
      [
        selectionRow({ id: 1, qr_code_id: QR_PAVILION_LADIES, timestamp: at(12, 34) }),
        selectionRow({ id: 2, qr_code_id: QR_PAVILION_LADIES, timestamp: at(13, 45) }),
        selectionRow({ id: 3, qr_code_id: QR_PAVILION_MENS, timestamp: at(12, 30) }),
      ],
      [],
      catalog,
    )
    const coverage = buildCoverage(catalog.areas, cleans, [])
    expect(coverage.done).toBe(2)
    expect(coverage.items.find((item) => item.name === "Pavilion Ladies'")).toMatchObject({
      status: 'done',
      cleanCount: 2,
      lastCleanAt: at(13, 45),
    })
  })

  it('shows an area being cleaned now as in progress, still counted done if it was cleaned earlier', () => {
    const { cleans } = buildCleans([selectionRow({ qr_code_id: QR_PAVILION_LADIES })], [], catalog)
    const coverage = buildCoverage(catalog.areas, cleans, ["pavilion ladies'", "eco block men's"])
    expect(coverage.done).toBe(1)
    expect(coverage.items.map((item) => [item.name, item.status])).toEqual([
      ["Eco Block Men's", 'in_progress'],
      ["Pavilion Ladies'", 'in_progress'],
      ["Pavilion Men's", 'not_yet'],
    ])
  })

  it('orders done (earliest first), then in progress, then not yet', () => {
    const { cleans } = buildCleans(
      [
        selectionRow({ id: 1, qr_code_id: QR_PAVILION_MENS, timestamp: at(12) }),
        selectionRow({ id: 2, qr_code_id: QR_PAVILION_LADIES, timestamp: at(10) }),
      ],
      [],
      catalog,
    )
    const coverage = buildCoverage(catalog.areas, cleans, [])
    expect(coverage.items.map((item) => item.name)).toEqual(["Pavilion Ladies'", "Pavilion Men's", "Eco Block Men's"])
  })

  it('ignores cleans of areas that are not on the coverage list', () => {
    const { cleans } = buildCleans([selectionRow({ qr_code_id: 'retired-qr' })], [], catalog)
    expect(buildCoverage(catalog.areas, cleans, []).done).toBe(0)
  })
})
