import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { useToast } from '@/components/ui/use-toast'
import { Activity, Clock, Camera, LogIn, LogOut, X, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getStoredCleanerName } from '@/lib/identity'
import {
  loadLiveDashboard,
  loadPhotoDataForDay,
  type LiveDashboardData,
  type TaskPhoto,
  type ActiveAssist,
} from '@/services/adminDashboardService'
import { AssistRequestService } from '@/services/assistRequestService'

const REFRESH_MS = 30_000

function formatTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayKey(): string {
  return dayKey(new Date().toISOString())
}

function dayLabel(key: string): string {
  const today = todayKey()
  if (key === today) return 'Today'
  const yest = new Date()
  yest.setDate(yest.getDate() - 1)
  if (key === dayKey(yest.toISOString())) return 'Yest'
  return new Date(key).toLocaleDateString([], { weekday: 'short' })
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function initials(name: string | null | undefined) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase() || '?'
}

export default function AdminLiveDashboardPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [userType, setUserType] = useState<'admin' | null>(null)
  const [userName, setUserName] = useState('')
  const [data, setData] = useState<LiveDashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [openPhoto, setOpenPhoto] = useState<TaskPhoto | null>(null)
  const [expandedResolved, setExpandedResolved] = useState<string | null>(null)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [photoDayFilter, setPhotoDayFilter] = useState<string>('all')
  const [loadedPhotoData, setLoadedPhotoData] = useState<Record<number, string>>({})
  const [loadingDay, setLoadingDay] = useState<string | null>(null)

  useEffect(() => {
    const storedType = localStorage.getItem('userType')
    const storedId = localStorage.getItem('userId')
    const storedName = getStoredCleanerName()
    if (storedType !== 'admin' || !storedId || !storedName) {
      navigate('/login')
      return
    }
    setUserType('admin')
    setUserName(storedName)
  }, [navigate])

  const resolveRequest = async (assist: ActiveAssist) => {
    const adminId = localStorage.getItem('userId') ?? ''
    if (!adminId) {
      toast({ title: 'Missing session', variant: 'destructive' })
      return
    }
    setResolvingId(assist.id)
    try {
      await AssistRequestService.resolveAsManager({
        requestId: assist.id,
        managerId: adminId,
        managerName: userName,
      })
      toast({ title: 'Marked resolved' })
      await refresh()
    } catch (err: any) {
      toast({ title: 'Could not resolve', description: err?.message ?? 'Unknown error', variant: 'destructive' })
    } finally {
      setResolvingId(null)
    }
  }

  const refresh = async () => {
    try {
      const next = await loadLiveDashboard()
      setData(next)
    } catch (err: any) {
      toast({ title: 'Could not load dashboard', description: err?.message ?? 'Unknown error', variant: 'destructive' })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (userType !== 'admin') return
    refresh()
    const t = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userType])

  const stats = useMemo(() => {
    const today = todayKey()
    const photosToday = data?.photos.filter((p) => dayKey(p.photoTimestamp) === today).length ?? 0
    return {
      active: data?.active.length ?? 0,
      clockIns: data?.todayClockIns ?? 0,
      clockOuts: data?.todayClockOuts ?? 0,
      photos: photosToday,
    }
  }, [data])

  const dayBuckets = useMemo(() => {
    const result: { key: string; label: string }[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - i)
      const key = dayKey(d.toISOString())
      result.push({ key, label: dayLabel(key) })
    }
    return result
  }, [])

  const dayCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    data?.photos.forEach((p) => {
      const k = dayKey(p.photoTimestamp)
      counts[k] = (counts[k] ?? 0) + 1
    })
    return counts
  }, [data])

  const visiblePhotos = useMemo(() => {
    if (!data) return [] as TaskPhoto[]
    if (photoDayFilter === 'all') return data.photos
    return data.photos.filter((p) => dayKey(p.photoTimestamp) === photoDayFilter)
  }, [data, photoDayFilter])

  const fixtureGroups = useMemo(() => {
    type Group = { key: string; areaLabel: string; description: string | null; photos: TaskPhoto[] }
    const groups = new Map<string, Group>()
    visiblePhotos.forEach((p) => {
      const key = p.qrCodeId ?? `__cleaner_${p.cleanerId ?? 'unknown'}`
      let g = groups.get(key)
      if (!g) {
        g = {
          key,
          areaLabel: p.areaType ? capitalize(p.areaType) : 'Unspecified area',
          description: p.photoDescription ?? null,
          photos: [],
        }
        groups.set(key, g)
      }
      g.photos.push(p)
      if (!g.description && p.photoDescription) g.description = p.photoDescription
    })
    return Array.from(groups.values()).sort((a, b) => {
      const ta = new Date(a.photos[0].photoTimestamp).getTime()
      const tb = new Date(b.photos[0].photoTimestamp).getTime()
      return tb - ta
    })
  }, [visiblePhotos])

  const getPhotoData = (p: TaskPhoto): string | null => p.photoData ?? loadedPhotoData[p.id] ?? null

  const loadDayPhotos = async (day: string) => {
    if (day === todayKey()) return
    if (loadingDay === day) return
    if (data?.photos.some((p) => dayKey(p.photoTimestamp) === day && getPhotoData(p))) return
    setLoadingDay(day)
    try {
      const map = await loadPhotoDataForDay(day)
      setLoadedPhotoData((prev) => ({ ...prev, ...map }))
    } catch (err: any) {
      toast({ title: 'Could not load photos', description: err?.message ?? 'Unknown error', variant: 'destructive' })
    } finally {
      setLoadingDay(null)
    }
  }

  const handleDayFilter = (day: string) => {
    setPhotoDayFilter(day)
    if (day !== 'all') void loadDayPhotos(day)
  }

  if (!userType || !userName) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType={userType} userName={userName}>
      <div className="mx-auto w-full max-w-6xl py-4 sm:py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-gray-900 sm:text-4xl">Live Dashboard</h1>
          <p className="mt-2 text-gray-500">Who's on site right now, today's clock events, and the latest task photos.</p>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard icon={<Activity className="h-5 w-5" />} label="Active now" value={stats.active} accent="bg-[#00339B]/10 text-[#00339B]" />
          <StatCard icon={<LogIn className="h-5 w-5" />} label="Clock-ins today" value={stats.clockIns} accent="bg-[#00339B]/10 text-[#00339B]" />
          <StatCard icon={<LogOut className="h-5 w-5" />} label="Clock-outs today" value={stats.clockOuts} accent="bg-red-100 text-red-600" />
          <StatCard icon={<Camera className="h-5 w-5" />} label="Photos today" value={stats.photos} accent="bg-[#00339B]/10 text-[#00339B]" />
        </div>

        {isLoading && !data ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="space-y-8">
            <section>
              <div className="mb-3 flex items-baseline justify-between px-1">
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Active right now</h2>
                <span className="text-xs font-medium text-gray-400">{data?.active.length ?? 0}</span>
              </div>
              {!data?.active.length ? (
                <div className="rounded-3xl border border-dashed border-gray-200 bg-white/60 py-12 text-center text-sm text-gray-400">
                  No one is clocked in right now.
                </div>
              ) : (
                <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white">
                  {data.active.map((c, idx) => (
                    <div key={`${c.cleanerId}-${idx}`} className={`flex items-center justify-between gap-4 px-5 py-4 ${idx > 0 ? 'border-t border-gray-50' : ''}`}>
                      <div className="flex items-center gap-4 min-w-0 flex-1">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#00339B]/10 text-sm font-semibold text-[#00339B]">
                          {initials(c.cleanerName)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-base font-medium text-gray-900">{c.cleanerName}</div>
                          <div className="truncate text-xs text-gray-500">
                            {[c.customerName, c.siteName].filter(Boolean).join(' · ') || 'Site unknown'}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end text-right">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-[#00339B]">
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                          </span>
                          {formatDuration(c.durationMinutes)}
                        </div>
                        <div className="text-xs text-gray-400">in at {formatTime(c.clockIn)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-3 flex items-baseline justify-between px-1">
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Today's shifts</h2>
                <span className="text-xs font-medium text-gray-400">{data?.recent.length ?? 0}</span>
              </div>
              {!data?.recent.length ? (
                <div className="rounded-3xl border border-dashed border-gray-200 bg-white/60 py-12 text-center text-sm text-gray-400">
                  No clock events today.
                </div>
              ) : (
                <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white">
                  {data.recent.map((s, idx) => (
                    <div key={s.id} className={`flex items-center justify-between gap-4 px-5 py-4 ${idx > 0 ? 'border-t border-gray-50' : ''}`}>
                      <div className="flex items-center gap-4 min-w-0 flex-1">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#00339B]/10 text-sm font-semibold text-[#00339B]">
                          {initials(s.cleanerName)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-base font-medium text-gray-900">{s.cleanerName ?? 'Unknown'}</div>
                          <div className="truncate text-xs text-gray-500">
                            {[s.customerName, s.siteName].filter(Boolean).join(' · ') || 'Site unknown'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#00339B]/10 px-3 py-1 text-[#00339B]">
                          <LogIn className="h-3 w-3" />
                          {formatTime(s.clockIn)}
                        </span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 ${s.clockOut ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-400'}`}>
                          <LogOut className="h-3 w-3" />
                          {s.clockOut ? formatTime(s.clockOut) : 'on shift'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-3 flex items-baseline justify-between px-1">
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[#ff8a9b]">Needs attention</h2>
                <span className="text-xs font-medium text-gray-400">
                  {data?.needsAttention.length ?? 0} open
                </span>
              </div>
              {!data?.needsAttention.length ? (
                <div className="rounded-3xl border border-dashed border-gray-200 bg-white/60 py-12 text-center text-sm text-gray-400">
                  No requests need attention right now.
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.needsAttention.map((assist) => {
                    const statusClass =
                      assist.status === 'pending'
                        ? 'border-red-200 bg-red-50 text-red-600'
                        : assist.status === 'accepted'
                        ? 'border-[#00339B]/30 bg-[#00339B]/10 text-[#00339B]'
                        : 'border-red-300 bg-red-100 text-red-700'
                    const containerClass =
                      assist.status === 'pending'
                        ? 'border-red-100 bg-red-50/30'
                        : assist.status === 'accepted'
                        ? 'border-[#00339B]/15 bg-[#00339B]/5'
                        : 'border-red-200 bg-red-50/60'
                    return (
                      <div
                        key={assist.id}
                        className={`rounded-3xl border p-5 shadow-sm transition ${containerClass}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[#00339B]">{assist.location}</p>
                            <p className="mt-1 text-xs text-gray-500">{assist.customer}</p>
                          </div>
                          <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusClass}`}>
                            <AlertCircle className="h-3 w-3" />
                            {assist.status}
                          </span>
                        </div>
                        {assist.issueType && (
                          <p className="mt-2 text-xs font-medium text-[#0f235f]">{assist.issueType}</p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500">
                          <span className="font-semibold text-red-600">
                            Reported {formatDateTime(assist.reportedAt)}
                          </span>
                          {assist.acceptedAt && (
                            <span className="font-semibold text-[#00339B]">
                              Accepted {formatDateTime(assist.acceptedAt)}
                              {assist.acceptedByName ? ` · ${assist.acceptedByName}` : ''}
                            </span>
                          )}
                          {assist.escalatedAt && (
                            <span className="font-semibold text-red-700">
                              Escalated {formatDateTime(assist.escalatedAt)}
                            </span>
                          )}
                          {!assist.acceptedAt && assist.escalateAfter && (
                            <span className="font-medium text-red-500">
                              Escalates after {formatDateTime(assist.escalateAfter)}
                            </span>
                          )}
                        </div>
                        {(assist.notes || assist.escalationReason) && (
                          <div className="mt-3 space-y-1 text-xs text-gray-500">
                            {assist.notes && <p>Notes: {assist.notes}</p>}
                            {assist.escalationReason && <p>Escalation reason: {assist.escalationReason}</p>}
                          </div>
                        )}
                        <div className="mt-4 flex justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={resolvingId === assist.id}
                            onClick={() => resolveRequest(assist)}
                            className="rounded-full border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                          >
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            {resolvingId === assist.id ? 'Resolving…' : 'Mark resolved'}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            <section>
              <div className="mb-3 flex items-baseline justify-between px-1">
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8aa5ff]">Recently resolved</h2>
                <span className="text-xs font-medium text-gray-400">{data?.resolved.length ?? 0}</span>
              </div>
              {!data?.resolved.length ? (
                <div className="rounded-3xl border border-dashed border-gray-200 bg-white/60 py-12 text-center text-sm text-gray-400">
                  No recent resolutions yet.
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.resolved.map((assist) => {
                    const isOpen = expandedResolved === assist.id
                    return (
                      <button
                        key={assist.id}
                        type="button"
                        onClick={() => setExpandedResolved((id) => (id === assist.id ? null : assist.id))}
                        className={`rounded-3xl border border-blue-100 bg-blue-50/40 p-5 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/60 ${isOpen ? 'bg-white' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-sm font-semibold text-[#00339B]">{assist.location}</span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Resolved
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500">{assist.customer}</p>
                        {assist.issueType && (
                          <p className="mt-2 text-xs text-[#0f235f]">{assist.issueType}</p>
                        )}
                        <p className="mt-3 text-[11px] text-gray-400">
                          Reported {formatDateTime(assist.reportedAt)}
                        </p>
                        {assist.resolvedAt && (
                          <p className="text-[11px] text-emerald-600">
                            Resolved {formatDateTime(assist.resolvedAt)}
                            {assist.resolvedByName ? ` · ${assist.resolvedByName}` : ''}
                          </p>
                        )}
                        {!isOpen ? (
                          <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                            Show more
                          </p>
                        ) : (
                          <div className="mt-3 rounded-2xl border border-blue-100 bg-white/80 p-3 text-xs text-gray-600">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
                              Issue details
                            </p>
                            <p className="mt-1">
                              {assist.issueType ? `Issue: ${assist.issueType}` : 'Issue: Not provided'}
                            </p>
                            <p className="mt-1">
                              {assist.issueDescription
                                ? `Description: ${assist.issueDescription}`
                                : 'Description: Not provided'}
                            </p>
                            {assist.notes && <p className="mt-1">Notes: {assist.notes}</p>}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </section>

            <section>
              <div className="mb-3 flex items-baseline justify-between px-1">
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Task photos · last 7 days</h2>
                <span className="text-xs font-medium text-gray-400">{visiblePhotos.length} of {data?.photos.length ?? 0}</span>
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPhotoDayFilter('all')}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    photoDayFilter === 'all'
                      ? 'border-[#00339B] bg-[#00339B] text-white'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  All 7d · {data?.photos.length ?? 0}
                </button>
                {dayBuckets.map((d) => {
                  const count = dayCounts[d.key] ?? 0
                  const active = photoDayFilter === d.key
                  const isLoading = loadingDay === d.key
                  return (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => handleDayFilter(d.key)}
                      disabled={count === 0 || isLoading}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                        active
                          ? 'border-[#00339B] bg-[#00339B] text-white'
                          : count === 0
                          ? 'cursor-not-allowed border-gray-100 bg-white text-gray-300'
                          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      {d.label} · {count}{isLoading ? ' · loading…' : ''}
                    </button>
                  )
                })}
              </div>

              {!fixtureGroups.length ? (
                <div className="rounded-3xl border border-dashed border-gray-200 bg-white/60 py-12 text-center text-sm text-gray-400">
                  {photoDayFilter === 'all' ? 'No photos yet.' : 'No photos for this day.'}
                </div>
              ) : (
                <div className="space-y-3">
                  {fixtureGroups.map((g) => (
                    <div key={g.key} className="rounded-3xl border border-gray-100 bg-white p-4">
                      <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-gray-900">
                            {g.areaLabel}
                            {g.description ? <span className="font-normal text-gray-400"> · {g.description}</span> : null}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs text-gray-400">
                          {g.photos.length} photo{g.photos.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {g.photos.map((p) => {
                          const photoData = getPhotoData(p)
                          const pDayKey = dayKey(p.photoTimestamp)
                          const isPDayLoading = loadingDay === pDayKey
                          if (photoData) {
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => setOpenPhoto({ ...p, photoData })}
                                className="group relative h-32 w-32 shrink-0 overflow-hidden rounded-2xl border border-gray-100 bg-gray-100 transition hover:border-gray-300 hover:shadow-md"
                              >
                                <img
                                  src={photoData}
                                  alt={p.photoDescription ?? 'Task photo'}
                                  className="h-full w-full object-cover transition group-hover:scale-105"
                                  loading="lazy"
                                />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 text-left">
                                  <div className="truncate text-[10px] font-medium text-white">{p.cleanerName ?? 'Unknown'}</div>
                                  <div className="text-[10px] text-white/80">
                                    {dayLabel(pDayKey)} · {formatTime(p.photoTimestamp)}
                                  </div>
                                </div>
                              </button>
                            )
                          }
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => loadDayPhotos(pDayKey)}
                              disabled={isPDayLoading}
                              className="group relative h-32 w-32 shrink-0 overflow-hidden rounded-2xl border border-dashed border-gray-200 bg-gray-50 text-left transition hover:border-gray-300 hover:bg-gray-100"
                            >
                              <div className="flex h-full w-full flex-col items-center justify-center px-2 text-center">
                                <Camera className="h-5 w-5 text-gray-300" />
                                <div className="mt-1 text-[10px] font-medium text-gray-500">
                                  {dayLabel(pDayKey)} · {formatTime(p.photoTimestamp)}
                                </div>
                                <div className="mt-0.5 truncate text-[10px] text-gray-400">{p.cleanerName ?? 'Unknown'}</div>
                                <div className="mt-1 text-[9px] font-semibold uppercase tracking-wider text-[#00339B]">
                                  {isPDayLoading ? 'Loading…' : 'Tap to load'}
                                </div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {openPhoto && createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-white/30 p-4 backdrop-blur-sm"
            onClick={() => setOpenPhoto(null)}
          >
            <div
              className="w-full max-w-lg overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] ring-1 ring-black/5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenPhoto(null)}
                  className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-md hover:bg-white"
                >
                  <X className="h-4 w-4" />
                </button>
                <img
                  src={openPhoto.photoData ?? ''}
                  alt={openPhoto.photoDescription ?? 'Task photo'}
                  className="block w-full max-h-[60vh] object-cover"
                />
              </div>
              <div className="space-y-1 px-6 py-4">
                <div className="text-base font-medium text-gray-900">{openPhoto.cleanerName ?? 'Unknown'}</div>
                <div className="text-xs text-gray-500">
                  {openPhoto.areaType ? `${openPhoto.areaType} · ` : ''}
                  {new Date(openPhoto.photoTimestamp).toLocaleString()}
                </div>
                {openPhoto.photoDescription && (
                  <div className="pt-1 text-sm text-gray-700">{openPhoto.photoDescription}</div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
      </div>
    </Sidebar07Layout>
  )
}

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: number
  accent: string
}

function StatCard({ icon, label, value, accent }: StatCardProps) {
  return (
    <div className="rounded-3xl border border-gray-100 bg-white p-5">
      <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full ${accent}`}>
        {icon}
      </div>
      <div className="text-2xl font-semibold text-gray-900">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wider text-gray-400">{label}</div>
    </div>
  )
}
