import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Users, Image as ImageIcon, ArrowLeft, ArrowRight, Clock, MapPin, Search, ChevronDown, ChevronLeft, ChevronRight, ThumbsUp, ThumbsDown, X } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { fetchAllCleaners, fetchCleanersByIds, fetchManagerCleanerIds } from '../../services/managerService'
import { AREA_TASKS } from '../../services/qrService'
import { normalizeCleanerName } from '../../lib/identity'
import { AssistRequestService } from '../../services/assistRequestService'
import { Badge } from '../ui/badge'
import { ScrollArea } from '../ui/scroll-area'

interface ManagerDashboardProps {
  managerId: string
  managerName: string
}

interface CleanerListItem {
  id: string
  cleaner_id: string
  cleaner_name: string
  cleaner_name_normalized: string
  customer_name: string | null
  site_area: string | null
  site_id: string | null
  event_type: string | null
  timestamp: string
  is_active: boolean
  hasAvtradeClock?: boolean
}

interface CleanerLogRow {
  id: number
  cleaner_id: string
  cleaner_name: string
  action: string
  site_area: string | null
  customer_name: string | null
  timestamp: string
}

interface AttendanceRow {
  id: number
  cleaner_id: number | null
  cleaner_name: string
  clock_in: string | null
  clock_out: string | null
  site_name: string | null
  customer_name: string | null
}

interface TaskSelectionRow {
  id: number
  cleaner_id: string
  cleaner_name?: string
  area_type: string
  selected_tasks: string | null
  completed_tasks: string | null
  timestamp: string
  qr_code_id?: string | null
  area_name?: string | null
  customer_name?: string | null
}

interface TaskPhotoRow {
  id: number
  cleaner_id: string
  cleaner_name?: string
  photo_data: string
  photo_timestamp: string
  task_id?: string | null
  area_type?: string | null
  qr_code_id?: string | null
  area_name?: string | null
  customer_name?: string | null
  started_at?: string | null
}

interface TaskPhotoGroup {
  key: string
  taskId: string | null
  taskName: string
  category: string | null
  startedAt: string | null
  startedTimestamp: number
  latestAt: string | null
  latestTimestamp: number
  area: string | null
  areaKey: string
  customer: string | null
  dateKey: string
  photos: TaskPhotoRow[]
}

interface AreaPhotoGroup {
  key: string
  areaKey: string
  area: string
  category: string | null
  customer: string | null
  dateKey: string
  dateLabel: string
  startedTimestamp: number
  latestAt: string | null
  latestTimestamp: number
  tasks: TaskPhotoGroup[]
}

interface BathroomAssistRequest {
  id: string
  location_label: string
  customer_name: string | null
  reported_at: string
  accepted_at: string | null
  resolved_at: string | null
  status: 'pending' | 'accepted' | 'resolved' | 'escalated'
  notes: string | null
  materials_used: string | null
  resolved_by_name: string | null
  accepted_by_name: string | null
  before_media: string[] | null
  after_media: string[] | null
}

const statusColors: Record<string, string> = {
  clock_in: 'bg-emerald-500',
  clock_out: 'bg-rose-500',
  area_scan: 'bg-blue-500',
  task_started: 'bg-amber-500',
  task_complete: 'bg-indigo-500'
}

const normalizeStatus = (status: string | null) => (status ? status.toLowerCase().replace(/\s+/g, '_') : '')
const getStatusColor = (status: string | null) => statusColors[normalizeStatus(status)] || 'bg-gray-400'

