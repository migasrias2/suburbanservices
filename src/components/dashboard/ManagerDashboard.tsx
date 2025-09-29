import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Users, Image as ImageIcon, ArrowLeft, Clock, MapPin, Search, ChevronDown, ChevronLeft, ChevronRight, ThumbsUp, ThumbsDown, X } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

interface ManagerDashboardProps {
  managerId: string
  managerName: string
}

interface CleanerListItem {
  id: string
  cleaner_id: string
  cleaner_name: string
  customer_name: string | null
  site_area: string | null
  event_type: string | null
  timestamp: string
  is_active: boolean
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
}

interface TaskPhotoRow {
  id: number
  cleaner_id: string
  cleaner_name?: string
  photo_data: string
  photo_timestamp: string
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

const formatTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—')
const formatDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
const formatTimeOnly = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—')

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
  const [photoFeedbackMap, setPhotoFeedbackMap] = useState<Record<number, 'up' | 'down' | null>>({})
  const [isSavingFeedback, setIsSavingFeedback] = useState(false)

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

      const rosterResult = await supabase
        .from('cleaners')
        .select('id, first_name, last_name, created_at')
        .order('created_at', { ascending: false })

      const rosterRows = rosterResult.error ? [] : (rosterResult.data as any[] | null) ?? []

      const trackingResults = await Promise.allSettled([
        supabase
      .from('uk_cleaner_live_tracking')
          .select('id, cleaner_id, cleaner_name, site_area, event_type, timestamp, updated_at, created_at, is_active')
          .order('timestamp', { ascending: false }),
        supabase
          .from('live_tracking')
          .select('id, cleaner_id, cleaner_name, site_area, event_type, timestamp, updated_at, created_at, is_active')
      .order('timestamp', { ascending: false })
      ])

      const cleanerMap = new Map<string, CleanerListItem>()

      trackingResults.forEach((result) => {
        if (result.status !== 'fulfilled' || result.value.error) return
        const rows = result.value.data as any[] | null
        rows?.forEach((row) => {
          let cleanerName = row.cleaner_name
          if (!cleanerName && row.cleaner_id) {
            const rosterMatch = rosterRows.find((c) => c.id === row.cleaner_id)
            if (rosterMatch) {
              cleanerName = `${rosterMatch.first_name ?? ''} ${rosterMatch.last_name ?? ''}`.trim()
            }
          }
          if (!cleanerName) return
          const key = row.cleaner_id || row.id || cleanerName
          if (cleanerMap.has(key)) return
          cleanerMap.set(key, {
            id: row.id || key,
            cleaner_id: row.cleaner_id || key,
            cleaner_name: cleanerName,
            customer_name: row.customer_name || null,
            site_area: row.site_area || null,
            event_type: row.event_type || null,
            timestamp: row.timestamp || row.updated_at || row.created_at || new Date().toISOString(),
            is_active: row.is_active ?? true
          })
        })
      })

      rosterRows.forEach((row) => {
        const name = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'Cleaner'
        const key = row.id || name
        if (cleanerMap.has(key)) return
        cleanerMap.set(key, {
          id: row.id || key,
          cleaner_id: row.id || key,
          cleaner_name: name,
          customer_name: null,
          site_area: null,
          event_type: null,
          timestamp: row.created_at || new Date().toISOString(),
          is_active: false
        })
      })

