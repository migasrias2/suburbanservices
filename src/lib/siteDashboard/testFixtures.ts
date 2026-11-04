import type { AreaTaskRow, AssistRow, AttendanceRow, PhotoMetaRow, QrCodeRow, SelectionRow, SiteRef } from './types'

/**
 * London wall-clock time on 1 Nov 2026, the day of the client's prototype.
 * British Summer Time ended on 25 Oct, so London is on UTC that day and these
 * hold whatever time zone the test machine is in.
 */
export const at = (hours: number, minutes = 0, dayOffset = 0): string =>
  new Date(Date.UTC(2026, 10, 1 + dayOffset, hours, minutes, 0, 0)).toISOString()

export const NOW = new Date(Date.UTC(2026, 10, 1, 14, 52, 0, 0))
export const DAY_START = new Date(Date.UTC(2026, 10, 1, 0, 0, 0, 0))

export const SEAS: SiteRef = {
  key: 'cust-seas',
  customerId: 'cust-seas',
  name: 'South of England Showground',
  matchNames: ['South of England Showground', 'SEAS'],
  address: 'Selsfield Road, Ardingly',
}

export const QR_PAVILION_LADIES = '0b5c3f0e-1111-4c1a-9c1a-000000000001'
export const QR_PAVILION_MENS = '0b5c3f0e-1111-4c1a-9c1a-000000000002'
export const QR_ECO_MENS = '0b5c3f0e-1111-4c1a-9c1a-000000000003'
export const QR_CLOCK_IN = '0b5c3f0e-1111-4c1a-9c1a-000000000009'
export const QR_OTHER_CLIENT = '0b5c3f0e-2222-4c1a-9c1a-000000000001'

export const CLEANER_ID = 'c1eaner0-0000-4000-8000-000000000001'

const payload = (type: string, areaName?: string) => JSON.stringify({ id: 'x', type, metadata: areaName ? { areaName } : {} })

export const qrRow = (overrides: Partial<QrCodeRow>): QrCodeRow => ({
  qr_code_id: QR_PAVILION_LADIES,
  customer_name: 'South of England Showground',
  building_area: "Pavilion Ladies'",
  area_description: 'Area QR Code',
  qr_code_url: payload('AREA', "Pavilion Ladies'"),
  is_active: true,
  ...overrides,
})

export const SEAS_QR_ROWS: QrCodeRow[] = [
  qrRow({}),
  qrRow({ qr_code_id: QR_PAVILION_MENS, building_area: "Pavilion Men's", qr_code_url: payload('AREA', "Pavilion Men's") }),
  qrRow({ qr_code_id: QR_ECO_MENS, building_area: "Eco Block Men's", qr_code_url: payload('AREA', "Eco Block Men's") }),
  qrRow({
    qr_code_id: QR_CLOCK_IN,
    building_area: 'South of England Showground',
    area_description: 'Clock In QR Code',
    qr_code_url: payload('CLOCK_IN'),
  }),
]

export const areaTaskRow = (overrides: Partial<AreaTaskRow>): AreaTaskRow => ({
  id: 'task-1',
  customer_name: 'South of England Showground',
  area: "Pavilion Ladies'",
  qr_code: null,
  task_type: 'BATHROOMS_ABLUTIONS',
  task_description: 'Clean toilets',
  active: true,
  ...overrides,
})

export const attendanceRow = (overrides: Partial<AttendanceRow>): AttendanceRow => ({
  id: 1,
  cleaner_uuid: CLEANER_ID,
  cleaner_name: 'Toyeeb Atunde',
  customer_name: 'South of England Showground',
  site_name: 'South of England Showground',
  clock_in: at(9, 40),
  clock_out: null,
  ...overrides,
})

export const selectionRow = (overrides: Partial<SelectionRow>): SelectionRow => ({
  id: 1,
  cleaner_id: CLEANER_ID,
  cleaner_name: 'Toyeeb Atunde',
  qr_code_id: QR_PAVILION_LADIES,
  area_type: 'BATHROOMS_ABLUTIONS',
  selected_tasks: JSON.stringify(['task-1']),
  completed_tasks: JSON.stringify(['task-1']),
  timestamp: at(10, 5),
  ...overrides,
})

export const photoRow = (overrides: Partial<PhotoMetaRow>): PhotoMetaRow => ({
  id: 100,
  cleaner_id: CLEANER_ID,
  cleaner_name: 'Toyeeb Atunde',
  qr_code_id: QR_PAVILION_LADIES,
  task_id: 'task-1',
  photo_timestamp: at(10, 2),
  ...overrides,
})

export const assistRow = (overrides: Partial<AssistRow>): AssistRow => ({
  id: 'req-1',
  qr_code_id: QR_PAVILION_LADIES,
  customer_name: 'South of England Showground',
  location_label: "Pavilion Ladies'",
  status: 'pending',
  issue_type: 'Toilet roll has run out',
  issue_description: null,
  reported_at: at(14, 41),
  accepted_at: null,
  accepted_by_name: null,
  resolved_at: null,
  resolved_by_name: null,
  ...overrides,
})
