import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Image as ImageIcon, ArrowRight, Clock, MapPin, Search, ChevronDown, ChevronLeft, ChevronRight, ThumbsUp, ThumbsDown, X, CalendarDays, Trash2, Loader2 } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
  fetchAllCleaners,
  fetchCleanersByIds,
  fetchManagerCleanerIds,
  deleteCleaner,
  fetchManagerRecentActivity,
  type CleanerSummary,
  type ManagerActivityRow,
} from '../../services/managerService'
import { AREA_TASKS } from '../../services/qrService'
import { normalizeCleanerName } from '../../lib/identity'
import { cn, defaultAnalyticsRange, toIsoRange } from '../../lib/utils'
import { AssistRequestService } from '../../services/assistRequestService'
import type { BathroomAssistRequest } from '../../services/supabase'
import { fetchAnalyticsSummary, fetchDashboardSnapshot, type AnalyticsRole } from '../../services/analyticsService'
import { Badge } from '../ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Calendar } from '../ui/calendar'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '../ui/dialog'
import { HoursWorkedAreaChart } from '../analytics/HoursWorkedAreaChart'
import { SidebarTrigger } from '@/components/ui/sidebar'

interface ManagerDashboardProps {
  managerId: string
  managerName: string
  role: AnalyticsRole
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

type AssistStatusKey = BathroomAssistRequest['status'] | 'unknown'

const assistStatusBadgeClasses: Record<AssistStatusKey, string> = {
  pending: 'border border-amber-200 bg-amber-50 text-amber-700',
  accepted: 'border border-blue-200 bg-blue-50 text-[#00339B]',
  resolved: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
  escalated: 'border border-rose-200 bg-rose-50 text-rose-600',
  cancelled: 'border border-slate-200 bg-slate-50 text-slate-500',
  unknown: 'border border-slate-200 bg-slate-50 text-slate-500'
}

const assistAttentionContainerClasses: Record<AssistStatusKey, string> = {
  pending: 'border-amber-200 bg-amber-50/60',
  accepted: 'border-blue-200 bg-blue-50/60',
  resolved: 'border-emerald-200 bg-emerald-50/60',
  escalated: 'border-rose-200 bg-rose-50/60',
  cancelled: 'border-slate-200 bg-slate-50/60',
  unknown: 'border-slate-200 bg-slate-50/60'
}

const formatAssistStatus = (status?: BathroomAssistRequest['status'] | null) => {
  if (!status) return 'Unknown'
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

const getAssistStatusBadgeClasses = (status?: BathroomAssistRequest['status'] | null) =>
  assistStatusBadgeClasses[status ?? 'unknown'] ?? assistStatusBadgeClasses.unknown

const getAssistAttentionContainerClasses = (status?: BathroomAssistRequest['status'] | null) =>
  assistAttentionContainerClasses[status ?? 'unknown'] ?? assistAttentionContainerClasses.unknown

const formatTime = (iso: string | null, options?: Intl.DateTimeFormatOptions) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(options ?? {}) }) : '—'
const formatDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'
const formatTimeOnly = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—')
const calculateHoursBetween = (start?: string | null, end?: string | null, fallbackEnd?: Date | null) => {
  if (!start) return 0
  const startDate = new Date(start)
  const startTime = startDate.getTime()
  if (!Number.isFinite(startTime)) return 0

  let endDate: Date | null = null
  if (end) {
    const parsedEnd = new Date(end)
    if (Number.isFinite(parsedEnd.getTime())) {
      endDate = parsedEnd
    }
  }

  if (!endDate && fallbackEnd) {
    const fallbackTime = fallbackEnd.getTime()
    if (Number.isFinite(fallbackTime) && fallbackTime > startTime) {
      endDate = new Date(fallbackTime)
    }
  }

  if (!endDate) return 0

  const diff = endDate.getTime() - startTime
  if (!Number.isFinite(diff) || diff <= 0) return 0
  return diff / (1000 * 60 * 60)
}

const normalizeToStartOfDay = (date: Date) => {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}
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