      const dedupedList = Array.from(cleanerMap.values()).sort((a, b) => a.cleaner_name.localeCompare(b.cleaner_name))
      setCleaners(dedupedList)
      setSelectedCleaner((prev) => {
        if (prev) {
          const match = dedupedList.find((cleaner) => cleaner.cleaner_name === prev.cleaner_name)
          if (match) return match
        }
        return dedupedList[0] ?? null
      })
      setIsListLoading(false)
    }

    loadCleaners()
  }, [managerId])

  useEffect(() => {
    if (!selectedCleaner) return

    const loadDetail = async () => {
      setIsDetailLoading(true)
      const cleanerName = selectedCleaner.cleaner_name

      const [attendanceRes, logsRes, tasksRes, photosRes] = await Promise.all([
        supabase
          .from('time_attendance')
          .select('*')
          .eq('cleaner_name', cleanerName)
          .order('clock_in', { ascending: false })
          .limit(60),
        supabase
      .from('uk_cleaner_logs')
      .select('*')
          .eq('cleaner_name', cleanerName)
          .order('timestamp', { ascending: false })
          .limit(120),
        supabase
          .from('uk_cleaner_task_selections')
          .select('*')
          .eq('cleaner_name', cleanerName)
      .order('timestamp', { ascending: false })
          .limit(80),
        supabase
          .from('uk_cleaner_task_photos')
          .select('*')
          .eq('cleaner_name', cleanerName)
          .order('photo_timestamp', { ascending: false })
          .limit(80)
      ])

      if (attendanceRes?.error) console.warn('Attendance load failed', attendanceRes.error)
      if (logsRes?.error) console.warn('Logs load failed', logsRes.error)
      if (tasksRes?.error) console.warn('Tasks load failed', tasksRes.error)
      if (photosRes?.error) console.warn('Photos load failed', photosRes.error)

      setAttendance(attendanceRes?.data ?? [])
      setLogs(logsRes?.data ?? [])
      setTasks(tasksRes?.data ?? [])
      const photoRows = photosRes?.data ?? []
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

  const selectedAttendancePreview = useMemo(() => attendance.slice(0, 8), [attendance])
  const selectedLogsPreview = useMemo(() => logs.slice(0, 15), [logs])

  const todayKey = useMemo(() => new Date().toDateString(), [])

  const todaysTasks = useMemo(() => tasks.filter((task) => task.timestamp && new Date(task.timestamp).toDateString() === todayKey), [tasks, todayKey])
  const todaysPhotos = useMemo(() => photos.filter((photo) => photo.photo_timestamp && new Date(photo.photo_timestamp).toDateString() === todayKey), [photos, todayKey])
  const todaysAttendance = useMemo(
    () => attendance.filter((row) => (row.clock_in && new Date(row.clock_in).toDateString() === todayKey) || (row.clock_out && new Date(row.clock_out).toDateString() === todayKey)),
    [attendance, todayKey]
  )

  const taskSummaries = useMemo(() => (
    todaysTasks.map((row) => {
      const selected = JSON.parse(row.selected_tasks || '[]') as string[]
      const completed = JSON.parse(row.completed_tasks || '[]') as string[]
      return {
        id: row.id,
        area: row.area_type,
        total: selected.length,
        completed: completed.length,
        timestamp: row.timestamp
      }
    })
  ), [todaysTasks])

  const groupedPhotos = useMemo(() => {
    if (!photos.length) return []
    const buckets = new Map<string, { label: string; items: TaskPhotoRow[] }>()

    photos.forEach((photo) => {
      const date = photo.photo_timestamp ? new Date(photo.photo_timestamp) : null
      const key = date ? date.toISOString().split('T')[0] : 'unknown'
      const label = date
        ? date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
        : 'Unsorted'
      if (!buckets.has(key)) {
        buckets.set(key, { label, items: [] })
      }
      buckets.get(key)!.items.push(photo)
    })

    return Array.from(buckets.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, value]) => ({ key, ...value }))
  }, [photos])

  const areasToday = taskSummaries.length
  const photosCount = todaysPhotos.length
  const recordsCount = todaysAttendance.length

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const openPhotoModal = (groupPhotos: TaskPhotoRow[], index: number) => {
    setPhotoList(groupPhotos)
    setActivePhotoIndex(index)
  }

  const closePhotoModal = () => {
    setActivePhotoIndex(null)
    setPhotoList([])
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
                key={cleaner.cleaner_name}
                onClick={() => setSelectedCleaner(cleaner)}
                className={`rounded-2xl border ${selectedCleaner?.cleaner_name === cleaner.cleaner_name ? 'border-[#00339B] shadow-md' : 'border-gray-100 shadow-sm'} bg-white transition-all text-left p-4 flex items-center gap-4 hover:shadow-md`}
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
                    {selectedAttendancePreview.map((row) => (
                      <div key={row.id} className="p-3 rounded-xl bg-blue-50/80">
                        <p className="text-sm font-semibold text-[#00339B]">Clock in • {row.site_name || row.customer_name || 'Site'}</p>
                        <p className="text-xs text-gray-600">{formatDateTime(row.clock_in)}</p>
                        <p className="text-xs text-gray-500 mt-1">Clock out: {formatDateTime(row.clock_out)}</p>
                    </div>
                  ))}
                    {selectedAttendancePreview.length === 0 && <div className="text-xs text-gray-500">No attendance entries recorded.</div>}
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
              {groupedPhotos.length === 0 ? (
                <div className="text-xs text-gray-500">No photos uploaded yet.</div>
              ) : (
                <div className="space-y-4">
                  {groupedPhotos.map((group) => {
                     const basePhotos = group.items.slice(0, 4)
                     const extraPhotos = group.items.slice(4)
                     const isExpanded = expandedGroups[group.key] ?? false
                     return (
                       <div key={group.key} className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4">
                         <div className="flex items-center justify-between">
                           <div>
                             <p className="text-sm font-semibold text-gray-900">{group.label}</p>
                             <p className="text-xs text-gray-500">{group.items.length} photo{group.items.length === 1 ? '' : 's'}</p>
                           </div>
                           {extraPhotos.length > 0 && (
                             <Button
                               variant="ghost"
                               size="icon"
                               onClick={() => toggleGroup(group.key)}
                               className="rounded-full border border-gray-200"
                               aria-label={isExpanded ? 'Collapse photos' : 'Expand photos'}
                             >
                               <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                             </Button>
                           )}
                         </div>
                         <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4">
                           {basePhotos.map((photo, index) => {
                            const feedback = photoFeedbackMap[photo.id]
                            return (
                              <button
                                key={photo.id}
                                onClick={() => openPhotoModal(group.items, index)}
                                className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm text-left group"
                              >
                                <div className="relative">
                                  <img src={photo.photo_data} alt="task" className="w-full h-40 object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
                                  <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-white/80 px-2 py-1 text-[11px] font-medium text-gray-600">
                                    <ImageIcon className="h-3 w-3" />
                                    <span>{index + 1}/{group.items.length}</span>
                                  </div>
                                  {feedback && (
                                    <div className={`absolute bottom-2 right-2 rounded-full px-2 py-1 text-[10px] font-semibold text-white ${feedback === 'up' ? 'bg-emerald-500' : 'bg-rose-500'}`}>
                                      {feedback === 'up' ? 'Liked' : 'Flagged'}
                                    </div>
                                  )}
                                </div>
                                <div className="p-2 text-[11px] text-gray-500 flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {formatDateTime(photo.photo_timestamp)}
                                </div>
                              </button>
                            )
                          })}
                          {extraPhotos.length > 0 && (
                            <div className={`col-span-full grid grid-cols-2 md:grid-cols-4 gap-4 overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-[800px] opacity-100 mt-4' : 'max-h-0 opacity-0'}`}>
                              {extraPhotos.map((photo, extraIndex) => {
                                const absoluteIndex = extraIndex + 4
                                const feedback = photoFeedbackMap[photo.id]
                                return (
                                  <button
                                    key={photo.id}
                                    onClick={() => openPhotoModal(group.items, absoluteIndex)}
                                    className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm text-left group"
                                  >
                                    <div className="relative">
                                      <img src={photo.photo_data} alt="task" className="w-full h-40 object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
                                      <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-white/80 px-2 py-1 text-[11px] font-medium text-gray-600">
                                        <ImageIcon className="h-3 w-3" />
                                        <span>{absoluteIndex + 1}/{group.items.length}</span>
                                      </div>
                                      {feedback && (
                                        <div className={`absolute bottom-2 right-2 rounded-full px-2 py-1 text-[10px] font-semibold text-white ${feedback === 'up' ? 'bg-emerald-500' : 'bg-rose-500'}`}>
                                          {feedback === 'up' ? 'Liked' : 'Flagged'}
                                        </div>
                                      )}
                                    </div>
                                    <div className="p-2 text-[11px] text-gray-500 flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      {formatDateTime(photo.photo_timestamp)}
                                    </div>
                                  </button>
                                )
                              })}
                            </div>
                          )}
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
                  <div className="flex flex-col items-center gap-3 rounded-full border border-[#d9e3ff] bg-white px-6 py-3 shadow-sm sm:flex-row sm:gap-6">
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                      <Clock className="h-4 w-4 text-[#00339B]" />
                      {formatTimeOnly(currentPhoto.photo_timestamp)}
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
