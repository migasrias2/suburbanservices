import { supabase } from './supabase'
import { fetchCustomers } from './customersService'
import { fetchActiveSites } from './sitesService'
import { signTaskPhotoPaths } from './photoStorageService'
import { AREA_TASKS } from './qrService'
import { resolveManagerSiteLinks } from '../lib/managerScope'
import { buildNameFilter, collectMatchNames, titleCaseLabel } from '../lib/siteDashboard/siteScope'
import { buildSiteSnapshot, startOfLocalDay, type SiteRawData } from '../lib/siteDashboard/snapshot'
import { ON_SITE_MAX_HOURS } from '../lib/siteDashboard/presence'
import type {
  AreaScanRow,
  AreaTaskRow,
  AssistRow,
  AttendanceRow,
  PhotoMetaRow,
  QrCodeRow,
  SelectionRow,
  SiteRef,
  SiteSnapshot,
} from '../lib/siteDashboard/types'
import type { AppRole } from '../contexts/AuthContext'

/** PostgREST puts .in() lists in the URL; keep each request comfortably short. */
const IN_LIST_CHUNK = 80
/** A busy site day is a few hundred photos; this is a ceiling, not an expectation. */
const PHOTO_META_LIMIT = 1000
const OPEN_CALL_LIMIT = 50
const RESOLVED_CALL_LIMIT = 100

const ASSIST_COLUMNS =
  'id, qr_code_id, customer_name, location_label, status, issue_type, issue_description, reported_at, accepted_at, accepted_by_name, resolved_at, resolved_by_name'

const DEFAULT_TASK_NAMES: Record<string, string> = Object.fromEntries(
  Object.values(AREA_TASKS)
    .flat()
    .map((task) => [task.id, task.name]),
)

type CustomerDetailRow = { id: string; name: string | null; display_name: string | null; address: string | null }

const chunk = <T,>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))

const fail = (what: string, error: { message?: string } | null): never => {
  console.error(`Site dashboard: could not load ${what}`, error)
  throw new Error(`Could not load ${what}. Please try again.`)
}

// ---------------------------------------------------------------------------
// Which sites this login may see
// ---------------------------------------------------------------------------

/** manager_customers rows for this manager, read directly the way OpsCalendarPage does. */
async function fetchLinkedCustomerIds(managerId: string): Promise<string[]> {
  const { data, error } = await supabase.from('manager_customers').select('customer_id').eq('manager_id', managerId)
  if (error) {
    console.warn('Site dashboard: manager_customers not readable, using scope RPC only', error)
    return []
  }
  return (data ?? []).map((row: { customer_id: string | null }) => row.customer_id).filter((id): id is string => Boolean(id))
}

async function fetchCustomerDetails(ids: string[]): Promise<Map<string, CustomerDetailRow>> {
  if (!ids.length) return new Map()
  const { data, error } = await supabase.from('uk_customers').select('id, name, display_name, address').in('id', ids)
  if (error) {
    console.warn('Site dashboard: customer details not readable', error)
    return new Map()
  }
  return new Map(((data ?? []) as CustomerDetailRow[]).map((row) => [row.id, row]))
}

/**
 * A client login's sites: the customers linked to THIS manager id, from the
 * scope RPC and manager_customers. Nothing linked means an empty list, and an
 * empty list means the page shows no data at all.
 */
async function loadManagerSites(managerId: string): Promise<SiteRef[]> {
  const [links, directIds] = await Promise.all([resolveManagerSiteLinks(managerId), fetchLinkedCustomerIds(managerId)])
  const customerIds = Array.from(
    new Set([...links.flatMap((link) => (link.customerId ? [link.customerId] : [])), ...directIds]),
  )
  const details = await fetchCustomerDetails(customerIds)

  const fromIds: SiteRef[] = customerIds.flatMap((customerId) => {
    const detail = details.get(customerId)
    const tokens = links.filter((link) => link.customerId === customerId).flatMap((link) => link.tokens)
    const matchNames = collectMatchNames([detail?.display_name, detail?.name, ...tokens])
    if (!matchNames.length) return []
    const name = detail?.display_name?.trim() || detail?.name?.trim() || titleCaseLabel(matchNames[0])
    return [{ key: customerId, customerId, name, matchNames, address: detail?.address?.trim() || null }]
  })

  const legacy: SiteRef[] = links
    .filter((link) => !link.customerId)
    .map((link) => ({
      key: `label:${link.label}`,
      customerId: null,
      name: titleCaseLabel(link.label),
      matchNames: collectMatchNames(link.tokens),
      address: null,
    }))

  return [...fromIds, ...legacy]
}

