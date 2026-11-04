import type { BathroomAssistRequest } from '../../services/supabase'

/**
 * A client site as the dashboard sees it. A site is a customer (uk_customers
 * row); every operational table records it only as free text, so `matchNames`
 * holds every spelling of the customer that counts as "this site".
 */
export type SiteRef = {
  key: string
  customerId: string | null
  name: string
  matchNames: string[]
  address: string | null
}

export type QrCodeRow = {
  qr_code_id: string | null
  customer_name: string | null
  building_area: string | null
  area_description: string | null
  qr_code_url: string | null
  is_active: boolean | null
}

export type AreaTaskRow = {
  id: string | number | null
  customer_name: string | null
  area: string | null
  qr_code: string | null
  task_type: string | null
  task_description: string | null
  active: boolean | null
}

export type AttendanceRow = {
  id: number | string
  cleaner_uuid: string | null
  cleaner_name: string | null
  customer_name: string | null
  site_name: string | null
  clock_in: string | null
  clock_out: string | null
}

export type SelectionRow = {
  id: number | string
  cleaner_id: string | null
  cleaner_name: string | null
  qr_code_id: string | null
  area_type: string | null
  selected_tasks: unknown
  completed_tasks: unknown
  timestamp: string | null
}

export type PhotoMetaRow = {
  id: number
  cleaner_id: string | null
  cleaner_name: string | null
  qr_code_id: string | null
  task_id: string | null
  photo_timestamp: string | null
}

/** One "Area Scan" from cleaner_logs, with the scanned QR id lifted out of device_info. */
export type AreaScanRow = {
  cleaner_id: string | null
  timestamp: string | null
  scanned_qr_id: string | null
}

export type AssistRow = Pick<
  BathroomAssistRequest,
  | 'id'
  | 'qr_code_id'
  | 'customer_name'
  | 'location_label'
  | 'status'
  | 'issue_type'
  | 'issue_description'
  | 'reported_at'
  | 'accepted_at'
  | 'accepted_by_name'
  | 'resolved_at'
  | 'resolved_by_name'
>

export type AreaEntry = {
  /** Normalised area name; the identity used for filtering and coverage. */
  key: string
  name: string
  qrCodeIds: string[]
  /** Active areas count towards site coverage; retired ones only label history. */
  inCoverage: boolean
}

export type AreaCatalog = {
  /** Coverage areas, alphabetical. */
  areas: AreaEntry[]
  byQrId: Map<string, AreaEntry>
  /** area_tasks row id (and default task id) -> human task name. */
  taskNames: Map<string, string>
  /** Every QR id that belongs to this site, active or not. */
  qrCodeIds: string[]
  siteNames: string[]
}

export type Clean = {
  id: string
  at: string
  cleanerId: string | null
  cleanerName: string
  qrCodeId: string | null
  areaKey: string | null
  areaName: string | null
  tasks: string[]
  taskCount: number
  photoIds: number[]
}

export type SitePhoto = {
  id: number
  at: string
  cleanerName: string
  areaKey: string | null
  areaName: string | null
  taskName: string | null
  cleanId: string | null
}

export type CurrentActivity =
  | { kind: 'cleaning'; areaKey: string; areaName: string; since: string }
  | { kind: 'last_cleaned'; areaKey: string | null; areaName: string | null; at: string }

export type OnSiteCleaner = {
  key: string
  cleanerId: string | null
  name: string
  clockIn: string
  minutesOnSite: number
  activity: CurrentActivity | null
}

export type CallItem = {
  id: string
  status: AssistRow['status']
  areaKey: string | null
  areaName: string | null
  issue: string | null
  reportedAt: string
  acceptedByName: string | null
  waitingMinutes: number | null
  resolvedAt: string | null
  resolvedByName: string | null
  resolutionMinutes: number | null
}

export type CoverageStatus = 'done' | 'in_progress' | 'not_yet'

export type CoverageItem = {
  key: string
  name: string
  status: CoverageStatus
  cleanCount: number
  lastCleanAt: string | null
}

export type Coverage = {
  items: CoverageItem[]
  done: number
  total: number
}

export type TimelineItem =
  | { kind: 'clock_in' | 'clock_out'; id: string; at: string; cleanerName: string; areaKey: null }
  | { kind: 'clean'; id: string; at: string; clean: Clean; areaKey: string | null }
  | { kind: 'in_progress'; id: string; at: string; cleanerName: string; areaName: string; areaKey: string }
  | { kind: 'call'; id: string; at: string; call: CallItem; areaKey: string | null }

export type SiteKpis = {
  onSiteCount: number
  cleansCompleted: number
  inProgress: number
  photos: number
  openCalls: number
  resolvedToday: number
  avgResponseMinutes: number | null
}

export type SiteSnapshot = {
  site: SiteRef
  generatedAt: string
  /** London midnight that "today" is counted from. */
  dayStart: string
  kpis: SiteKpis
  onSite: OnSiteCleaner[]
  timeline: TimelineItem[]
  calls: { open: CallItem[]; resolved: CallItem[] }
  coverage: Coverage
  photos: SitePhoto[]
  /** Areas that appear anywhere today, for the timeline's area filter. */
  areaOptions: Array<{ key: string; name: string }>
}