const formatTime = (iso: string | null, options?: Intl.DateTimeFormatOptions) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(options ?? {}) }) : '—'
const formatDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'
const formatTimeOnly = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—')
const formatCategoryLabel = (category?: string | null) => {
  if (!category) return 'General'
  const normalized = category
    .toString()
    .replace(/[_\s]+/g, ' ')
    .trim()
  if (!normalized) return 'General'
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}
const toTimestamp = (value?: string | null) => {
  if (!value) return Number.POSITIVE_INFINITY
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time
}
const parseTimestamp = (value?: string | null) => {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

const RESERVED_AREA_LABELS = new Set([
  'bathrooms ablutions',
  'admin office',
  'general areas',
  'warehouse industrial',
  'kitchen canteen',
  'reception common',
  'unassigned area',
  'unknown area',
  'area',
])

const normalizeDisplayLabel = (value?: string | null) => {
  if (!value) return null
  const trimmed = value.toString().trim()
  if (!trimmed) return null
  if (/^[A-Z0-9_]+$/.test(trimmed) && trimmed.includes('_')) {
    return null
  }
  const cleaned = trimmed.replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim()
  if (!cleaned) return null
  if (RESERVED_AREA_LABELS.has(cleaned.toLowerCase())) {
    return null
  }
  return cleaned
}

const resolveAreaDisplayLabel = (
  ...labels: Array<string | null | undefined>
) => {
  for (const label of labels) {
    const normalized = normalizeDisplayLabel(label)
    if (normalized) {
      return normalized
    }
  }
  return 'Unknown Area'
}

const resolveCustomerDisplayLabel = (
  ...labels: Array<string | null | undefined>
) => {
  for (const label of labels) {
    const normalized = normalizeDisplayLabel(label)
    if (normalized) {
      return normalized
    }
  }
  return null
}

const buildDateKey = (value?: string | null) => {
  const timestamp = parseTimestamp(value)
  if (timestamp === null) return 'unknown-date'
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const buildSessionAnchor = (value?: string | null) => {
  const timestamp = parseTimestamp(value)
  if (timestamp === null) return null
  return new Date(timestamp).toISOString()
}

const formatDateLabelFromKey = (dateKey: string) => {
  if (!dateKey || dateKey === 'unknown-date') return 'Date unknown'
  const [year, month, day] = dateKey.split('-').map((part) => Number.parseInt(part, 10))
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return 'Date unknown'
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return 'Date unknown'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

const deriveAreaIdentity = (photo: TaskPhotoRow) => {
  const rawLabel = photo.area_name?.trim() || photo.area_type?.trim() || 'Unassigned Area'
  const areaLabel = formatCategoryLabel(rawLabel)
  const identifierSegments = [photo.qr_code_id, rawLabel, photo.area_type, photo.customer_name]
    .map((segment) => (segment ? segment.toString().trim().toLowerCase() : ''))
  const identifier = identifierSegments.filter(Boolean).join('::') || 'unassigned-area'
  return {
    key: identifier,
    label: areaLabel,
    customer: photo.customer_name || null,
  }
}

const buildPhotoDateKey = (photo: TaskPhotoRow) => {
  const dateBasedKey = buildDateKey(photo.photo_timestamp || photo.started_at)
  if (dateBasedKey !== 'unknown-date') return dateBasedKey
  if (photo.photo_timestamp) return buildDateKey(photo.photo_timestamp)
  if (photo.started_at) return buildDateKey(photo.started_at)
  return 'unknown-date'
}

export const ManagerDashboard: React.FC<ManagerDashboardProps> = ({ managerId, managerName }) => {
  const [isListLoading, setIsListLoading] = useState(true)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [cleaners, setCleaners] = useState<CleanerListItem[]>([])
  const [selectedCleaner, setSelectedCleaner] = useState<CleanerListItem | null>(null)
  const [attendance, setAttendance] = useState<AttendanceRow[]>([])
  const [logs, setLogs] = useState<CleanerLogRow[]>([])
  const [tasks, setTasks] = useState<TaskSelectionRow[]>([])
  const [photos, setPhotos] = useState<TaskPhotoRow[]>([])
  const [search, setSearch] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [activePhotoIndex, setActivePhotoIndex] = useState<number | null>(null)
  const [photoList, setPhotoList] = useState<TaskPhotoRow[]>([])
  const [photoTaskName, setPhotoTaskName] = useState<string>('')
  const [photoTaskDate, setPhotoTaskDate] = useState<string>('')
  const [photoFeedbackMap, setPhotoFeedbackMap] = useState<Record<number, 'up' | 'down' | null>>({})
  const [isSavingFeedback, setIsSavingFeedback] = useState(false)
  const [expandedAttendanceId, setExpandedAttendanceId] = useState<number | null>(null)
  const [assistRequests, setAssistRequests] = useState<BathroomAssistRequest[]>([])

  useEffect(() => {
    if (activePhotoIndex !== null) {
      const originalOverflow = document.body.style.overflow
      const originalRootOverflow = document.documentElement.style.overflow
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = originalOverflow
        document.documentElement.style.overflow = originalRootOverflow
      }
    }
  }, [activePhotoIndex])

  useEffect(() => {
    const loadCleaners = async () => {
      setIsListLoading(true)

      try {
        const cleanerIds = await fetchManagerCleanerIds(managerId)
        const cleanerRoster = cleanerIds.length
          ? await fetchCleanersByIds(cleanerIds)
          : await fetchAllCleaners()

        let trackingRows: any[] | null = []
        let trackingError: any = null

        if (cleanerIds.length) {
          const trackingResponse = await supabase
            .from('live_tracking')
            .select('id, cleaner_id, cleaner_name, site_area, site_id, customer_name, event_type, timestamp, updated_at, created_at, is_active')
            .in('cleaner_id', cleanerIds)
            .order('timestamp', { ascending: false })

          trackingRows = trackingResponse.data
          trackingError = trackingResponse.error
        } else {
          const trackingResponse = await supabase
            .from('live_tracking')
            .select('id, cleaner_id, cleaner_name, site_area, site_id, customer_name, event_type, timestamp, updated_at, created_at, is_active')
            .order('timestamp', { ascending: false })

          trackingRows = trackingResponse.data
          trackingError = trackingResponse.error
        }

        if (trackingError) {
          console.warn('Failed to load live_tracking data', trackingError)
        }

        const cleanerMap = new Map<string, CleanerListItem>()

        ;(trackingRows ?? []).forEach((row) => {
          const key = row.cleaner_id || row.id
          const cleanerNameRaw = row.cleaner_name ?? (() => {
            const rosterMatch = cleanerRoster.find((cleaner) => cleaner.id === row.cleaner_id)
            if (!rosterMatch) return ''
            return `${rosterMatch.first_name ?? ''} ${rosterMatch.last_name ?? ''}`.trim()
          })()

          const cleanerName = normalizeCleanerName(cleanerNameRaw)

          if (!key || !cleanerName) return

          const rowTimestamp = row.timestamp || row.updated_at || row.created_at || new Date().toISOString()
          const existing = cleanerMap.get(key)
          if (!existing) {
            cleanerMap.set(key, {
              id: row.id || key,
              cleaner_id: row.cleaner_id || key,
              cleaner_name: cleanerName,
              cleaner_name_normalized: cleanerName,
              customer_name: row.customer_name || null,
              site_area: row.site_area || null,
              site_id: row.site_id || null,
              event_type: row.event_type || null,
              timestamp: rowTimestamp,
              is_active: row.is_active ?? true
            })
          } else {
            const existingTime = new Date(existing.timestamp).getTime()
            const rowTime = new Date(rowTimestamp).getTime()
            if (!Number.isNaN(rowTime) && (Number.isNaN(existingTime) || rowTime > existingTime)) {
              existing.timestamp = rowTimestamp
              existing.customer_name = row.customer_name || existing.customer_name
              existing.site_area = row.site_area || existing.site_area
              existing.site_id = row.site_id || existing.site_id
              existing.event_type = row.event_type || existing.event_type
              existing.is_active = row.is_active ?? existing.is_active
              existing.cleaner_name = cleanerName
              existing.cleaner_name_normalized = cleanerName
            }
            cleanerMap.set(key, existing)
          }
        })

        cleanerRoster.forEach((row) => {
          const name = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'Cleaner'
          const normalizedName = normalizeCleanerName(name)
          if (!cleanerMap.has(row.id)) {
            cleanerMap.set(row.id, {
              id: row.id,
              cleaner_id: row.id,
              cleaner_name: normalizedName,
              cleaner_name_normalized: normalizedName,
              customer_name: null,
              site_area: null,
              site_id: null,
              event_type: null,
              timestamp: row.created_at || new Date().toISOString(),
              is_active: row.is_active ?? false
            })
          }
        })

        const dedupedList = Array.from(cleanerMap.values()).sort((a, b) => a.cleaner_name.localeCompare(b.cleaner_name))

        setCleaners(dedupedList)
        setSelectedCleaner((prev) => {
          if (!dedupedList.length) return null
          if (prev) {
            const match = dedupedList.find((cleaner) => cleaner.cleaner_id === prev.cleaner_id)
            if (match) return match
          }
          return dedupedList[0] ?? null
        })
      } catch (error) {
        console.error('Failed to load cleaners for manager', error)
        setCleaners([])
        setSelectedCleaner(null)
      } finally {
        setIsListLoading(false)
      }
    }

    loadCleaners()
    AssistRequestService.listResolved({ limit: 12 }).then(setAssistRequests).catch((error) => {
      console.error('Failed to load bathroom assist summary', error)
      setAssistRequests([])
    })
  }, [managerId])

  useEffect(() => {
    if (!selectedCleaner) return

    const loadDetail = async () => {
      setIsDetailLoading(true)
      setExpandedAttendanceId(null)
      const cleanerName = normalizeCleanerName(selectedCleaner.cleaner_name)
      const nameTokens = Array.from(new Set(cleanerName.split(' ').filter(Boolean)))
      const shouldRunFuzzyAttendance = nameTokens.length > 1
      const cleanerId = selectedCleaner.cleaner_id
      const targetManagerId = 'df0bf2e7-1a07-4876-949c-6cfe8fe0fac6'
      const isAvtradeManager = managerId === targetManagerId
      const matchesAvtrade = (value: string | null | undefined) =>
        value ? value.toLowerCase().includes('avtrade') : false

      const attendanceExactQuery = supabase
        .from('time_attendance')
        .select('*')
        .eq('cleaner_name', cleanerName)
        .order('clock_in', { ascending: false })
        .limit(60)

      const attendanceFuzzyQuery = shouldRunFuzzyAttendance
        ? supabase
            .from('time_attendance')
            .select('*')
            .ilike('cleaner_name', `%${nameTokens.join('%')}%`)
            .order('clock_in', { ascending: false })
            .limit(60)
        : null

      if (isAvtradeManager) {
        attendanceExactQuery.or('customer_name.ilike.%avtrade%,site_name.ilike.%avtrade%')
        attendanceFuzzyQuery?.or('customer_name.ilike.%avtrade%,site_name.ilike.%avtrade%')
      }

      const logsQuery = supabase
        .from('uk_cleaner_logs')
        .select('*')
        .or(`cleaner_id.eq.${cleanerId},cleaner_name.eq.${cleanerName}`)
        .order('timestamp', { ascending: false })
        .limit(120)
      if (isAvtradeManager) {
        logsQuery.like('customer_name', '%avtrade%')
      }

      const tasksQuery = supabase
        .from('uk_cleaner_task_selections')
        .select('*')
        .or(`cleaner_id.eq.${cleanerId},cleaner_name.eq.${cleanerName}`)
        .order('timestamp', { ascending: false })
        .limit(80)

      const photosQuery = supabase
        .from('uk_cleaner_task_photos')
        .select('*')
        .eq('cleaner_id', selectedCleaner.cleaner_id)
        .order('photo_timestamp', { ascending: false })
        .limit(80)

      if (isAvtradeManager) {
        logsQuery.or('site_area.ilike.%avtrade%,comments.ilike.%avtrade%')
        tasksQuery.or('area_type.ilike.%avtrade%,qr_code_id.ilike.%avtrade%')
        photosQuery.or('area_type.ilike.%avtrade%,qr_code_id.ilike.%avtrade%')
      }

      const [logsPromise, tasksPromise, photosPromise] = [logsQuery, tasksQuery, photosQuery]

      const attendanceExactRes = await attendanceExactQuery
      if (attendanceExactRes?.error) {
        console.warn('Attendance load failed', attendanceExactRes.error)
      }

      const shouldRunFuzzyQuery = shouldRunFuzzyAttendance && !(attendanceExactRes?.data?.length)
      const attendanceFuzzyRes = shouldRunFuzzyQuery && attendanceFuzzyQuery ? await attendanceFuzzyQuery : null
      if (attendanceFuzzyRes?.error) {
        console.warn('Attendance fuzzy load failed', attendanceFuzzyRes.error)
      }

      const [logsRes, tasksRes, photosRes] = await Promise.all([logsPromise, tasksPromise, photosPromise])

      if (logsRes?.error) console.warn('Logs load failed', logsRes.error)
      if (tasksRes?.error) console.warn('Tasks load failed', tasksRes.error)
      if (photosRes?.error) console.warn('Photos load failed', photosRes.error)

      const rawTaskRows = tasksRes?.data ?? []
      const rawPhotoRows = photosRes?.data ?? []

      const qrCodeIds = Array.from(
        new Set(
          [
            ...rawTaskRows.map((row) => row.qr_code_id).filter((id): id is string => Boolean(id)),
            ...rawPhotoRows.map((row) => row.qr_code_id).filter((id): id is string => Boolean(id)),
          ],
        ),
      )

      type QRMetaRow = {
        qr_code_id: string
        building_area?: string | null
        customer_name?: string | null
        area_description?: string | null
      }

      const qrMetadata = new Map<string, { area: string | null; customer: string | null }>()

      if (qrCodeIds.length) {
        const { data: qrRows, error: qrError } = await supabase
          .from('building_qr_codes')
          .select('qr_code_id, building_area, customer_name, area_description')
          .in('qr_code_id', qrCodeIds)

        if (qrError) {
          console.warn('Failed to load QR metadata for manager detail view', qrError)
        } else {
          ;(qrRows ?? []).forEach((row: QRMetaRow) => {
            if (!row?.qr_code_id) return
            const areaLabel = row.building_area?.trim() || row.area_description?.trim() || null
            const customerLabel = row.customer_name?.trim() || null
            qrMetadata.set(row.qr_code_id, {
              area: areaLabel,
              customer: customerLabel,
            })
          })
        }
      }

      const tasksWithMetadata: TaskSelectionRow[] = rawTaskRows.map((row) => {
        const meta = row.qr_code_id ? qrMetadata.get(row.qr_code_id) : undefined
        const areaLabel = resolveAreaDisplayLabel(meta?.area, row.area_name, row.area_type)
        const customerLabel = resolveCustomerDisplayLabel(meta?.customer, row.customer_name)
        return {
          ...row,
          area_name: areaLabel,
          customer_name: customerLabel,
        }
      })

      const photosWithMetadata: TaskPhotoRow[] = rawPhotoRows.map((row) => {
        const meta = row.qr_code_id ? qrMetadata.get(row.qr_code_id) : undefined
        const areaLabel = resolveAreaDisplayLabel(meta?.area, row.area_name, row.area_type)
        const customerLabel = resolveCustomerDisplayLabel(meta?.customer, row.customer_name)
        return {
          ...row,
          area_name: areaLabel,
          customer_name: customerLabel,
        }
      })

      const attendanceByKey = new Map<string, AttendanceRow>()
      const combineRows = (rows?: AttendanceRow[] | null) => {
        if (!rows) return
        rows.forEach((row) => {
          const normalizedRowName = normalizeCleanerName(row.cleaner_name)
          const clockInKey = row.clock_in ? Math.floor(new Date(row.clock_in).getTime() / 1000) : null
          const clockOutKey = row.clock_out ? Math.floor(new Date(row.clock_out).getTime() / 1000) : null
          const siteKey = (row.site_name || row.customer_name || '').trim().toLowerCase()
          const comboKey = [clockInKey ?? 'null', clockOutKey ?? 'null', siteKey].join('::')
          const existing = attendanceByKey.get(comboKey)
          const shouldReplace = !existing || (row.id ?? 0) > (existing.id ?? 0)
          if (shouldReplace) {
            attendanceByKey.set(comboKey, { ...row, cleaner_name: normalizedRowName })
          }
        })
      }

      combineRows(attendanceExactRes?.data ?? [])
      if (attendanceFuzzyRes?.data) {
        combineRows(attendanceFuzzyRes.data)
      }

      setAttendance(Array.from(attendanceByKey.values()))
      setLogs(logsRes?.data ?? [])
      setTasks(tasksWithMetadata)
      const photoRows = photosWithMetadata
      setPhotos(photoRows)

      // fetch feedback for these photos
      if (photoRows.length) {
        const { data: feedbackRows, error: feedbackError } = await supabase
          .from('manager_photo_feedback')
          .select('photo_id, feedback')
          .eq('manager_id', managerId)
          .in('photo_id', photoRows.map((photo) => photo.id))

        if (feedbackError) {
          console.warn('Failed to load photo feedback', feedbackError)
        } else {
          const feedbackMap: Record<number, 'up' | 'down'> = {}
          feedbackRows?.forEach((row) => {
            feedbackMap[row.photo_id] = row.feedback as 'up' | 'down'
          })
          setPhotoFeedbackMap(feedbackMap)
        }
      } else {
        setPhotoFeedbackMap({})
      }
      setIsDetailLoading(false)
    }

    loadDetail()
  }, [selectedCleaner])

  const filteredCleaners = useMemo(() => {
    if (!search.trim()) return cleaners
    const query = search.trim().toLowerCase()
    return cleaners.filter((cleaner) => cleaner.cleaner_name.toLowerCase().includes(query))
  }, [cleaners, search])

  const attendanceDisplayRows = useMemo(() => {
    const sorted = [...attendance].sort((a, b) => {
      const aTime = a.clock_in ? new Date(a.clock_in).getTime() : Number.NEGATIVE_INFINITY
      const bTime = b.clock_in ? new Date(b.clock_in).getTime() : Number.NEGATIVE_INFINITY
      return bTime - aTime
    })

    const activeEntries = sorted.filter((row) => row.clock_in && !row.clock_out)
    const completedEntries = sorted.filter((row) => row.clock_in && row.clock_out)
    const otherEntries = sorted.filter((row) => !row.clock_in && row.clock_out)

    return [...activeEntries, ...completedEntries, ...otherEntries]
  }, [attendance])

  const selectedAttendancePreview = useMemo(() => attendanceDisplayRows.slice(0, 8), [attendanceDisplayRows])
  const selectedLogsPreview = useMemo(() => logs.slice(0, 15), [logs])

  const todayKey = useMemo(() => new Date().toDateString(), [])

  const todaysTasks = useMemo(() => tasks.filter((task) => task.timestamp && new Date(task.timestamp).toDateString() === todayKey), [tasks, todayKey])
  const todaysPhotos = useMemo(() => photos.filter((photo) => photo.photo_timestamp && new Date(photo.photo_timestamp).toDateString() === todayKey), [photos, todayKey])
  const todaysAttendance = useMemo(
    () => attendance.filter((row) => (row.clock_in && new Date(row.clock_in).toDateString() === todayKey) || (row.clock_out && new Date(row.clock_out).toDateString() === todayKey)),
    [attendance, todayKey]
  )

  const isPlaceholderLabel = (value?: string | null) => {
    if (!value) return false
    const normalized = value.trim().toLowerCase()
    return normalized === 'unknown site' || normalized === 'site'
  }

  const getAttendanceSiteLabel = (row: AttendanceRow) => {
    if (row.site_name && !isPlaceholderLabel(row.site_name)) {
      return row.site_name
    }
    if (row.customer_name && !isPlaceholderLabel(row.customer_name)) {
      return row.customer_name
    }
    return row.site_name || row.customer_name || 'Site'
  }

  const renderAttendanceCard = (row: AttendanceRow) => {
    const siteLabel = getAttendanceSiteLabel(row)
    const isCompleted = Boolean(row.clock_out)
    const isExpanded = expandedAttendanceId === row.id
    const clockInLabel = row.clock_in ? formatTime(row.clock_in) : '—'
    const clockOutLabel = row.clock_out ? formatTime(row.clock_out) : '—'
    const dateLabel = formatDate(row.clock_out ?? row.clock_in)

    const toggleExpanded = () => {
      if (!isCompleted) return
      setExpandedAttendanceId(isExpanded ? null : row.id)
    }

    return (
      <div key={row.id} className="space-y-2">
        <div
          className={`rounded-[32px] border border-gray-200 bg-gray-100 px-6 py-5 transition ${
            isCompleted ? 'cursor-pointer hover:border-gray-300 hover:bg-gray-100/90' : ''
          }`}
          onClick={toggleExpanded}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">{siteLabel}</p>
              <div className="flex items-center gap-6 text-sm text-gray-900">
                <div className="text-left">
                  <p className="font-semibold leading-tight">Clocked in</p>
                  <p className="text-gray-600 leading-tight">{clockInLabel}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-500" />
                <div className="text-left">
                  <p className="font-semibold leading-tight">{isCompleted ? 'Clocked out' : 'On site'}</p>
                  <p className="text-gray-600 leading-tight">{isCompleted ? clockOutLabel : '—'}</p>
                </div>
              </div>
              <p className="text-xs text-gray-500">{dateLabel}</p>
            </div>
            {isCompleted ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  toggleExpanded()
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-600 transition hover:bg-gray-50"
                aria-expanded={isExpanded}
                aria-label="Toggle attendance details"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400">
                <ArrowRight className="h-4 w-4" />
              </div>
            )}
          </div>
        </div>

        {isCompleted && isExpanded && (
          <div className="space-y-2 pl-4 sm:pl-8">
            <div className="flex items-center justify-between gap-4 rounded-[28px] border border-gray-200 bg-gray-100 px-5 py-4">
              <div className="flex items-center gap-4 text-sm text-gray-900">
                <div className="text-left">
                  <p className="font-semibold leading-tight">Clocked in</p>
                  <p className="text-gray-600 leading-tight">{clockInLabel}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-500" />
                <div className="text-left">
                  <p className="font-semibold leading-tight">On site</p>
                  <p className="text-gray-600 leading-tight">—</p>
                </div>
              </div>
              <span className="text-xs text-gray-500">{dateLabel}</span>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-[28px] border border-gray-200 bg-gray-100 px-5 py-4">
              <div className="flex items-center gap-4 text-sm text-gray-900">
                <div className="text-left">
                  <p className="font-semibold leading-tight">On site</p>
                  <p className="text-gray-600 leading-tight">—</p>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-500" />
                <div className="text-left">
                  <p className="font-semibold leading-tight">Clocked out</p>
                  <p className="text-gray-600 leading-tight">{clockOutLabel}</p>
                </div>
              </div>
              <span className="text-xs text-gray-500">{dateLabel}</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  const taskSummaries = useMemo(() => (
    todaysTasks.map((row) => {
      const selected = JSON.parse(row.selected_tasks || '[]') as string[]
      const completed = JSON.parse(row.completed_tasks || '[]') as string[]
      const areaLabel = resolveAreaDisplayLabel(row.area_name, row.area_type)
      return {
        id: row.id,
        area: areaLabel,
        total: selected.length,
        completed: completed.length,
        timestamp: row.timestamp
      }
    })
  ), [todaysTasks])

  const taskPhotoGroups = useMemo(() => {
    if (!photos.length) return []

    const groups = new Map<string, TaskPhotoGroup>()

    photos.forEach((photo) => {
      const resolvedAreaLabel = resolveAreaDisplayLabel(photo.area_name, photo.area_type)
      const resolvedCustomerLabel = resolveCustomerDisplayLabel(photo.customer_name)
      const { key: computedAreaKey, label: areaLabel, customer: areaCustomer } = deriveAreaIdentity({
        ...photo,
        area_name: resolvedAreaLabel,
        customer_name: resolvedCustomerLabel ?? undefined,
      })
      const areaTypeTasks = photo.area_type ? AREA_TASKS[photo.area_type as keyof typeof AREA_TASKS] ?? [] : []
      const matchedTask = areaTypeTasks.find((task) => task.id === photo.task_id)
      const taskName = matchedTask?.name || 'Task'
      const category = photo.area_type || matchedTask?.category || null

      const dateKey = buildPhotoDateKey(photo)
      const areaSessionAnchor = buildSessionAnchor(photo.started_at) || dateKey
      const taskIdentifier = [photo.qr_code_id, photo.task_id, dateKey, areaSessionAnchor, computedAreaKey]
        .filter(Boolean)
        .join('::')
      const fallbackTaskKey = `fallback-${photo.area_type || 'area'}-${photo.task_id || 'task'}-${photo.id}`
      const groupKey = taskIdentifier || fallbackTaskKey

      if (!groups.has(groupKey)) {
        const startedAt = photo.started_at || photo.photo_timestamp || null
        const latestAt = photo.photo_timestamp || photo.started_at || null
        groups.set(groupKey, {
          key: groupKey,
          taskId: photo.task_id ?? null,
          taskName,
          category,
          startedAt,
          startedTimestamp: toTimestamp(startedAt),
          latestAt,
          latestTimestamp: parseTimestamp(latestAt) ?? Number.NEGATIVE_INFINITY,
          area: areaLabel,
          areaKey: computedAreaKey,
          customer: areaCustomer,
          dateKey,
          photos: [],
        })
      }

      const group = groups.get(groupKey)
      if (!group) return

      group.photos.push(photo)

      if (!group.area && areaLabel) {
        group.area = areaLabel
      }
      if (!group.customer && areaCustomer) {
        group.customer = areaCustomer
      }
      if (!group.category && category) {
        group.category = category
      }
      if (!group.areaKey && computedAreaKey) {
        group.areaKey = computedAreaKey
      }

      const candidateStart = photo.started_at || photo.photo_timestamp || null
      const candidateTimestamp = toTimestamp(candidateStart)
      const candidateLatest = parseTimestamp(photo.photo_timestamp || photo.started_at || null)

      if (candidateTimestamp < group.startedTimestamp) {
        group.startedAt = candidateStart
        group.startedTimestamp = candidateTimestamp
      }
      if (candidateLatest !== null && candidateLatest > group.latestTimestamp) {
        group.latestAt = photo.photo_timestamp || photo.started_at || null
        group.latestTimestamp = candidateLatest
      }
    })

    return Array.from(groups.values())
      .map((group) => {
        const normalizedStart = group.startedAt || group.photos[0]?.photo_timestamp || null
        const normalizedLatest = group.latestAt || group.photos[group.photos.length - 1]?.photo_timestamp || null
        const normalizedAreaKey = group.areaKey || (() => {
          const samplePhoto = group.photos[0]
          if (!samplePhoto) return 'unassigned-area'
          return deriveAreaIdentity(samplePhoto).key
        })()

        return {
          ...group,
          startedAt: normalizedStart,
          startedTimestamp: toTimestamp(normalizedStart),
          latestAt: normalizedLatest,
          latestTimestamp: parseTimestamp(normalizedLatest) ?? Number.NEGATIVE_INFINITY,
          areaKey: normalizedAreaKey,
          photos: [...group.photos].sort((a, b) => toTimestamp(a.photo_timestamp) - toTimestamp(b.photo_timestamp)),
        }
      })
      .sort((a, b) => b.latestTimestamp - a.latestTimestamp)
  }, [photos])

  const areaPhotoGroups = useMemo(() => {
    if (!taskPhotoGroups.length) return []

    const areas = new Map<string, AreaPhotoGroup>()

    taskPhotoGroups.forEach((task) => {
      const baseAreaKey = task.areaKey || 'unassigned-area'
      const dateKey = task.dateKey || 'unknown-date'
      const areaGroupKey = `${baseAreaKey}::${dateKey}`
      const areaName = resolveAreaDisplayLabel(task.area)
      const areaCustomer = resolveCustomerDisplayLabel(task.customer)
      const areaCategory = task.category

      if (!areas.has(areaGroupKey)) {
        areas.set(areaGroupKey, {
          key: areaGroupKey,
          areaKey: baseAreaKey,
          area: areaName,
          category: areaCategory,
          customer: areaCustomer,
          dateKey,
          dateLabel: formatDateLabelFromKey(dateKey),
          startedTimestamp: task.startedTimestamp,
          latestAt: task.latestAt,
          latestTimestamp: task.latestTimestamp,
          tasks: [],
        })
      }

      const areaGroup = areas.get(areaGroupKey)
      if (!areaGroup) return

      if (!areaGroup.category && areaCategory) {
        areaGroup.category = areaCategory
      }
      if (!areaGroup.customer && areaCustomer) {
        areaGroup.customer = areaCustomer
      }

      areaGroup.tasks.push(task)

      if (task.startedTimestamp < areaGroup.startedTimestamp) {
        areaGroup.startedTimestamp = task.startedTimestamp
      }

      const currentLatestTimestamp = areaGroup.latestTimestamp ?? Number.NEGATIVE_INFINITY
      if (task.latestTimestamp > currentLatestTimestamp) {
        areaGroup.latestTimestamp = task.latestTimestamp
        areaGroup.latestAt = task.latestAt
      }
    })

    return Array.from(areas.values())
      .map((area) => ({
        ...area,
        tasks: [...area.tasks].sort((a, b) => b.latestTimestamp - a.latestTimestamp),
      }))
      .sort((a, b) => (b.latestTimestamp ?? Number.NEGATIVE_INFINITY) - (a.latestTimestamp ?? Number.NEGATIVE_INFINITY))
  }, [taskPhotoGroups])

  const assistCards = useMemo(() => assistRequests.map((request) => ({
    id: request.id,
    location: request.location_label,
    customer: request.customer_name,
    reportedAt: request.reported_at,
    acceptedAt: request.accepted_at,
    resolvedAt: request.resolved_at,
    status: request.status,
    notes: request.notes,
    materials: request.materials_used,
    handledBy: request.resolved_by_name || request.accepted_by_name || 'Cleaner',
    beforeMedia: Array.isArray(request.before_media) ? request.before_media : [],
    afterMedia: Array.isArray(request.after_media) ? request.after_media : [],
    escalated: request.status === 'escalated'
  })), [assistRequests])

  const areasToday = taskSummaries.length
  const photosCount = todaysPhotos.length
  const recordsCount = todaysAttendance.length

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const openPhotoModal = (groupPhotos: TaskPhotoRow[], index: number, taskName?: string, taskDate?: string | null) => {
    setPhotoList(groupPhotos)
    setActivePhotoIndex(index)
    setPhotoTaskName(taskName ?? '')
    setPhotoTaskDate(taskDate ?? '')
  }

  const closePhotoModal = () => {
    setActivePhotoIndex(null)
    setPhotoList([])
    setPhotoTaskName('')
    setPhotoTaskDate('')
  }

  const goToPhoto = (direction: 1 | -1) => {
    if (activePhotoIndex === null || !photoList.length) return
    let nextIndex = activePhotoIndex + direction
    if (nextIndex < 0) nextIndex = photoList.length - 1
    if (nextIndex >= photoList.length) nextIndex = 0
    setActivePhotoIndex(nextIndex)
  }

  const currentPhoto = activePhotoIndex !== null ? photoList[activePhotoIndex] : null

  const feedbackForPhoto = currentPhoto ? photoFeedbackMap[currentPhoto.id] ?? null : null

  const handleFeedback = async (photo: TaskPhotoRow, feedback: 'up' | 'down') => {
    if (isSavingFeedback) return
    setIsSavingFeedback(true)
    try {
      const nextFeedback = feedbackForPhoto === feedback ? null : feedback
      if (nextFeedback) {
        const { error } = await supabase
          .from('manager_photo_feedback')
          .upsert({
            manager_id: managerId,
            photo_id: photo.id,
            feedback: nextFeedback
          })
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('manager_photo_feedback')
          .delete()
          .eq('manager_id', managerId)
          .eq('photo_id', photo.id)
        if (error) throw error
      }

      setPhotoFeedbackMap((prev) => ({ ...prev, [photo.id]: nextFeedback }))
    } catch (error) {
      console.error('Failed to save feedback', error)
    } finally {
      setIsSavingFeedback(false)
    }
  }

  if (isListLoading) {
    return (
      <div className="flex justify-center items-center min-h-64">
        <div className="h-10 w-10 border-2 border-[#00339B] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto p-6 lg:p-10 space-y-6">
        <div>
        <h1 className="text-3xl font-semibold text-[#00339B]">Team Activity</h1>
        <p className="text-sm text-gray-500">Welcome back, {managerName}</p>
      </div>

      <Card className="rounded-3xl border border-gray-100 bg-white shadow-sm">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <CardTitle className="flex items-center gap-3 text-lg font-semibold text-gray-900">
            <div className="h-11 w-11 rounded-2xl bg-blue-100 flex items-center justify-center">
              <Users className="h-5 w-5" style={{ color: '#00339B' }} />
            </div>
            <span>Cleaners</span>
          </CardTitle>
          <div className="flex w-full md:w-80 items-center gap-2 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-2">
            <Search className="h-4 w-4 text-gray-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search cleaners..."
              className="h-8 border-0 bg-transparent px-0 text-sm focus-visible:ring-0"
            />
          </div>
          <div className="grid grid-cols-3 gap-3 w-full md:w-auto">
            <Card className="rounded-2xl border border-gray-100 shadow-none bg-blue-50/70">
              <CardContent className="py-3 px-4">
                <p className="text-[11px] uppercase tracking-wide text-blue-600">Areas Today</p>
                <p className="text-lg font-semibold text-[#00339B]">{areasToday}</p>
          </CardContent>
        </Card>
            <Card className="rounded-2xl border border-gray-100 shadow-none bg-emerald-50/70">
              <CardContent className="py-3 px-4">
                <p className="text-[11px] uppercase tracking-wide text-emerald-600">Photos</p>
                <p className="text-lg font-semibold text-emerald-700">{photosCount}</p>
          </CardContent>
        </Card>
            <Card className="rounded-2xl border border-gray-100 shadow-none bg-slate-50/70">
              <CardContent className="py-3 px-4">
                <p className="text-[11px] uppercase tracking-wide text-slate-600">Records</p>
                <p className="text-lg font-semibold text-slate-700">{recordsCount}</p>
          </CardContent>
        </Card>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            {filteredCleaners.map((cleaner) => (
              <button
                key={cleaner.cleaner_id || cleaner.id}
                onClick={() => setSelectedCleaner(cleaner)}
                className={`rounded-2xl border ${selectedCleaner?.cleaner_id === cleaner.cleaner_id ? 'border-[#00339B] shadow-md' : 'border-gray-100 shadow-sm'} bg-white transition-all text-left p-4 flex items-center gap-4 hover:shadow-md`}
              >
                <div className={`h-11 w-11 rounded-2xl flex items-center justify-center text-white text-xs font-semibold ${getStatusColor(cleaner.event_type)}`}>
                  {(cleaner.event_type || 'ACTIVE').slice(0, 3).toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-gray-900">{cleaner.cleaner_name}</p>
                  <p className="text-xs text-gray-500">{cleaner.site_area || 'No area logged'}</p>
                </div>
                <div className="text-[11px] text-gray-400 whitespace-nowrap">
                  {formatTime(cleaner.timestamp)}
                </div>
              </button>
            ))}
            </div>
          {filteredCleaners.length === 0 && (
            <div className="text-center text-sm text-gray-500 py-8 rounded-2xl border border-dashed">No cleaners found. Adjust your search.</div>
          )}
          </CardContent>
        </Card>

      {selectedCleaner && (
        <Card className="rounded-3xl border border-gray-100 bg-white shadow-lg">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setSelectedCleaner(null)} className="rounded-full border border-gray-200">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <CardTitle className="text-xl font-semibold text-gray-900">{selectedCleaner.cleaner_name}</CardTitle>
                <p className="text-xs text-gray-500">{selectedCleaner.customer_name || 'Customer'}</p>
              </div>
      </div>
          </CardHeader>
          <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
              <Card className="rounded-2xl border border-gray-100 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Time & Attendance</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                    {selectedAttendancePreview.map(renderAttendanceCard)}
                    {selectedAttendancePreview.length === 0 && (
                      <div className="text-xs text-gray-500">No attendance entries recorded.</div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border border-gray-100 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Areas & Tasks</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                    {taskSummaries.map((task) => (
                      <div key={task.id} className="p-3 border border-gray-100 rounded-xl">
                        <p className="text-sm font-semibold text-gray-900">{task.area}</p>
                        <p className="text-xs text-gray-500">{formatDateTime(task.timestamp)}</p>
                        <p className="text-xs text-gray-600 mt-1">Tasks completed: {task.completed}/{task.total}</p>
                      </div>
                    ))}
                    {taskSummaries.length === 0 && <div className="text-xs text-gray-500">No task submissions yet.</div>}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <ImageIcon className="h-4 w-4 text-[#00339B]" /> Task Photos
              </h3>
              {areaPhotoGroups.length === 0 ? (
                <div className="text-xs text-gray-500">No photos uploaded yet.</div>
              ) : (
                <div className="space-y-4">
                  {areaPhotoGroups.map((areaGroup) => {
                    const isAreaExpanded = expandedGroups[areaGroup.key] ?? true
                    return (
                      <div key={areaGroup.key} className="rounded-[32px] border border-transparent bg-transparent p-6">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-gray-500">
                              <MapPin className="h-3 w-3 text-[#00339B]" />
                              <span>{areaGroup.area}</span>
                              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#00339B] shadow-sm border border-[#00339B]/20">
                                {areaGroup.dateLabel}
                              </span>
                              {areaGroup.customer && (
                                <span className="rounded-full bg-[#fffbeb] px-2 py-0.5 text-[10px] font-semibold text-[#1f2937]">{areaGroup.customer}</span>
                              )}
                              <span className="rounded-full bg-[#e0e7ff] px-2 py-0.5 text-[10px] font-semibold text-[#1f2937]">
                                {areaGroup.tasks.reduce((sum, task) => sum + task.photos.length, 0)} photos
                              </span>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleGroup(areaGroup.key)}
                            className="rounded-full border border-gray-200 text-gray-600 hover:bg-white"
                            aria-label={isAreaExpanded ? 'Collapse area' : 'Expand area'}
                          >
                            <ChevronDown className={`h-4 w-4 transition-transform ${isAreaExpanded ? 'rotate-180' : ''}`} />
                          </Button>
                        </div>

                        <div className={`mt-5 overflow-hidden transition-all duration-300 ${isAreaExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {areaGroup.tasks.map((taskGroup) => {
                              const taskKey = `${areaGroup.key}::${taskGroup.key}`
                              const thumbnail = taskGroup.photos[0]
                              if (!thumbnail) return null

                              return (
                                <button
                                  key={taskKey}
                                  onClick={() => openPhotoModal(taskGroup.photos, 0, taskGroup.taskName, taskGroup.startedAt)}
                                  className="group relative aspect-square w-full overflow-hidden rounded-[28px] border border-white/70 bg-white/60 shadow-[0_16px_34px_rgba(15,35,95,0.06)] transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_50px_rgba(15,35,95,0.12)]"
                                  aria-label={`View photo for ${taskGroup.taskName}`}
                                >
                                  <img
                                    src={thumbnail.photo_data}
                                    alt={taskGroup.taskName}
                                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                                  />

                                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0f235f]/90 via-[#0f235f]/40 to-transparent p-4 text-white">
                                    <h4 className="text-sm font-semibold leading-tight line-clamp-2">{taskGroup.taskName}</h4>
                                    <div className="mt-2 flex items-center justify-between text-[11px] text-white/80">
                                      <span className="flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        {thumbnail.photo_timestamp ? formatDateTime(thumbnail.photo_timestamp) : 'Time not recorded'}
                                      </span>
                                      <span className="rounded-full border border-white/30 px-2 py-0.5">View</span>
                                    </div>
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <Card className="rounded-2xl border border-gray-100 shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                  {selectedLogsPreview.map((log) => (
                    <div key={log.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                      <div className={`h-9 w-9 rounded-xl flex items-center justify-center text-white text-[10px] font-semibold ${getStatusColor(log.action)}`}>
                        {log.action.slice(0, 3).toUpperCase()}
                        </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{log.action}</p>
                        <p className="text-xs text-gray-500">{log.site_area || '—'}</p>
                        <p className="text-xs text-gray-400 mt-1">{formatDateTime(log.timestamp)}</p>
                      </div>
                    </div>
                  ))}
                  {selectedLogsPreview.length === 0 && <div className="text-xs text-gray-500">No recent actions recorded.</div>}
                </div>
              </CardContent>
            </Card>
                    </CardContent>
                  </Card>
      )}

      {currentPhoto &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6">
            <div className="relative w-full max-w-4xl rounded-[32px] border border-[#d9e3ff] bg-[#f6f8ff] shadow-[0_35px_80px_rgba(0,0,0,0.25)] p-6 sm:p-8">
              <button
                onClick={closePhotoModal}
                className="absolute -right-3 -top-3 z-30 rounded-full border border-[#d9e3ff] bg-white p-2 shadow-sm hover:bg-gray-50"
                aria-label="Close photo viewer"
              >
                <X className="h-5 w-5 text-gray-600" />
              </button>

              <div className="relative rounded-[24px] border border-[#d9e3ff] bg-white overflow-hidden">
                <img src={currentPhoto.photo_data} alt="task" className="w-full max-h-[68vh] object-contain" />

                <button
                  onClick={() => goToPhoto(-1)}
                  className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full border border-[#d9e3ff] bg-white p-3 shadow-sm transition hover:bg-gray-50"
                  aria-label="Previous photo"
                >
                  <ChevronLeft className="h-5 w-5 text-gray-600" />
                </button>

                <button
                  onClick={() => goToPhoto(1)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full border border-[#d9e3ff] bg-white p-3 shadow-sm transition hover:bg-gray-50"
                  aria-label="Next photo"
                >
                  <ChevronRight className="h-5 w-5 text-gray-600" />
                </button>

                <div className="absolute top-5 left-5 rounded-full border border-[#d9e3ff] bg-white px-3 py-1 text-xs font-semibold text-gray-700 flex items-center gap-2 shadow-sm">
                  <ImageIcon className="h-4 w-4 text-[#00339B]" />
                  <span>{activePhotoIndex !== null ? `${activePhotoIndex + 1}/${photoList.length}` : ''}</span>
                </div>
                
                <div className="absolute bottom-7 left-1/2 -translate-x-1/2">
                  <div className="flex flex-col items-center gap-3 rounded-full border border-[#d9e3ff] bg-white px-6 py-3 shadow-sm sm:flex-row sm:flex-nowrap sm:items-center sm:gap-6">
                    {photoTaskName && (
                      <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                        <ImageIcon className="h-4 w-4 text-[#00339B]" />
                        <span className="whitespace-nowrap">{photoTaskName}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                      <Clock className="h-4 w-4 text-[#00339B]" />
                      {formatDateTime(photoTaskDate || currentPhoto.photo_timestamp)}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={isSavingFeedback}
                        onClick={() => currentPhoto && handleFeedback(currentPhoto, 'up')}
                        className={`rounded-full gap-2 px-5 font-semibold transition ${feedbackForPhoto === 'up' ? 'bg-[#00339B] hover:bg-[#00297a] text-white' : 'border border-[#00339B] bg-white text-[#00339B] hover:bg-[#00339B]/10'}`}
                      >
                        <ThumbsUp className="h-4 w-4" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        disabled={isSavingFeedback}
                        onClick={() => currentPhoto && handleFeedback(currentPhoto, 'down')}
                        className={`rounded-full gap-2 px-5 font-semibold transition ${feedbackForPhoto === 'down' ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'border border-rose-500 bg-white text-rose-600 hover:bg-rose-50'}`}
                      >
                        <ThumbsDown className="h-4 w-4" />
                        Revisit
                      </Button>
                      </div>
                  </div>
                  {isSavingFeedback && (
                    <div className="mt-2 text-center text-[11px] text-gray-500">Saving feedback...</div>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
