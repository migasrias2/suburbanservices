import { supabase, type BathroomAssistRequest } from './supabase'
import { AssistRequestService } from './assistRequestService'
import { signTaskPhotoPaths } from './photoStorageService'

export type AttendanceShift = {
  id: string
  cleanerId: string | null
  cleanerName: string | null
  customerName: string | null
  siteName: string | null
  clockIn: string | null
  clockOut: string | null
  needsReview: boolean
  reviewReason: string | null
  autoClosedAt: string | null
}

/** A shift payroll must look at before paying it. */
export type ReviewShift = AttendanceShift & {
  durationHours: number | null
}

export type ActiveCleaner = {
  cleanerId: string
  cleanerName: string
  customerName: string | null
  siteName: string | null
  clockIn: string
  durationMinutes: number
}

export type TaskPhoto = {
  id: number
  cleanerId: string | null
  cleanerName: string | null
  qrCodeId: string | null
  taskId: string | null
  areaType: string | null
  photoData: string | null
  photoTimestamp: string
  photoDescription: string | null
}

export type ActiveAssist = {
  id: string
  location: string
  customer: string
  issueType: string | null
  issueDescription: string | null
  notes: string | null
  escalationReason: string | null
  status: 'pending' | 'accepted' | 'escalated'
  reportedAt: string
  acceptedAt: string | null
  acceptedByName: string | null
  escalatedAt: string | null
  escalateAfter: string | null
}

export type ResolvedAssist = {
  id: string
  location: string
  customer: string
  issueType: string | null
  issueDescription: string | null
  notes: string | null
  status: 'pending' | 'accepted' | 'resolved' | 'escalated' | 'cancelled'
  reportedAt: string
  resolvedAt: string | null
  resolvedByName: string | null
}

export type LiveDashboardData = {
  active: ActiveCleaner[]
  recent: AttendanceShift[]
  photos: TaskPhoto[]
  resolved: ResolvedAssist[]
  needsAttention: ActiveAssist[]
  reviewQueue: ReviewShift[]
  todayClockIns: number
  todayClockOuts: number
}