async function loadAdminSites(): Promise<SiteRef[]> {
  const customers = await fetchCustomers()
  return customers
    .filter((customer) => customer.is_active !== false)
    .flatMap((customer) => {
      const matchNames = collectMatchNames([customer.display_name, customer.name, customer.customer_name])
      if (!matchNames.length) return []
      return [{ key: customer.id, customerId: customer.id, name: matchNames[0], matchNames, address: customer.address ?? null }]
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function loadOpsSites(): Promise<SiteRef[]> {
  const sites = await fetchActiveSites()
  return sites.map((site) => ({
    key: site.id ?? `label:${site.customerName.toLowerCase()}`,
    customerId: site.id ?? null,
    name: site.customerName,
    matchNames: collectMatchNames([site.customerName]),
    address: site.address,
  }))
}

export async function loadSitesForUser(role: AppRole | null, userId: string | null): Promise<SiteRef[]> {
  if (!role || !userId) return []
  switch (role) {
    case 'manager':
      return loadManagerSites(userId)
    case 'admin':
      return loadAdminSites()
    case 'ops_manager':
      return loadOpsSites()
    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// One site's day
// ---------------------------------------------------------------------------

async function fetchQrRows(nameFilter: string): Promise<QrCodeRow[]> {
  const { data, error } = await supabase
    .from('building_qr_codes')
    .select('qr_code_id, customer_name, building_area, area_description, qr_code_url, is_active')
    .or(nameFilter)
  if (error) fail('the site areas', error)
  return (data ?? []) as QrCodeRow[]
}

async function fetchAreaTaskRows(nameFilter: string): Promise<AreaTaskRow[]> {
  const { data, error } = await supabase
    .from('area_tasks')
    .select('id, customer_name, area, qr_code, task_type, task_description, active')
    .or(nameFilter)
  if (error) fail('the area checklists', error)
  return (data ?? []) as AreaTaskRow[]
}

async function fetchAttendance(attendanceFilter: string, sinceIso: string): Promise<AttendanceRow[]> {
  const { data, error } = await supabase
    .from('time_attendance')
    .select('id, cleaner_uuid, cleaner_name, customer_name, site_name, clock_in, clock_out')
    // Ops manager site visits are not cleaning shifts; same rule as the admin live dashboard.
    .eq('worker_role', 'cleaner')
    .gte('clock_in', sinceIso)
    .or(attendanceFilter)
    .order('clock_in', { ascending: true })
    .limit(500)
  if (error) fail('who is on site', error)
  return (data ?? []) as AttendanceRow[]
}

async function fetchAssists(nameFilter: string, dayStartIso: string): Promise<AssistRow[]> {
  const [openRes, resolvedRes] = await Promise.all([
    supabase
      .from('bathroom_assist_requests')
      .select(ASSIST_COLUMNS)
      .in('status', ['pending', 'accepted', 'escalated'])
      .or(nameFilter)
      .order('reported_at', { ascending: true })
      .limit(OPEN_CALL_LIMIT),
    supabase
      .from('bathroom_assist_requests')
      .select(ASSIST_COLUMNS)
      .eq('status', 'resolved')
      .gte('resolved_at', dayStartIso)
      .or(nameFilter)
      .order('resolved_at', { ascending: false })
      .limit(RESOLVED_CALL_LIMIT),
  ])
  if (openRes.error) fail('Call a Cleaner requests', openRes.error)
  if (resolvedRes.error) fail('Call a Cleaner requests', resolvedRes.error)
  return [...(openRes.data ?? []), ...(resolvedRes.data ?? [])] as AssistRow[]
}

async function fetchByQrIds<T>(qrIds: string[], run: (ids: string[]) => PromiseLike<{ data: unknown; error: { message?: string } | null }>, what: string): Promise<T[]> {
  if (!qrIds.length) return []
  const results = await Promise.all(chunk(qrIds, IN_LIST_CHUNK).map((ids) => run(ids)))
  return results.flatMap((result) => {
    if (result.error) fail(what, result.error)
    return (result.data ?? []) as T[]
  })
}

/** Metadata only. photo_data is a ~174 KB base64 blob per row; loading a day of it times the query out. */
const fetchPhotoMeta = (qrIds: string[], dayStartIso: string) =>
  fetchByQrIds<PhotoMetaRow>(
    qrIds,
    (ids) =>
      supabase
        .from('uk_cleaner_task_photos')
        .select('id, cleaner_id, cleaner_name, qr_code_id, task_id, photo_timestamp')
        .in('qr_code_id', ids)
        .gte('photo_timestamp', dayStartIso)
        .order('photo_timestamp', { ascending: true })
        .limit(PHOTO_META_LIMIT),
    'photos',
  )

const fetchSelections = (qrIds: string[], dayStartIso: string) =>
  fetchByQrIds<SelectionRow>(
    qrIds,
    (ids) =>
      supabase
        .from('uk_cleaner_task_selections')
        .select('id, cleaner_id, cleaner_name, qr_code_id, area_type, selected_tasks, completed_tasks, timestamp')
        .in('qr_code_id', ids)
        .gte('timestamp', dayStartIso)
        .order('timestamp', { ascending: true }),
    'cleans',
  )

/**
 * Latest area scans by the people on site. The scanned QR id lives in
 * device_info.qr_code_scanned (cleaner_logs.qr_code_id is never written), so
 * it is lifted out with a JSON path rather than downloading device_info whole.
 */
async function fetchAreaScans(cleanerIds: string[], sinceIso: string): Promise<AreaScanRow[]> {
  if (!cleanerIds.length) return []
  const { data, error } = await supabase
    .from('cleaner_logs')
    .select('cleaner_id, timestamp, scanned_qr_id:device_info->qr_code_scanned->>id')
    .eq('action', 'Area Scan')
    .in('cleaner_id', cleanerIds)
    .gte('timestamp', sinceIso)
    .order('timestamp', { ascending: false })
    .limit(200)
  if (error) {
    // Only "currently cleaning" depends on this; the rest of the page stands without it.
    console.warn('Site dashboard: area scans unavailable', error)
    return []
  }
  return (data ?? []) as AreaScanRow[]
}

export async function loadSiteSnapshot(site: SiteRef, now: Date = new Date()): Promise<SiteSnapshot> {
  const nameFilter = buildNameFilter(['customer_name'], site.matchNames)
  const attendanceFilter = buildNameFilter(['customer_name', 'site_name'], site.matchNames)
  const empty: SiteRawData = { qrRows: [], areaTaskRows: [], attendance: [], selections: [], photoRows: [], scans: [], assists: [] }
  if (!nameFilter || !attendanceFilter) return buildSiteSnapshot(site, empty, now, DEFAULT_TASK_NAMES)

  const dayStartIso = startOfLocalDay(now).toISOString()
  const onSiteWindowIso = new Date(now.getTime() - ON_SITE_MAX_HOURS * 3600 * 1000).toISOString()
  const attendanceSinceIso = dayStartIso < onSiteWindowIso ? dayStartIso : onSiteWindowIso

  const [qrRows, areaTaskRows, attendance, assists] = await Promise.all([
    fetchQrRows(nameFilter),
    fetchAreaTaskRows(nameFilter),
    fetchAttendance(attendanceFilter, attendanceSinceIso),
    fetchAssists(nameFilter, dayStartIso),
  ])

  const qrIds = Array.from(
    new Set([
      ...qrRows.flatMap((row) => (row.qr_code_id ? [row.qr_code_id.trim()] : [])),
      ...areaTaskRows.flatMap((row) => (row.qr_code ? [row.qr_code.trim()] : [])),
    ]),
  )
  const openCleanerIds = Array.from(
    new Set(attendance.filter((row) => !row.clock_out && row.cleaner_uuid).map((row) => (row.cleaner_uuid as string).trim())),
  )

  const [selections, photoRows, scans] = await Promise.all([
    fetchSelections(qrIds, dayStartIso),
    fetchPhotoMeta(qrIds, dayStartIso),
    fetchAreaScans(openCleanerIds, attendanceSinceIso),
  ])

  return buildSiteSnapshot(site, { qrRows, areaTaskRows, attendance, selections, photoRows, scans, assists }, now, DEFAULT_TASK_NAMES)
}

/**
 * Full-size sources for a handful of photos, fetched only when their
 * thumbnails scroll into view. Storage photos come back as signed URLs; older
 * rows still hold an inline base64 data URL. A photo that cannot be resolved
 * is simply absent from the map.
 */
export async function loadPhotoSources(ids: number[]): Promise<Record<number, string>> {
  const unique = Array.from(new Set(ids.filter((id) => Number.isFinite(id))))
  if (!unique.length) return {}
  const { data, error } = await supabase
    .from('uk_cleaner_task_photos')
    .select('id, photo_data, storage_path')
    .in('id', unique)
  if (error) fail('photos', error)

  type PhotoSourceRow = { id: number; photo_data: string | null; storage_path: string | null }
  const rows = (data ?? []) as PhotoSourceRow[]
  const signed = await signTaskPhotoPaths(rows.flatMap((row) => (row.storage_path ? [row.storage_path] : [])))

  return rows.reduce<Record<number, string>>((acc, row) => {
    const src = (row.storage_path ? signed[row.storage_path] : null) ?? row.photo_data
    return src ? { ...acc, [row.id]: src } : acc
  }, {})
}
