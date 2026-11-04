import { describe, expect, it } from 'vitest'
import { buildAreaCatalog } from './areaCatalog'
import { buildCleans, parseTaskIds } from './cleans'
import {
  CLEANER_ID,
  QR_PAVILION_LADIES,
  QR_PAVILION_MENS,
  SEAS,
  SEAS_QR_ROWS,
  at,
  areaTaskRow,
  photoRow,
  selectionRow,
} from './testFixtures'

const catalog = buildAreaCatalog({
  qrRows: SEAS_QR_ROWS,
  areaTaskRows: [areaTaskRow({ id: 'task-1', task_description: 'Clean toilets' })],
  siteNames: SEAS.matchNames,
  defaultTaskNames: { bath_mop_floors: 'Mop floors' },
})

describe('parseTaskIds', () => {
  it('reads JSON strings and real arrays alike', () => {
    expect(parseTaskIds('["a","b"]')).toEqual(['a', 'b'])
    expect(parseTaskIds(['a', 7])).toEqual(['a', '7'])
  })

  it('treats junk as no tasks', () => {
    expect(parseTaskIds('not json')).toEqual([])
    expect(parseTaskIds('{"a":1}')).toEqual([])
    expect(parseTaskIds(null)).toEqual([])
  })
})

describe('buildCleans', () => {
  it('counts a clean with no photos at all', () => {
    const { cleans, photos } = buildCleans([selectionRow({})], [], catalog)
    expect(cleans).toHaveLength(1)
    expect(cleans[0]).toMatchObject({ areaName: "Pavilion Ladies'", photoIds: [], cleanerName: 'Toyeeb Atunde' })
    expect(photos).toEqual([])
  })

  it('does not count ops site inspections as cleans', () => {
    const { cleans } = buildCleans([selectionRow({ area_type: 'OPS_SITE_INSPECTION' })], [], catalog)
    expect(cleans).toEqual([])
  })

  it('resolves checklist names from area_tasks and the built-in defaults, and drops ids it cannot name', () => {
    const { cleans } = buildCleans(
      [selectionRow({ completed_tasks: ['task-1', 'bath_mop_floors', '9a1c0000-0000-4000-8000-00000000abcd'] })],
      [],
      catalog,
    )
    expect(cleans[0].tasks).toEqual(['Clean toilets', 'Mop floors'])
    expect(cleans[0].taskCount).toBe(3)
  })

  it("attaches each photo to the same cleaner's next clean of the same area", () => {
    const { cleans, photos } = buildCleans(
      [
        selectionRow({ id: 1, timestamp: at(10, 5) }),
        selectionRow({ id: 2, timestamp: at(13, 15) }),
        selectionRow({ id: 3, qr_code_id: QR_PAVILION_MENS, timestamp: at(12, 30) }),
      ],
      [
        photoRow({ id: 101, photo_timestamp: at(10, 1) }),
        photoRow({ id: 102, photo_timestamp: at(13, 10) }),
        photoRow({ id: 103, qr_code_id: QR_PAVILION_MENS, photo_timestamp: at(12, 25) }),
        photoRow({ id: 104, cleaner_id: 'someone-else', photo_timestamp: at(10, 2) }),
      ],
      catalog,
    )
    const byId = Object.fromEntries(cleans.map((clean) => [clean.id, clean.photoIds]))
    expect(byId).toEqual({ 'clean-1': [101], 'clean-2': [102], 'clean-3': [103] })
    expect(photos.find((photo) => photo.id === 104)).toMatchObject({ cleanId: null, areaName: "Pavilion Ladies'" })
  })

  it('accepts a photo stamped a moment after the submit', () => {
    const { cleans } = buildCleans([selectionRow({ timestamp: at(10, 5) })], [photoRow({ photo_timestamp: at(10, 6) })], catalog)
    expect(cleans[0].photoIds).toEqual([100])
  })

  it('never puts a QR id where the area name goes', () => {
    const { cleans } = buildCleans([selectionRow({ qr_code_id: 'SEAS_UNKNOWN_QR' })], [], catalog)
    expect(cleans[0].areaName).toBeNull()
    expect(cleans[0].areaKey).toBeNull()
  })

  it('names the photo task and keeps cleans in time order', () => {
    const { cleans, photos } = buildCleans(
      [selectionRow({ id: 2, timestamp: at(12) }), selectionRow({ id: 1, timestamp: at(9) })],
      [photoRow({ photo_timestamp: at(8, 58) })],
      catalog,
    )
    expect(cleans.map((clean) => clean.id)).toEqual(['clean-1', 'clean-2'])
    expect(photos[0]).toMatchObject({ taskName: 'Clean toilets', cleanId: 'clean-1' })
  })

  it('labels a nameless cleaner without inventing one', () => {
    const { cleans } = buildCleans([selectionRow({ cleaner_name: null, cleaner_id: CLEANER_ID })], [], catalog)
    expect(cleans[0].cleanerName).toBe('Cleaner')
    expect(QR_PAVILION_LADIES).toBeTruthy()
  })
})
