import { describe, expect, it } from 'vitest'
import { buildAreaCatalog, isHumanAreaLabel, resolveArea } from './areaCatalog'
import {
  QR_CLOCK_IN,
  QR_ECO_MENS,
  QR_PAVILION_LADIES,
  QR_PAVILION_MENS,
  SEAS,
  SEAS_QR_ROWS,
  areaTaskRow,
  qrRow,
} from './testFixtures'

const catalogFor = (input: Partial<Parameters<typeof buildAreaCatalog>[0]> = {}) =>
  buildAreaCatalog({ qrRows: SEAS_QR_ROWS, areaTaskRows: [], siteNames: SEAS.matchNames, ...input })

describe('isHumanAreaLabel', () => {
  it.each([
    "Pavilion Ladies'",
    'Brick Block Men’s toilets',
    'Rank Lodge',
    'Kitchen',
  ])('accepts the place name %s', (label) => {
    expect(isHumanAreaLabel(label)).toBe(true)
  })

  it.each([
    ['a UUID', QR_PAVILION_LADIES],
    ['snake_case code', 'PAVILION_LADIES'],
    ['lower snake code', 'pavilion_ladies_01'],
    ['shouty kebab code', 'SEAS-PAV-L-01'],
    ['a QR label', 'QR 12'],
    ['a default QR description', 'Area QR Code'],
    ['an area type', 'Bathrooms Ablutions'],
    ['a clock poster', 'Clock In'],
    ['a placeholder', 'Unassigned Area'],
    ['an ops inspection id', 'ops_inspection_42'],
    ['digits only', '0042'],
    ['blank', '   '],
  ])('rejects %s', (_case, label) => {
    expect(isHumanAreaLabel(label)).toBe(false)
  })

  it("rejects the site's own name and the site's QR ids", () => {
    expect(isHumanAreaLabel('South of England Showground', { siteNames: SEAS.matchNames })).toBe(false)
    expect(isHumanAreaLabel('PAV7', { qrCodeIds: ['pav7'] })).toBe(false)
  })
})

describe('buildAreaCatalog', () => {
  it('names each QR code by its building area', () => {
    const catalog = catalogFor()
    expect(catalog.byQrId.get(QR_PAVILION_LADIES)?.name).toBe("Pavilion Ladies'")
    expect(catalog.byQrId.get(QR_PAVILION_MENS)?.name).toBe("Pavilion Men's")
  })

  it('leaves clock-in posters out of the areas entirely', () => {
    const catalog = catalogFor()
    expect(catalog.byQrId.has(QR_CLOCK_IN)).toBe(false)
    expect(catalog.areas.map((area) => area.name)).toEqual(["Eco Block Men's", "Pavilion Ladies'", "Pavilion Men's"])
  })

  it('falls back to the payload area name when building_area is a code', () => {
    const catalog = catalogFor({
      qrRows: [
        qrRow({
          building_area: 'PAVILION_LADIES',
          qr_code_url: JSON.stringify({ type: 'AREA', metadata: { areaName: "Pavilion Ladies'" } }),
        }),
      ],
    })
    expect(catalog.byQrId.get(QR_PAVILION_LADIES)?.name).toBe("Pavilion Ladies'")
  })

  it('has no name at all for a QR code whose every label is a code', () => {
    const catalog = catalogFor({
      qrRows: [qrRow({ building_area: 'PAV_L', qr_code_url: 'not json', area_description: 'Area QR Code' })],
    })
    expect(catalog.byQrId.has(QR_PAVILION_LADIES)).toBe(false)
    expect(catalog.areas).toEqual([])
  })

  it('merges two posters in the same area into one coverage area', () => {
    const catalog = catalogFor({
      qrRows: [qrRow({}), qrRow({ qr_code_id: 'second-poster', building_area: "pavilion  ladies'" })],
    })
    expect(catalog.areas).toHaveLength(1)
    expect(catalog.areas[0].qrCodeIds).toEqual([QR_PAVILION_LADIES, 'second-poster'])
    expect(catalog.byQrId.get('second-poster')?.name).toBe("Pavilion Ladies'")
  })

  it('keeps retired QR codes for naming history but not for coverage', () => {
    const catalog = catalogFor({ qrRows: [qrRow({ is_active: false })] })
    expect(catalog.byQrId.get(QR_PAVILION_LADIES)?.name).toBe("Pavilion Ladies'")
    expect(catalog.areas).toEqual([])
  })

  it('adds areas that exist only in area_tasks, skipping clock and placeholder rows', () => {
    const catalog = catalogFor({
      qrRows: [],
      areaTaskRows: [
        areaTaskRow({ area: 'Rank Lodge', task_description: 'Clean toilets' }),
        areaTaskRow({ id: 'clock', area: 'South of England Showground', task_type: 'CLOCK_IN' }),
        areaTaskRow({ id: 'unassigned', area: 'Unassigned Area', task_type: 'AREA' }),
      ],
    })
    expect(catalog.areas.map((area) => area.name)).toEqual(['Rank Lodge'])
  })

  it('maps task ids to their checklist names, but not area placeholders', () => {
    const catalog = catalogFor({
      areaTaskRows: [
        areaTaskRow({ id: 'task-1', task_description: 'Clean toilets' }),
        areaTaskRow({ id: 'placeholder', task_type: 'AREA', task_description: "Pavilion Ladies'" }),
      ],
      defaultTaskNames: { bath_mop_floors: 'Mop floors' },
    })
    expect(catalog.taskNames.get('task-1')).toBe('Clean toilets')
    expect(catalog.taskNames.get('bath_mop_floors')).toBe('Mop floors')
    expect(catalog.taskNames.has('placeholder')).toBe(false)
  })

  it('lets building_qr_codes win over area_tasks for the same QR code', () => {
    const catalog = catalogFor({
      areaTaskRows: [areaTaskRow({ qr_code: QR_ECO_MENS, area: 'Eco Gents' })],
    })
    expect(catalog.byQrId.get(QR_ECO_MENS)?.name).toBe("Eco Block Men's")
  })
})

describe('resolveArea — never a QR name', () => {
  const catalog = catalogFor()

  it('uses the catalogue name for a known QR', () => {
    expect(resolveArea(catalog, QR_PAVILION_LADIES, 'PAVILION_LADIES')).toEqual({
      key: "pavilion ladies'",
      name: "Pavilion Ladies'",
    })
  })

  it('falls back to a human free-text label', () => {
    expect(resolveArea(catalog, 'unknown-qr', 'Rank Lodge')).toEqual({ key: 'rank lodge', name: 'Rank Lodge' })
  })

  it('reuses the catalogue spelling when the free text names a known area', () => {
    expect(resolveArea(catalog, null, "pavilion men's").name).toBe("Pavilion Men's")
  })

  it('returns no name rather than a code or the QR id itself', () => {
    expect(resolveArea(catalog, 'unknown-qr', 'SEAS_PAV_L', QR_PAVILION_LADIES, 'unknown-qr')).toEqual({ key: null, name: null })
    expect(resolveArea(catalog, null)).toEqual({ key: null, name: null })
  })
})