export const ManagerDashboard: React.FC<ManagerDashboardProps> = ({ managerId, managerName, role }) => {
  const navigate = useNavigate()
  const [isListLoading, setIsListLoading] = useState(true)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [cleaners, setCleaners] = useState<CleanerListItem[]>([])
  const [selectedCleaner, setSelectedCleaner] = useState<CleanerListItem | null>(null)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [attendance, setAttendance] = useState<AttendanceRow[]>([])
  const [logs, setLogs] = useState<CleanerLogRow[]>([])
  const [tasks, setTasks] = useState<TaskSelectionRow[]>([])
  const [photos, setPhotos] = useState<TaskPhotoRow[]>([])
  const [dailyAttendance, setDailyAttendance] = useState<AttendanceRow[]>([])
  const [isDailyAttendanceLoading, setIsDailyAttendanceLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [activePhotoIndex, setActivePhotoIndex] = useState<number | null>(null)
  const [photoList, setPhotoList] = useState<TaskPhotoRow[]>([])
  const [photoTaskName, setPhotoTaskName] = useState<string>('')
  const [photoTaskDate, setPhotoTaskDate] = useState<string>('')
  const [photoFeedbackMap, setPhotoFeedbackMap] = useState<Record<number, 'up' | 'down' | null>>({})
  const [isSavingFeedback, setIsSavingFeedback] = useState(false)
  const [expandedAttendanceId, setExpandedAttendanceId] = useState<number | null>(null)
  const [assistActiveRequests, setAssistActiveRequests] = useState<BathroomAssistRequest[]>([])
  const [assistResolvedRequests, setAssistResolvedRequests] = useState<BathroomAssistRequest[]>([])
  const [assistRequestsError, setAssistRequestsError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date>(() => normalizeToStartOfDay(new Date()))
  const [isAutoDate, setIsAutoDate] = useState(true)
  const [now, setNow] = useState<Date>(() => new Date())
  const [todayRefreshKey, setTodayRefreshKey] = useState(0)
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null)
  const isGlobalRole = role === 'admin' || role === 'ops_manager'
  const isOpsManager = role === 'ops_manager'
  const overviewSubtitle = isOpsManager
    ? 'Monitor every cleaner, submission, and inspection across all sites.'
    : 'Oversee live cleaners, submissions, and assistance updates from your manager control centre.'
  const [globalActivity, setGlobalActivity] = useState<ManagerActivityRow[]>([])
  const [isGlobalActivityLoading, setIsGlobalActivityLoading] = useState(false)
  const [globalActivityError, setGlobalActivityError] = useState<string | null>(null)
  const scopedManagerId = isGlobalRole ? undefined : managerId
  const analyticsManagerId = isGlobalRole ? null : managerId

  const isSameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()

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
    if (typeof window === 'undefined') return
    const interval = window.setInterval(() => {
      setNow(new Date())
    }, 60_000)

    return () => {
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    const loadCleaners = async () => {
      setIsListLoading(true)

      try {
        const cleanerIds = scopedManagerId ? await fetchManagerCleanerIds(scopedManagerId) : []
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
        const rosterById = new Map(cleanerRoster.map((row) => [row.id, row]))
        const rosterByName = new Map(
          cleanerRoster
            .map((row) => {
              const fullName = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim()
              const normalized = normalizeCleanerName(fullName)
              return normalized ? [normalized.toLowerCase(), row] : null
            })
            .filter((entry): entry is [string, CleanerSummary] => Boolean(entry))
        )

        const resolveRosterMatchByName = (name: string | null | undefined) => {
          if (!name) return null
          const normalized = normalizeCleanerName(name)
          if (!normalized) return null
          return rosterByName.get(normalized.toLowerCase()) ?? null
        }

        ;(trackingRows ?? []).forEach((row) => {
          const cleanerNameRaw = row.cleaner_name ?? (() => {
            const rosterMatch = row.cleaner_id ? rosterById.get(row.cleaner_id) : null
            if (!rosterMatch) return ''
            return `${rosterMatch.first_name ?? ''} ${rosterMatch.last_name ?? ''}`.trim()
          })()

          const cleanerName = normalizeCleanerName(cleanerNameRaw)
          if (!cleanerName) return

          let resolvedCleanerId = ''
          if (row.cleaner_id !== null && row.cleaner_id !== undefined) {
            resolvedCleanerId = String(row.cleaner_id).trim()
          }

          if (!resolvedCleanerId) {
            const rosterMatch = resolveRosterMatchByName(row.cleaner_name)
            if (rosterMatch?.id) {
              resolvedCleanerId = rosterMatch.id
            }
          }

          if (!resolvedCleanerId) {
            const fallback = row.id ?? ''
            resolvedCleanerId = fallback ? String(fallback).trim() : ''
          }

          if (!resolvedCleanerId) return

          const key = resolvedCleanerId
          const rowTimestamp = row.timestamp || row.updated_at || row.created_at || new Date().toISOString()
          const existing = cleanerMap.get(key)
          if (!existing) {
            cleanerMap.set(key, {
              id: row.id ? String(row.id) : key,
              cleaner_id: key,
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

    const loadAssistRequests = async () => {
      try {
        const [active, resolved] = await Promise.all([
          AssistRequestService.listRecent({ statuses: ['pending', 'accepted', 'escalated'], limit: 8 }),
          AssistRequestService.listResolved({ limit: 8 })
        ])
        setAssistActiveRequests(active)
        setAssistResolvedRequests(resolved)
        setAssistRequestsError(null)
      } catch (error) {
        console.error('Failed to load bathroom assist summary', error)
        setAssistActiveRequests([])
        setAssistResolvedRequests([])
        setAssistRequestsError('Unable to load assistance updates right now.')
      }
    }

    loadAssistRequests()
  }, [managerId])

  useEffect(() => {
    if (!isAutoDate) return
    const todayStart = normalizeToStartOfDay(now)
    if (!isSameDay(selectedDate, todayStart)) {
      setSelectedDate(todayStart)
    }
  }, [isAutoDate, now, selectedDate])

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

  const managedCleanerIds = useMemo(() => {
    const ids = cleaners
      .map((cleaner) => cleaner.cleaner_id)
      .filter((id): id is string => Boolean(id))
      .map((id) => id.trim())
    return Array.from(new Set(ids))
  }, [cleaners])

  const managedCleanerNames = useMemo(() => {
    const names = cleaners
      .map((cleaner) => normalizeCleanerName(cleaner.cleaner_name))
      .filter((name): name is string => Boolean(name))
    return Array.from(new Set(names))
  }, [cleaners])

  const managedCleanerIdsKey = useMemo(() => managedCleanerIds.join('|'), [managedCleanerIds])
  const managedCleanerNamesKey = useMemo(() => managedCleanerNames.join('|'), [managedCleanerNames])

  useEffect(() => {
    const loadDailyAttendance = async () => {
      setIsDailyAttendanceLoading(true)

      try {
        const dayStart = normalizeToStartOfDay(selectedDate)
        const dayEnd = new Date(dayStart)
        dayEnd.setDate(dayEnd.getDate() + 1)

        const startIso = dayStart.toISOString()
        const endIso = dayEnd.toISOString()

        const selectColumns = 'id, cleaner_id, cleaner_uuid, cleaner_name, customer_name, site_name, clock_in, clock_out'

        let clockInQuery = supabase
          .from('time_attendance')
          .select(selectColumns)
          .gte('clock_in', startIso)
          .lt('clock_in', endIso)
          .order('clock_in', { ascending: false })

        let clockOutQuery = supabase
          .from('time_attendance')
          .select(selectColumns)
          .gte('clock_out', startIso)
          .lt('clock_out', endIso)
          .order('clock_out', { ascending: false })

        if (!isGlobalRole && managedCleanerIds.length) {
          clockInQuery = clockInQuery.in('cleaner_id', managedCleanerIds)
          clockOutQuery = clockOutQuery.in('cleaner_id', managedCleanerIds)
        }

        const [clockInRes, clockOutRes] = await Promise.all([clockInQuery, clockOutQuery])

        if (clockInRes.error) {
          throw clockInRes.error
        }

        if (clockOutRes.error) {
          throw clockOutRes.error
        }

        const allRows = [...(clockInRes.data ?? []), ...(clockOutRes.data ?? [])]

        const cleanerIdSet = new Set(managedCleanerIds.map(String))
        const cleanerNameSet = new Set(managedCleanerNames)

        const scopedRows = allRows.filter((row) => {
          if (isGlobalRole) return true

          const candidateId = row.cleaner_id ?? row.cleaner_uuid
          if (candidateId && cleanerIdSet.has(String(candidateId).trim())) {
            return true
          }

          const normalizedName = normalizeCleanerName(row.cleaner_name ?? '')
          if (normalizedName && cleanerNameSet.has(normalizedName)) {
            return true
          }

          return false
        })

        const attendanceMap = new Map<string, AttendanceRow>()

        const getRowKey = (row: AttendanceRow & { cleaner_uuid?: string | null }) => {
          if (row.id !== null && row.id !== undefined) {
            return `id::${row.id}`
          }

          const cleanerIdentity = row.cleaner_uuid ?? row.cleaner_id ?? row.cleaner_name
          const clockInKey = row.clock_in ? new Date(row.clock_in).getTime() : 'no-clock-in'
          return `fallback::${cleanerIdentity ?? 'unknown'}::${clockInKey}`
        }

        scopedRows.forEach((row) => {
          const cleanerName = normalizeCleanerName(row.cleaner_name ?? 'Cleaner')
          const parsedCleanerId = (() => {
            if (typeof row.cleaner_id === 'number') return row.cleaner_id
            if (row.cleaner_id === null || row.cleaner_id === undefined) return null
            const numeric = Number.parseInt(String(row.cleaner_id), 10)
            return Number.isNaN(numeric) ? null : numeric
          })()

          const baseRecord: AttendanceRow = {
            id: row.id,
            cleaner_id: parsedCleanerId,
            cleaner_name: cleanerName,
            clock_in: row.clock_in ?? null,
            clock_out: row.clock_out ?? null,
            site_name: row.site_name ?? null,
            customer_name: row.customer_name ?? null,
          }

          const key = getRowKey({ ...baseRecord, cleaner_uuid: row.cleaner_uuid })
          const existing = attendanceMap.get(key)

          if (!existing) {
            attendanceMap.set(key, baseRecord)
            return
          }

          if (!existing.clock_in && baseRecord.clock_in) {
            existing.clock_in = baseRecord.clock_in
          }
          if (!existing.clock_out && baseRecord.clock_out) {
            existing.clock_out = baseRecord.clock_out
          }
          if (!existing.site_name && baseRecord.site_name) {
            existing.site_name = baseRecord.site_name
          }
          if (!existing.customer_name && baseRecord.customer_name) {
            existing.customer_name = baseRecord.customer_name
          }
          if (!existing.cleaner_id && baseRecord.cleaner_id) {
            existing.cleaner_id = baseRecord.cleaner_id
          }

          attendanceMap.set(key, existing)
        })

        setDailyAttendance(Array.from(attendanceMap.values()))
      } catch (error) {
        console.error('Failed to load daily attendance', error)
        setDailyAttendance([])
      } finally {
        setIsDailyAttendanceLoading(false)
      }
    }

    if (!managerId) return
    if (!isGlobalRole && !managedCleanerIds.length && !managedCleanerNames.length && cleaners.length) {
      setDailyAttendance([])
      setIsDailyAttendanceLoading(false)
      return
    }

    if (!isGlobalRole && !cleaners.length && isListLoading) {
      return
    }

    loadDailyAttendance()
  }, [
    cleaners.length,
    isListLoading,
    managedCleanerIds,
    managedCleanerIdsKey,
    managedCleanerNames,
    managedCleanerNamesKey,
    managerId,
    role,
    selectedDate,
    todayRefreshKey,
  ])

  const selectedLogsPreview = useMemo(() => logs.slice(0, 15), [logs])

  const todayKey = useMemo(() => now.toDateString(), [now])

  const todaysTasks = useMemo(() => tasks.filter((task) => task.timestamp && new Date(task.timestamp).toDateString() === todayKey), [tasks, todayKey])
  const todaysPhotos = useMemo(() => photos.filter((photo) => photo.photo_timestamp && new Date(photo.photo_timestamp).toDateString() === todayKey), [photos, todayKey])
  const todaysAttendance = useMemo(
    () => attendance.filter((row) => (row.clock_in && new Date(row.clock_in).toDateString() === todayKey) || (row.clock_out && new Date(row.clock_out).toDateString() === todayKey)),
    [attendance, todayKey]
  )

  const cleanerAttendanceDisplayRows = useMemo(() => {
    if (!attendance.length) return []

    const sorted = [...attendance].sort((a, b) => {
      const aTime = a.clock_in ? new Date(a.clock_in).getTime() : Number.NEGATIVE_INFINITY
      const bTime = b.clock_in ? new Date(b.clock_in).getTime() : Number.NEGATIVE_INFINITY
      return bTime - aTime
    })

    const seen = new Set<string>()
    const deduped = sorted.filter((row) => {
      const key = [row.cleaner_name, row.clock_in, row.clock_out, row.site_name, row.customer_name].join('::')
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })

    const activeEntries = deduped.filter((row) => row.clock_in && !row.clock_out)
    const completedEntries = deduped.filter((row) => row.clock_in && row.clock_out)
    const otherEntries = deduped.filter((row) => !row.clock_in && row.clock_out)

    return [...activeEntries, ...completedEntries, ...otherEntries]
  }, [attendance])

  const selectedAttendancePreview = useMemo(() => cleanerAttendanceDisplayRows.slice(0, 8), [cleanerAttendanceDisplayRows])

  const isPlaceholderLabel = (value?: string | null) => {
    if (!value) return false
    const normalized = value.trim().toLowerCase()
    return normalized === 'unknown site' || normalized === 'site'
  }

  const getAttendanceSiteLabel = (row: AttendanceRow) => {
    const candidates = [row.site_name, row.customer_name]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value): value is string => Boolean(value) && !isPlaceholderLabel(value))

    if (candidates.length) {
      return candidates[0]
    }

    return 'Site'
  }

  const renderAttendanceCard = (row: AttendanceRow) => {
    const siteLabel = getAttendanceSiteLabel(row)
    const isCompleted = Boolean(row.clock_out)
    const isExpanded = expandedAttendanceId === row.id
    const clockInLabel = row.clock_in ? formatTime(row.clock_in) : '—'
    const clockOutLabel = row.clock_out ? formatTime(row.clock_out) : '—'
    const dateLabel = formatDate(row.clock_out ?? row.clock_in)
    const cleanerDisplayName = normalizeCleanerName(row.cleaner_name || 'Cleaner')

    const toggleExpanded = () => {
      if (!isCompleted) return
      setExpandedAttendanceId(isExpanded ? null : row.id)
    }

    return (
      <div key={row.id} className="space-y-2">
        <div
          className={`rounded-[28px] border border-blue-100 bg-white/80 px-6 py-5 shadow-sm transition ${
            isCompleted ? 'cursor-pointer hover:border-blue-200 hover:bg-blue-50/70' : ''
          }`}
          onClick={toggleExpanded}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8aa5ff]">{siteLabel}</p>
              <div className="flex items-center gap-6 text-sm text-[#00339B]">
                <div className="text-left">
                  <p className="font-semibold leading-tight">Clocked in</p>
                  <p className="text-slate-500 leading-tight">{clockInLabel}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-[#8aa5ff]" />
                <div className="text-left">
                  <p className="font-semibold leading-tight">{isCompleted ? 'Clocked out' : 'On site'}</p>
                  <p className="text-slate-500 leading-tight">{isCompleted ? clockOutLabel : '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold text-[#00339B]">{cleanerDisplayName}</span>
                {dateLabel && (
                  <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-[#00339B]">
                    {dateLabel}
                  </span>
                )}
              </div>
            </div>
            {isCompleted ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  toggleExpanded()
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-blue-200 bg-white text-[#00339B] transition hover:bg-blue-50"
                aria-expanded={isExpanded}
                aria-label="Toggle attendance details"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-blue-100 bg-white text-[#8aa5ff]">
                <ArrowRight className="h-4 w-4" />
              </div>
            )}
          </div>
        </div>

        {isCompleted && isExpanded && (
          <div className="space-y-2 pl-4 sm:pl-8">
            <div className="flex items-center justify-between gap-4 rounded-[24px] border border-blue-100 bg-blue-50/40 px-5 py-4">
              <div className="flex items-center gap-4 text-sm text-[#00339B]">
                <div className="text-left">
                  <p className="font-semibold leading-tight">Clocked in</p>
                  <p className="text-slate-500 leading-tight">{clockInLabel}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-[#8aa5ff]" />
                <div className="text-left">
                  <p className="font-semibold leading-tight">On site</p>
                  <p className="text-slate-500 leading-tight">—</p>
                </div>
              </div>
              <span className="text-xs text-slate-500">{dateLabel}</span>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-[24px] border border-blue-100 bg-blue-50/40 px-5 py-4">
              <div className="flex items-center gap-4 text-sm text-[#00339B]">
                <div className="text-left">
                  <p className="font-semibold leading-tight">On site</p>
                  <p className="text-slate-500 leading-tight">—</p>
                </div>
                <ArrowRight className="h-4 w-4 text-[#8aa5ff]" />
                <div className="text-left">
                  <p className="font-semibold leading-tight">Clocked out</p>
                  <p className="text-slate-500 leading-tight">{clockOutLabel}</p>
                </div>
              </div>
              <span className="text-xs text-slate-500">{dateLabel}</span>
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

  const assistActiveCards = useMemo(
    () =>
      assistActiveRequests.map((request) => ({
        id: request.id,
        location: request.location_label,
        customer: request.customer_name,
        reportedAt: request.reported_at,
        acceptedAt: request.accepted_at,
        acceptedByName: request.accepted_by_name,
        status: request.status,
        issueType: request.issue_type,
        notes: request.notes,
        materials: request.materials_used,
        escalatedAt: request.escalated_at,
        escalationReason: request.escalation_reason,
        escalateAfter: request.escalate_after
      })),
    [assistActiveRequests]
  )

  const assistResolvedCards = useMemo(
    () =>
      assistResolvedRequests.map((request) => ({
        id: request.id,
        location: request.location_label,
        customer: request.customer_name,
        reportedAt: request.reported_at,
        resolvedAt: request.resolved_at,
        resolvedByName: request.resolved_by_name,
        status: request.status,
        issueType: request.issue_type,
        notes: request.notes,
        materials: request.materials_used
      })),
    [assistResolvedRequests]
  )

  const areasToday = taskSummaries.length
  const photosCount = todaysPhotos.length
  const recordsCount = todaysAttendance.length

  const greetingPeriod = useMemo(() => {
    const currentHour = now.getHours()
    if (currentHour < 12) return 'morning'
    if (currentHour < 18) return 'afternoon'
    return 'evening'
  }, [now])

  const selectedDateLabel = useMemo(() => format(selectedDate, 'EEE, MMM d, yyyy'), [selectedDate])

  const isSelectedDateToday = useMemo(() => isSameDay(selectedDate, normalizeToStartOfDay(now)), [selectedDate, now])

  useEffect(() => {
    if (!isSelectedDateToday) return
    setTodayRefreshKey((key) => key + 1)
  }, [isSelectedDateToday, now])

  const attendanceDisplayRows = useMemo(() => {
    if (!dailyAttendance.length) return []

    const dayStart = normalizeToStartOfDay(selectedDate)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)

    const isWithinSelectedDay = (iso?: string | null) => {
      if (!iso) return false
      const timestamp = new Date(iso)
      if (Number.isNaN(timestamp.getTime())) return false
      return timestamp >= dayStart && timestamp < dayEnd
    }

    const overlapsSelectedDay = (row: AttendanceRow) => {
      const clockInDate = row.clock_in ? new Date(row.clock_in) : null
      const clockOutDate = row.clock_out ? new Date(row.clock_out) : null

      if (isWithinSelectedDay(row.clock_in) || isWithinSelectedDay(row.clock_out)) {
        return true
      }

      if (clockInDate && clockOutDate) {
        return clockInDate < dayEnd && clockOutDate >= dayStart
      }

      return false
    }

    const filtered = dailyAttendance.filter(overlapsSelectedDay)

    const getSortTime = (row: AttendanceRow) => {
      const clockInTime = row.clock_in ? new Date(row.clock_in).getTime() : Number.NEGATIVE_INFINITY
      const clockOutTime = row.clock_out ? new Date(row.clock_out).getTime() : Number.NEGATIVE_INFINITY
      return Math.max(clockInTime, clockOutTime)
    }

    const sorted = [...filtered].sort((a, b) => getSortTime(b) - getSortTime(a))

    const seen = new Set<string>()
    const deduped = sorted.filter((row) => {
      const key = [row.cleaner_name, row.clock_in, row.clock_out, row.site_name, row.customer_name].join('::')
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })

    const activeEntries = deduped.filter((row) => row.clock_in && !row.clock_out)
    const completedEntries = deduped.filter((row) => row.clock_in && row.clock_out)
    const otherEntries = deduped.filter((row) => !row.clock_in && row.clock_out)

    const activeEntriesByCleaner = new Map<string, AttendanceRow>()

    activeEntries.forEach((row) => {
      const cleanerKey = normalizeCleanerName(row.cleaner_name || '')
      const siteKey = (row.site_name || row.customer_name || '').trim().toLowerCase()
      const combinedKey = `${cleanerKey}::${siteKey}`
      const existing = activeEntriesByCleaner.get(combinedKey)
      if (!existing) {
        activeEntriesByCleaner.set(combinedKey, row)
        return
      }

      const existingStart = existing.clock_in ? new Date(existing.clock_in).getTime() : Number.POSITIVE_INFINITY
      const candidateStart = row.clock_in ? new Date(row.clock_in).getTime() : Number.POSITIVE_INFINITY

      if (candidateStart < existingStart) {
        activeEntriesByCleaner.set(combinedKey, row)
      }
    })

    const dedupedActiveEntries = Array.from(activeEntriesByCleaner.values()).sort((a, b) => getSortTime(b) - getSortTime(a))

    return [...dedupedActiveEntries, ...completedEntries, ...otherEntries]
  }, [dailyAttendance, selectedDate])

  const cleanersOnlineApprox = useMemo(() => {
    if (!isSelectedDateToday) return null
    const activeKeys = new Set<string>()
    todaysAttendance.forEach((row) => {
      if (!row.clock_in) return
      if (row.clock_out) return
      const key = row.cleaner_id !== null && row.cleaner_id !== undefined ? String(row.cleaner_id) : row.cleaner_name
      if (!key) return
      activeKeys.add(key)
    })
    return activeKeys.size
  }, [isSelectedDateToday, todaysAttendance])

  const hoursWorkedApprox = useMemo(() => {
    if (!isSelectedDateToday) return 0
    const nowInstant = new Date()
    const totalHours = todaysAttendance.reduce(
      (sum, row) => sum + calculateHoursBetween(row.clock_in, row.clock_out, nowInstant),
      0,
    )
    return Number(totalHours.toFixed(1))
  }, [isSelectedDateToday, todaysAttendance])

  const hoursTrendRange = useMemo(() => {
    const baseRange = defaultAnalyticsRange(14)
    const isoRange = toIsoRange(baseRange)
    const formatterOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
    const startLabel = baseRange.start.toLocaleDateString(undefined, formatterOptions)
    const endLabel = baseRange.end.toLocaleDateString(undefined, formatterOptions)
    return {
      iso: isoRange,
      label: `${startLabel} - ${endLabel}`,
    }
  }, [])

  const hoursTrendQuery = useQuery({
    queryKey: ['manager-dashboard-hours-trend', role, analyticsManagerId, hoursTrendRange.iso.start, hoursTrendRange.iso.end],
    queryFn: () =>
      fetchAnalyticsSummary({
        managerId: analyticsManagerId,
        role,
        range: hoursTrendRange.iso,
      }),
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(managerId),
  })

  const selectedDayIso = useMemo(() => format(selectedDate, 'yyyy-MM-dd'), [selectedDate])

  const snapshotQuery = useQuery({
    queryKey: ['manager-dashboard-snapshot', role, analyticsManagerId, selectedDayIso],
    queryFn: () =>
      fetchDashboardSnapshot({
        managerId: analyticsManagerId,
        role,
        dayIso: selectedDayIso,
      }),
    enabled: Boolean(managerId),
    staleTime: 60 * 1000,
  })

  const { refetch: refetchSnapshot } = snapshotQuery

  useEffect(() => {
    if (!isSelectedDateToday) return
    refetchSnapshot()
  }, [isSelectedDateToday, refetchSnapshot, todayRefreshKey])

  const snapshot = snapshotQuery.data

  const snapshotIsCurrentDay = snapshot?.isCurrentDay ?? isSelectedDateToday
  const displayedAreasCount = snapshot?.areasCleaned ?? areasToday
  const displayedPhotosCount = snapshot?.photosTaken ?? photosCount
  const displayedHoursWorked = snapshot?.hoursWorked ?? (snapshotIsCurrentDay ? hoursWorkedApprox : 0)
  const displayedAttendanceCount = snapshot?.attendanceCount ?? recordsCount

  const handleResetDate = () => {
    const todayStart = normalizeToStartOfDay(now)
    setSelectedDate(todayStart)
    setIsAutoDate(true)
  }

  const handleSelectDate = (date: Date | undefined) => {
    if (!date) return
    const normalizedDate = normalizeToStartOfDay(date)
    setSelectedDate(normalizedDate)
    setIsAutoDate(isSameDay(normalizedDate, normalizeToStartOfDay(now)))
  }

  const handleGoToAnalytics = () => {
    navigate('/analytics')
  }

  const handleCleanerSelect = (cleaner: CleanerListItem) => {
    setSelectedCleaner(cleaner)
    setIsDetailModalOpen(true)
  }

  const handleCleanerDelete = async (
    event: React.MouseEvent<HTMLButtonElement>,
    cleaner: CleanerListItem,
  ) => {
    event.stopPropagation()
    event.preventDefault()

    if (!cleaner.cleaner_id) {
      console.warn('Cannot delete cleaner without a cleaner_id', cleaner)
      return
    }

    const confirmed = window.confirm(`Delete ${cleaner.cleaner_name}? This action cannot be undone.`)
    if (!confirmed) {
      return
    }

    const cleanerId = cleaner.cleaner_id
    setDeleteLoadingId(cleanerId)

    try {
      await deleteCleaner({ cleanerId, cleanerName: cleaner.cleaner_name })

      const previouslySelectedId = selectedCleaner?.cleaner_id ?? null
      let nextSelectedCleaner: CleanerListItem | null = null

      setCleaners((prev) => {
        const updated = prev.filter((item) => item.cleaner_id !== cleanerId)
        if (previouslySelectedId === cleanerId) {
          nextSelectedCleaner = updated[0] ?? null
        }
        return updated
      })

      setSelectedCleaner((prev) => {
        if (prev?.cleaner_id === cleanerId) {
          return nextSelectedCleaner
        }
        return prev
      })

      if (previouslySelectedId === cleanerId) {
        setIsDetailModalOpen(false)
      }
    } catch (error) {
      console.error('Failed to delete cleaner', error)
      window.alert('Unable to delete cleaner right now. Please try again.')
    } finally {
      setDeleteLoadingId(null)
    }
  }

  const metricCards = useMemo(() => {
    const isLoading = snapshotQuery.isLoading
    const isError = snapshotQuery.isError

    const toDisplayNumber = (value: unknown): number | null => {
      if (value === null || value === undefined) return null
      if (typeof value === 'number') return Number.isFinite(value) ? value : null
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : null
    }

    const cleanersOnlineBase = snapshot?.cleanersOnline ?? (snapshotIsCurrentDay ? cleanersOnlineApprox ?? 0 : null)
    const areasCleanedBase = displayedAreasCount
    const photosTakenBase = displayedPhotosCount
    const hoursWorkedBase = displayedHoursWorked

    const cleanersOnlineValue = isLoading ? undefined : toDisplayNumber(cleanersOnlineBase)
    const areasCleanedValue = isLoading ? undefined : toDisplayNumber(areasCleanedBase)
    const photosTakenValue = isLoading ? undefined : toDisplayNumber(photosTakenBase)
    const hoursWorkedValue = isLoading ? undefined : toDisplayNumber(hoursWorkedBase)

    const unavailableLabel = isError ? 'Unable to load metric' : 'Live metric only available for today'
    const helperOrError = (defaultText: string) => (isError ? 'Unable to load metric' : defaultText)

    return [
      {
        key: 'cleaners-online',
        label: 'Cleaners online',
        value: cleanersOnlineValue,
        helper: snapshotIsCurrentDay ? 'Active now' : unavailableLabel,
      },
      {
        key: 'areas-cleaned',
        label: 'Areas cleaned',
        value: areasCleanedValue,
        helper: helperOrError('Completed area submissions'),
      },
      {
        key: 'photos-taken',
        label: 'Photos taken',
        value: photosTakenValue,
        helper: helperOrError('Task photo uploads'),
      },
      {
        key: 'hours-worked',
        label: 'Hours worked',
        value: hoursWorkedValue,
        helper: helperOrError('Total hours logged'),
      },
    ]
  }, [
    snapshotQuery.isLoading,
    snapshotQuery.isError,
    snapshot,
    snapshotIsCurrentDay,
    cleanersOnlineApprox,
    displayedAreasCount,
    displayedPhotosCount,
    displayedHoursWorked,
  ])

  useEffect(() => {
    if (!isGlobalRole || !managerId) {
      setGlobalActivity([])
      return
    }

    let cancelled = false

    const loadActivity = async () => {
      setIsGlobalActivityLoading(true)
      try {
        const rows = await fetchManagerRecentActivity(managerId, 40, role)
        if (!cancelled) {
          setGlobalActivity(rows)
          setGlobalActivityError(null)
        }
      } catch (error) {
        console.error('Failed to load global activity overview', error)
        if (!cancelled) {
          setGlobalActivity([])
          setGlobalActivityError('Unable to load recent cleaner activity overview.')
        }
      } finally {
        if (!cancelled) {
          setIsGlobalActivityLoading(false)
        }
      }
    }

    loadActivity()

    return () => {
      cancelled = true
    }
  }, [isGlobalRole, managerId, role])

  const handleRefreshGlobalActivity = useCallback(() => {
    if (!isGlobalRole || !managerId) return
    setIsGlobalActivityLoading(true)
    fetchManagerRecentActivity(managerId, 40, role)
      .then((rows) => {
        setGlobalActivity(rows)
        setGlobalActivityError(null)
      })
      .catch((error) => {
        console.error('Failed to refresh global activity overview', error)
        setGlobalActivityError('Unable to refresh activity. Please try again later.')
      })
      .finally(() => setIsGlobalActivityLoading(false))
  }, [isGlobalRole, managerId, role])

  const globalActivityPreview = useMemo(() => globalActivity.slice(0, 12), [globalActivity])

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
      <div className="flex min-h-screen items-center justify-center bg-[#f4f4f4]">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#00339B] border-t-transparent" />
      </div>
    )
  }

  return (
    <>
      <div className="mx-auto flex w/full max-w-7xl flex-col gap-8 px-6 pt-10 pb-24 xl:px-12">
        <section className="rounded-[36px] border border-white/60 bg-white/80 p-6 shadow-[0_34px_90px_rgba(0,51,155,0.12)] backdrop-blur-md md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex w-full items-start gap-4">
              <SidebarTrigger className="mt-1 h-10 w-10 shrink-0 rounded-2xl bg-white/80 text-gray-600 shadow-sm backdrop-blur-sm transition hover:bg-white hover:text-gray-900 sm:h-11 sm:w-11" />
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#8aa5ff]">Good {greetingPeriod}</p>
                <h1 className="text-3xl font-semibold text-[#00339B] sm:text-4xl">Welcome back, {managerName}</h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-2 lg:mt-3">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex items-center gap-3 rounded-full border border-blue-100 bg-white/80 px-4 py-2 text-sm font-semibold text-[#00339B] shadow-sm transition hover:bg-blue-50"
                  >
                    <CalendarDays className="h-4 w-4" />
                    <span>{selectedDateLabel}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar mode="single" selected={selectedDate} onSelect={handleSelectDate} initialFocus />
                </PopoverContent>
              </Popover>
              <Button
                type="button"
                onClick={handleResetDate}
                disabled={isSelectedDateToday}
                variant="ghost"
                className="rounded-full border border-blue-200 bg-blue-50/70 px-4 py-2 text-sm font-semibold text-[#00339B] transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Today
              </Button>
            </div>
          </div>
          <p className="mt-5 max-w-3xl text-sm text-slate-500">
            {overviewSubtitle}
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metricCards.map((metric) => {
            const isNumber = typeof metric.value === 'number'
            const displayValue = isNumber
              ? metric.value.toLocaleString(undefined, {
                  maximumFractionDigits: Number(metric.value) % 1 === 0 ? 0 : 1,
                })
              : metric.value === null
                ? '—'
                : ''
            return (
              <div
                key={metric.key}
                className="group relative overflow-hidden rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-[0_22px_50px_rgba(0,51,155,0.08)] backdrop-blur transition hover:-translate-y-1 hover:shadow-[0_30px_70px_rgba(0,51,155,0.18)]"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-[#00339B]/10 via-[#5f80ff]/10 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <div className="relative flex flex-col gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8aa5ff]">{metric.label}</span>
                  <span className="text-3xl font-semibold text-[#00339B]">
                    {metric.value === undefined ? (
                      <span className="inline-flex h-8 w-12 animate-pulse rounded-full bg-blue-100/70" />
                    ) : (
                      displayValue
                    )}
                  </span>
                  <span className="text-xs text-slate-500">{metric.helper}</span>
                </div>
              </div>
            )
          })}
        </section>

        {isGlobalRole && (
          <section className="rounded-[36px] border border-white/70 bg-white/85 shadow-[0_30px_80px_rgba(0,51,155,0.08)] backdrop-blur">
            <div className="flex flex-col gap-4 border-b border-blue-100 px-8 py-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[#00339B]">Cleaner activity overview</h2>
                <p className="text-sm text-slate-500">Latest site check-ins, area scans, and task logs across all cleaners.</p>
              </div>
              <Button
                variant="ghost"
                onClick={handleRefreshGlobalActivity}
                disabled={isGlobalActivityLoading}
                className="rounded-full border border-blue-100 px-6 py-2 text-sm font-semibold text-[#00339B] hover:bg-blue-50"
              >
                {isGlobalActivityLoading ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
            <div className="space-y-3 px-8 py-6">
              {isGlobalActivityLoading ? (
                <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-6 text-center text-sm text-slate-500">
                  Loading recent activity…
                </div>
              ) : globalActivityError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-6 text-center text-sm text-rose-600">
                  {globalActivityError}
                </div>
              ) : globalActivityPreview.length ? (
                globalActivityPreview.map((row) => (
                  <div
                    key={row.id}
                    className="rounded-[24px] border border-blue-100 bg-white/95 p-4 shadow-sm shadow-blue-100/40"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[#00339B]">
                      <span className="font-semibold">{row.action || 'Activity recorded'}</span>
                      <span className="text-xs text-[#00339B]/70">
                        {row.timestamp ? format(new Date(row.timestamp), 'MMM d, yyyy • p') : '—'}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#00339B]/70">
                      {row.cleaner_name ? <span className="font-semibold">{row.cleaner_name}</span> : null}
                      {row.site ? <span>• {row.site}</span> : null}
                      {row.area ? <span>• {row.area}</span> : null}
                    </div>
                    {row.detail ? (
                      <p className="mt-2 text-xs text-slate-500">{row.detail}</p>
                    ) : null}
                    {row.comments ? (
                      <p className="mt-1 text-xs text-slate-500/80">{row.comments}</p>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-6 text-center text-sm text-slate-500">
                  No cleaner activity recorded for this period.
                </div>
              )}
            </div>
          </section>
        )}

        <section className="grid gap-6 xl:grid-cols-2">
          <Card className="rounded-[36px] border border-white/70 bg-white/80 shadow-[0_26px_70px_rgba(0,51,155,0.1)] backdrop-blur">
            <CardHeader className="space-y-1">
              <CardTitle className="text-xl font-semibold text-[#00339B]">Assistance</CardTitle>
              <p className="text-sm text-slate-500">
                Monitor bathroom assist requests needing cleaner action and keep track of recent resolutions.
              </p>
            </CardHeader>
            <CardContent className="space-y-8">
              {assistRequestsError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-6 text-center text-sm text-rose-600">
                  {assistRequestsError}
                </div>
              ) : (
                <>
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8aa5ff]">Needs attention</p>
                      {assistActiveCards.length > 0 && (
                        <span className="text-[11px] font-medium text-slate-400">{assistActiveCards.length} open</span>
                      )}
                    </div>
                    <div className="mt-4 space-y-3">
                      {assistActiveCards.length ? (
                        assistActiveCards.map((assist) => (
                          <div
                            key={assist.id}
                            className={cn(
                              'rounded-[24px] border p-5 shadow-sm transition',
                              getAssistAttentionContainerClasses(assist.status)
                            )}
                          >
                            <div className="flex flex-col gap-1">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-[#00339B]">{assist.location}</p>
                                  <p className="text-xs text-slate-500">{assist.customer ?? 'Unknown customer'}</p>
                                </div>
                                <Badge
                                  className={cn(
                                    'rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide',
                                    getAssistStatusBadgeClasses(assist.status)
                                  )}
                                >
                                  {formatAssistStatus(assist.status)}
                                </Badge>
                              </div>
                              {assist.issueType && (
                                <p className="text-xs font-medium text-[#0f235f]">{assist.issueType}</p>
                              )}
                            </div>
                            <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                              <span className="font-semibold text-rose-500">
                                Reported {formatDateTime(assist.reportedAt)}
                              </span>
                              {assist.acceptedAt && (
                                <span className="font-semibold text-[#00339B]">
                                  Accepted {formatDateTime(assist.acceptedAt)}
                                  {assist.acceptedByName ? ` • ${assist.acceptedByName}` : ''}
                                </span>
                              )}
                              {assist.escalatedAt && (
                                <span className="font-semibold text-rose-600">
                                  Escalated {formatDateTime(assist.escalatedAt)}
                                </span>
                              )}
                              {!assist.acceptedAt && assist.escalateAfter && (
                                <span className="font-medium text-amber-600">
                                  Escalates after {formatDateTime(assist.escalateAfter)}
                                </span>
                              )}
                            </div>
                            {(assist.notes || assist.escalationReason) && (
                              <div className="mt-3 space-y-1 text-xs text-slate-500">
                                {assist.notes && <p>Notes: {assist.notes}</p>}
                                {assist.escalationReason && <p>Escalation reason: {assist.escalationReason}</p>}
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/30 p-6 text-center text-sm text-slate-500">
                          No requests need attention right now.
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8aa5ff]">Recently resolved</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {assistResolvedCards.length ? (
                        assistResolvedCards.map((assist) => (
                          <div
                            key={assist.id}
                            className="rounded-[24px] border border-blue-100 bg-blue-50/40 p-4 shadow-sm"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-semibold text-[#00339B]">{assist.location}</span>
                              <Badge
                                className={cn(
                                  'rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide',
                                  getAssistStatusBadgeClasses(assist.status)
                                )}
                              >
                                {formatAssistStatus(assist.status)}
                              </Badge>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">{assist.customer ?? 'Unknown customer'}</p>
                            {assist.issueType && (
                              <p className="mt-2 text-xs text-[#0f235f]">{assist.issueType}</p>
                            )}
                            <p className="mt-3 text-[11px] text-slate-400">
                              Reported {formatDateTime(assist.reportedAt)}
                            </p>
                            {assist.resolvedAt && (
                              <p className="text-[11px] text-emerald-600">
                                Resolved {formatDateTime(assist.resolvedAt)}
                                {assist.resolvedByName ? ` • ${assist.resolvedByName}` : ''}
                              </p>
                            )}
                            {assist.notes && (
                              <p className="mt-2 text-xs text-slate-500">Notes: {assist.notes}</p>
                            )}
                          </div>
                        ))
                      ) : (
                        <div className="sm:col-span-2 rounded-2xl border border-dashed border-blue-200 bg-blue-50/30 p-6 text-center text-sm text-slate-500">
                          No recent resolutions yet.
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-[36px] border border-white/70 bg-white/80 shadow-[0_26px_70px_rgba(0,51,155,0.1)] backdrop-blur">
            <CardHeader className="space-y-4 pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-2">
                  <CardTitle className="text-xl font-semibold text-[#00339B]">Analytics</CardTitle>
                  <p className="text-sm text-slate-500">Total hours trend pulled from attendance.</p>
                </div>
                <span className="text-[11px] font-medium text-slate-400">{hoursTrendRange.label}</span>
              </div>
            </CardHeader>
          <CardContent className="space-y-6 pb-4">
            <div>
              {hoursTrendQuery.isLoading ? (
                <div className="rounded-[24px] border border-blue-100 bg-white/70 p-6">
                  <div className="flex h-48 items-center justify-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#00339B] border-t-transparent" />
                  </div>
                </div>
              ) : hoursTrendQuery.isError ? (
                <div className="rounded-[24px] border border-rose-200 bg-rose-50/70 p-6 text-center text-sm text-rose-600">
                  Unable to load hours trend right now.
                </div>
              ) : hoursTrendQuery.data?.hoursByDate?.length ? (
                <HoursWorkedAreaChart summary={hoursTrendQuery.data} layout="inline" />
              ) : (
                <div className="rounded-[24px] border border-dashed border-blue-200 bg-blue-50/30 p-6 text-center text-sm text-slate-500">
                  No hours recorded for this range yet.
                </div>
              )}
            </div>
            <div className="flex flex-col gap-4 rounded-[28px] border border-white/80 bg-gradient-to-br from-[#f6f8ff] via-white/90 to-white px-6 py-5 shadow-[0_16px_40px_rgba(0,51,155,0.08)] sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[#00339B]">
                <span className="font-semibold">Need deeper insights?</span>{' '}
                <span className="text-slate-500">Open the full analytics workspace to review trends, exports, and reports.</span>
              </p>
              <Button
                type="button"
                onClick={handleGoToAnalytics}
                className="w-full rounded-full bg-[#00339B] px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#00297a] sm:w-auto"
              >
                Go
              </Button>
            </div>
          </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <Card className="rounded-[36px] border border-white/70 bg-white/85 shadow-[0_30px_80px_rgba(0,51,155,0.1)] backdrop-blur">
            <CardHeader className="space-y-1">
              <CardTitle className="text-xl font-semibold text-[#00339B]">Management</CardTitle>
              <p className="text-sm text-slate-500">Search your roster, review submissions, and share feedback.</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-2 rounded-full border border-blue-100 bg-white/80 px-4 py-2 shadow-sm">
                <Search className="h-4 w-4 text-[#00339B]" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search cleaners..."
                  className="h-8 border-0 bg-transparent px-0 text-sm text-[#00339B] placeholder:text-slate-400 focus-visible:ring-0"
                />
              </div>
              <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
                {filteredCleaners.length ? (
                  filteredCleaners.map((cleaner) => {
                    const isSelected =
                      isDetailModalOpen && selectedCleaner?.cleaner_id === cleaner.cleaner_id
                    return (
                      <div
                        key={cleaner.cleaner_id || cleaner.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleCleanerSelect(cleaner)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            handleCleanerSelect(cleaner)
                          }
                        }}
                        className={`flex w-full cursor-pointer items-center justify-between gap-4 rounded-[24px] px-4 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00339B] ${
                          isSelected
                            ? 'border border-blue-200 bg-blue-50 shadow-md'
                            : 'border border-blue-100 bg-white/80 shadow-sm hover:border-blue-200 hover:bg-blue-50/70'
                        }`}
                      >
                        <span className="font-semibold text-[#00339B]">{cleaner.cleaner_name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8aa5ff]">cleaner</span>
                          {cleaner.cleaner_id && (
                            <button
                              type="button"
                              onClick={(event) => handleCleanerDelete(event, cleaner)}
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-blue-200 bg-white/80 text-[#00339B] transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                              aria-label={`Delete ${cleaner.cleaner_name}`}
                              disabled={deleteLoadingId === cleaner.cleaner_id}
                            >
                              {deleteLoadingId === cleaner.cleaner_id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/30 p-6 text-center text-sm text-slate-500">
                    No cleaners found. Adjust your search.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[36px] border border-white/70 bg-white/85 shadow-[0_30px_80px_rgba(0,51,155,0.1)] backdrop-blur">
            <CardHeader className="space-y-1">
              <CardTitle className="text-xl font-semibold text-[#00339B]">Calendar</CardTitle>
              <p className="text-sm text-slate-500">Attendance timeline for your team.</p>
            </CardHeader>
            <CardContent>
              <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
                {isDailyAttendanceLoading ? (
                  <div className="flex justify-center py-6">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#00339B] border-t-transparent" />
                  </div>
                ) : attendanceDisplayRows.length ? (
                  attendanceDisplayRows.map(renderAttendanceCard)
                ) : (
                  <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/30 p-6 text-center text-sm text-slate-500">
                    No attendance records found for {selectedDateLabel}.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      </div>

      <Dialog
        open={isDetailModalOpen && Boolean(selectedCleaner)}
        onOpenChange={(open) => {
          setIsDetailModalOpen(open)
          if (!open) {
            setExpandedAttendanceId(null)
            setSelectedCleaner(null)
          }
        }}
      >
        <DialogContent className="max-h-[90vh] w-full max-w-5xl overflow-y-auto overscroll-contain rounded-[32px] border border-blue-100 bg-white/90 p-6 shadow-[0_45px_120px_rgba(0,51,155,0.25)]">
          {selectedCleaner ? (
            <div className="space-y-6">
              <DialogHeader className="space-y-4 text-left">
                <div className="flex items-start justify-between gap-4">
                  <DialogTitle className="text-2xl font-semibold text-[#00339B]">{selectedCleaner.cleaner_name}</DialogTitle>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#00339B]">
                      cleaner
                    </span>
                    <DialogClose
                      className="flex h-9 w-9 items-center justify-center rounded-full border border-blue-200 bg-white text-[#00339B] transition hover:bg-blue-50"
                      aria-label="Close cleaner details"
                    >
                      <X className="h-4 w-4" />
                    </DialogClose>
                  </div>
                </div>
                {selectedCleaner.event_type && (
                  <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-[#00339B]">
                    <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 uppercase tracking-wide">
                      {selectedCleaner.event_type.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}
              </DialogHeader>

              {isDetailLoading ? (
                <div className="flex justify-center py-16">
                  <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#00339B] border-t-transparent" />
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="rounded-[28px] border border-blue-100 bg-white/80 p-5 shadow-sm">
                      <h3 className="text-sm font-semibold text-[#00339B]">Time & Attendance</h3>
                      <div className="mt-4 max-h-60 space-y-3 overflow-y-auto pr-1">
                        {selectedAttendancePreview.length ? (
                          selectedAttendancePreview.map(renderAttendanceCard)
                        ) : (
                          <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/30 p-4 text-xs text-slate-500">
                            No attendance entries recorded.
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="rounded-[28px] border border-blue-100 bg-white/80 p-5 shadow-sm">
                      <h3 className="text-sm font-semibold text-[#00339B]">Areas & Tasks</h3>
                      <div className="mt-4 max-h-60 space-y-3 overflow-y-auto pr-1">
                        {taskSummaries.length ? (
                          taskSummaries.map((task) => (
                            <div key={task.id} className="rounded-[20px] border border-blue-100 bg-blue-50/30 p-4">
                              <p className="text-sm font-semibold text-[#00339B]">{task.area}</p>
                              <p className="mt-1 text-xs text-slate-500">{formatDateTime(task.timestamp)}</p>
                              <p className="mt-1 text-xs text-slate-600">Tasks completed: {task.completed}/{task.total}</p>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/30 p-4 text-xs text-slate-500">
                            No task submissions yet.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[32px] border border-blue-100 bg-white/80 p-6 shadow-sm">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-[#00339B]">
                      <ImageIcon className="h-4 w-4" /> Task photos
                    </h3>
                    {areaPhotoGroups.length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-dashed border-blue-200 bg-blue-50/30 p-6 text-xs text-slate-500">
                        No photos uploaded yet.
                      </div>
                    ) : (
                      <div className="mt-5 space-y-4">
                        {areaPhotoGroups.map((areaGroup) => {
                          const isAreaExpanded = expandedGroups[areaGroup.key] ?? true
                          return (
                            <div key={areaGroup.key} className="rounded-[28px] border border-blue-100 bg-blue-50/20 p-5">
                              <div className="flex items-start justify-between gap-3">
                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#00339B]">
                                    <MapPin className="h-3 w-3" />
                                    <span>{areaGroup.area}</span>
                                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#00339B] shadow-sm border border-[#00339B]/20">
                                      {areaGroup.dateLabel}
                                    </span>
                                    {areaGroup.customer && (
                                      <span className="rounded-full bg-[#fffbeb] px-2 py-0.5 text-[10px] font-semibold text-[#1f2937]">
                                        {areaGroup.customer}
                                      </span>
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
                                  className="rounded-full border border-blue-200 text-[#00339B] hover:bg-blue-100"
                                  aria-label={isAreaExpanded ? 'Collapse area' : 'Expand area'}
                                >
                                  <ChevronDown className={`h-4 w-4 transition-transform ${isAreaExpanded ? 'rotate-180' : ''}`} />
                                </Button>
                              </div>

                              <div
                                className={`mt-4 overflow-hidden transition-all duration-300 ${
                                  isAreaExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
                                }`}
                              >
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                  {areaGroup.tasks.map((taskGroup) => {
                                    const taskKey = `${areaGroup.key}::${taskGroup.key}`
                                    const thumbnail = taskGroup.photos[0]
                                    if (!thumbnail) return null

                                    return (
                                      <button
                                        key={taskKey}
                                        onClick={() => openPhotoModal(taskGroup.photos, 0, taskGroup.taskName, taskGroup.startedAt)}
                                        className="group relative aspect-square w-full overflow-hidden rounded-[26px] border border-white/70 bg-white/70 shadow-[0_16px_34px_rgba(15,35,95,0.06)] transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_50px_rgba(15,35,95,0.12)]"
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

                  <div className="rounded-[28px] border border-blue-100 bg-white/80 p-5 shadow-sm">
                    <h3 className="text-sm font-semibold text-[#00339B]">Recent activity</h3>
                    <div className="mt-4 max-h-60 space-y-3 overflow-y-auto pr-1">
                      {selectedLogsPreview.length ? (
                        selectedLogsPreview.map((log) => (
                          <div
                            key={log.id}
                            className="flex items-start gap-3 rounded-[22px] border border-blue-100 bg-blue-50/40 p-4"
                          >
                            <div
                              className={`flex h-9 w-9 items-center justify-center rounded-xl text-[10px] font-semibold uppercase text-white ${getStatusColor(log.action)}`}
                            >
                              {log.action.slice(0, 3).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-[#00339B]">{log.action}</p>
                              <p className="text-xs text-slate-500">{log.site_area || '—'}</p>
                              <p className="mt-1 text-[11px] text-slate-400">{formatDateTime(log.timestamp)}</p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/30 p-4 text-xs text-slate-500">
                          No recent actions recorded.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-slate-500">Select a cleaner from the management list to view details.</div>
          )}
        </DialogContent>
      </Dialog>

      {currentPhoto &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-6">
            <div className="relative w-full max-w-4xl rounded-[32px] border border-[#d9e3ff] bg-[#f6f8ff] shadow-[0_35px_80px_rgba(0,0,0,0.25)] p-6 sm:p-8">
              <button
                type="button"
                onClick={closePhotoModal}
                className="absolute -right-3 -top-3 z-30 rounded-full border border-[#d9e3ff] bg-white p-2 shadow-sm hover:bg-gray-50"
                aria-label="Close photo viewer"
              >
                <X className="h-5 w-5 text-gray-600" />
              </button>

              <div className="relative overflow-hidden rounded-[24px] border border-[#d9e3ff] bg-white">
                <img src={currentPhoto.photo_data} alt="task" className="w-full max-h-[68vh] object-contain" />

                <button
                  type="button"
                  onClick={() => goToPhoto(-1)}
                  className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full border border-[#d9e3ff] bg-white p-3 shadow-sm transition hover:bg-gray-50"
                  aria-label="Previous photo"
                >
                  <ChevronLeft className="h-5 w-5 text-gray-600" />
                </button>

                <button
                  type="button"
                  onClick={() => goToPhoto(1)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full border border-[#d9e3ff] bg-white p-3 shadow-sm transition hover:bg-gray-50"
                  aria-label="Next photo"
                >
                  <ChevronRight className="h-5 w-5 text-gray-600" />
                </button>

                <div className="absolute top-5 left-5 flex items-center gap-2 rounded-full border border-[#d9e3ff] bg-white px-3 py-1 text-xs font-semibold text-gray-700 shadow-sm">
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
                        className={`rounded-full gap-2 px-5 font-semibold transition ${
                          feedbackForPhoto === 'up'
                            ? 'bg-[#00339B] text-white hover:bg-[#00297a]'
                            : 'border border-[#00339B] bg-white text-[#00339B] hover:bg-[#00339B]/10'
                        }`}
                      >
                        <ThumbsUp className="h-4 w-4" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        disabled={isSavingFeedback}
                        onClick={() => currentPhoto && handleFeedback(currentPhoto, 'down')}
                        className={`rounded-full gap-2 px-5 font-semibold transition ${
                          feedbackForPhoto === 'down'
                            ? 'bg-rose-600 text-white hover:bg-rose-700'
                            : 'border border-rose-500 bg-white text-rose-600 hover:bg-rose-50'
                        }`}
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
    </>
  )
}