function startOfTodayIso(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function endOfTodayIso(): string {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

export async function loadLiveDashboard(): Promise<LiveDashboardData> {
  const dayStart = startOfTodayIso()
  const dayEnd = endOfTodayIso()

  const attendanceQuery = supabase
    .from('time_attendance')
    .select('id, cleaner_id, cleaner_uuid, cleaner_name, customer_name, site_name, clock_in, clock_out, needs_review, review_reason, auto_closed_at')
    // Ops managers clock in through the same flow; their site visits are not
    // cleaning shifts and must not land in cleaner hours or headcount.
    .eq('worker_role', 'cleaner')
    .gte('clock_in', dayStart)
    .lte('clock_in', dayEnd)
    .order('clock_in', { ascending: false })
    .limit(50)

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const photosMetaQuery = supabase
    .from('uk_cleaner_task_photos')
    .select('id, cleaner_id, cleaner_name, qr_code_id, task_id, area_type, photo_timestamp, photo_description')
    .gte('photo_timestamp', sevenDaysAgo)
    .order('photo_timestamp', { ascending: false })
    .limit(2500)

  // Shifts that were auto-closed or ran implausibly long. Payroll needs these
  // even when they are older than today, so this is a separate window.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const reviewQuery = supabase
    .from('time_attendance')
    .select('id, cleaner_id, cleaner_uuid, cleaner_name, customer_name, site_name, clock_in, clock_out, needs_review, review_reason, auto_closed_at')
    .eq('needs_review', true)
    .gte('clock_in', thirtyDaysAgo)
    .order('clock_in', { ascending: false })
    .limit(50)

  const resolvedSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const resolvedPromise = AssistRequestService.listResolved({ limit: 8, resolvedSince }).catch(() => [] as BathroomAssistRequest[])
  const activePromise = AssistRequestService.listRecent({ statuses: ['pending', 'accepted', 'escalated'], limit: 12 }).catch(() => [] as BathroomAssistRequest[])

  const [attendanceRes, photosMetaRes, reviewRes, resolvedRaw, activeRaw] = await Promise.all([
    attendanceQuery,
    photosMetaQuery,
    reviewQuery,
    resolvedPromise,
    activePromise,
  ])
  if (attendanceRes.error) throw attendanceRes.error
  if (photosMetaRes.error) throw photosMetaRes.error
  if (reviewRes.error) throw reviewRes.error

  const shifts: AttendanceShift[] = (attendanceRes.data ?? []).map((row: any) => ({
    id: String(row.id),
    cleanerId: row.cleaner_uuid ?? row.cleaner_id ?? null,
    cleanerName: row.cleaner_name ?? null,
    customerName: row.customer_name ?? null,
    siteName: row.site_name ?? null,
    clockIn: row.clock_in ?? null,
    clockOut: row.clock_out ?? null,
    needsReview: row.needs_review === true,
    reviewReason: row.review_reason ?? null,
    autoClosedAt: row.auto_closed_at ?? null,
  }))

  const reviewQueue: ReviewShift[] = (reviewRes.data ?? []).map((row: any) => {
    const clockIn = row.clock_in ?? null
    const clockOut = row.clock_out ?? null
    const durationHours =
      clockIn && clockOut
        ? Math.round(((new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 3600000) * 10) / 10
        : null
    return {
      id: String(row.id),
      cleanerId: row.cleaner_uuid ?? row.cleaner_id ?? null,
      cleanerName: row.cleaner_name ?? null,
      customerName: row.customer_name ?? null,
      siteName: row.site_name ?? null,
      clockIn,
      clockOut,
      needsReview: true,
      reviewReason: row.review_reason ?? null,
      autoClosedAt: row.auto_closed_at ?? null,
      durationHours,
    }
  })

  const now = Date.now()
  const active: ActiveCleaner[] = shifts
    .filter((s) => s.clockIn && !s.clockOut)
    .map((s) => {
      const clockInMs = new Date(s.clockIn!).getTime()
      return {
        cleanerId: s.cleanerId ?? s.id,
        cleanerName: s.cleanerName ?? 'Unknown',
        customerName: s.customerName,
        siteName: s.siteName,
        clockIn: s.clockIn!,
        durationMinutes: Math.max(0, Math.round((now - clockInMs) / 60000)),
      }
    })

  let todayClockIns = 0
  let todayClockOuts = 0
  shifts.forEach((s) => {
    if (s.clockIn && new Date(s.clockIn) >= new Date(dayStart)) todayClockIns += 1
    if (s.clockOut && new Date(s.clockOut) >= new Date(dayStart)) todayClockOuts += 1
  })

  // Photo blobs are NOT loaded here — they are large base64 images (~174 KB each) and
  // eagerly fetching a full day of them on every 30s refresh was timing out the query.
  // The dashboard now loads only lightweight metadata; blobs are fetched on demand per
  // day via loadPhotoDataForDay (see the "Tap to load" flow in AdminLiveDashboardPage).
  const photos: TaskPhoto[] = (photosMetaRes.data ?? []).map((row: any) => ({
    id: row.id,
    cleanerId: row.cleaner_id ?? null,
    cleanerName: row.cleaner_name ?? null,
    qrCodeId: row.qr_code_id ?? null,
    taskId: row.task_id ?? null,
    areaType: row.area_type ?? null,
    photoData: null,
    photoTimestamp: row.photo_timestamp,
    photoDescription: row.photo_description ?? null,
  }))

  const resolved: ResolvedAssist[] = (resolvedRaw ?? []).map((row) => ({
    id: row.id,
    location: row.location_label,
    customer: row.customer_name ?? 'Unknown customer',
    issueType: row.issue_type ?? null,
    issueDescription: row.issue_description ?? null,
    notes: row.notes ?? null,
    status: row.status,
    reportedAt: row.reported_at,
    resolvedAt: row.resolved_at ?? null,
    resolvedByName: row.resolved_by_name ?? null,
  }))

  const needsAttention: ActiveAssist[] = (activeRaw ?? [])
    .filter((row) => row.status === 'pending' || row.status === 'accepted' || row.status === 'escalated')
    .map((row) => ({
      id: row.id,
      location: row.location_label,
      customer: row.customer_name ?? 'Unknown customer',
      issueType: row.issue_type ?? null,
      issueDescription: row.issue_description ?? null,
      notes: row.notes ?? null,
      escalationReason: row.escalation_reason ?? null,
      status: row.status as ActiveAssist['status'],
      reportedAt: row.reported_at,
      acceptedAt: row.accepted_at ?? null,
      acceptedByName: row.accepted_by_name ?? null,
      escalatedAt: row.escalated_at ?? null,
      escalateAfter: row.escalate_after ?? null,
    }))

  return {
    active,
    recent: shifts.slice(0, 20),
    photos,
    resolved,
    needsAttention,
    reviewQueue,
    todayClockIns,
    todayClockOuts,
  }
}

export async function loadPhotoDataForDay(dayKey: string): Promise<Record<number, string>> {
  const [y, m, d] = dayKey.split('-').map(Number)
  if (!y || !m || !d) return {}
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).toISOString()
  const end = new Date(y, m - 1, d, 23, 59, 59, 999).toISOString()
  const { data, error } = await supabase
    .from('uk_cleaner_task_photos')
    .select('id, photo_data, storage_path')
    .gte('photo_timestamp', start)
    .lte('photo_timestamp', end)
    .limit(500)
  if (error) throw error

  type PhotoDayRow = { id: number; photo_data: string | null; storage_path: string | null }
  const rows = (data ?? []) as PhotoDayRow[]
  const map: Record<number, string> = {}

  // Photos captured since the Storage migration carry a path; older rows still
  // hold an inline base64 data URL. Both resolve to something an <img src> can
  // render, so the callers don't need to care which is which.
  const signed = await signTaskPhotoPaths(
    rows.flatMap((row) => (row.storage_path ? [row.storage_path] : [])),
  )

  rows.forEach((row) => {
    if (row.storage_path && signed[row.storage_path]) {
      map[row.id] = signed[row.storage_path]
    } else if (row.photo_data) {
      map[row.id] = row.photo_data
    }
  })

  return map
}
