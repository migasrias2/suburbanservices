import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { PageHeader, FilterStrip } from '@/components/layout/PageHeader'
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
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary/40 border-t-transparent" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType={userType} userName={userName}>
      <div className="mx-auto w-full max-w-6xl py-1 sm:py-8">
        <PageHeader
          title="Live Dashboard"
          description="Who's on site right now, today's clock events, and the latest task photos."
        />

        <div className="mb-6 grid grid-cols-2 gap-2.5 sm:mb-8 sm:gap-4 lg:grid-cols-4">
          <StatCard icon={<Activity className="h-5 w-5" />} label="Active now" value={stats.active} accent="bg-primary/10 text-primary" />
          <StatCard icon={<LogIn className="h-5 w-5" />} label="Clock-ins today" value={stats.clockIns} accent="bg-primary/10 text-primary" />
          <StatCard icon={<LogOut className="h-5 w-5" />} label="Clock-outs today" value={stats.clockOuts} accent="bg-destructive/10 text-destructive" />
          <StatCard icon={<Camera className="h-5 w-5" />} label="Photos today" value={stats.photos} accent="bg-primary/10 text-primary" />
        </div>

        {isLoading && !data ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="space-y-8">
            {data?.reviewQueue.length ? (
              <section>
                <div className="mb-3 flex items-baseline justify-between px-1">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-warning">
                    Shifts to check before payroll
                  </h2>
                  <span className="text-xs font-medium text-muted-foreground">{data.reviewQueue.length}</span>
                </div>
                <div className="overflow-hidden rounded-3xl border border-warning/30 bg-warning/5">
                  {data.reviewQueue.slice(0, 8).map((s, idx) => (
                    <div
                      key={s.id}
                      className={`flex items-start justify-between gap-3 px-4 py-4 sm:gap-4 sm:px-5 ${idx > 0 ? 'border-t border-warning/30' : ''}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-base font-medium text-foreground">{s.cleanerName ?? 'Unknown'}</span>
                          {s.autoClosedAt ? (
                            <span className="shrink-0 rounded-full bg-warning/5 px-2 py-0.5 text-caption2 font-semibold uppercase tracking-wider text-warning">
                              Auto-closed
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[s.customerName, s.siteName].filter(Boolean).join(' · ') || 'Site unknown'}
                          {' · '}
                          {formatDateTime(s.clockIn)}
                        </div>
                        {s.reviewReason ? (
                          <p className="mt-1 text-xs leading-snug text-warning">{s.reviewReason}</p>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-base font-semibold tabular-nums text-warning">
                          {s.durationHours != null ? `${s.durationHours}h` : '—'}
                        </div>
                        <div className="text-caption2 uppercase tracking-wider text-muted-foreground">recorded</div>
                      </div>
                    </div>
                  ))}
                  {data.reviewQueue.length > 8 ? (
                    <div className="border-t border-warning/30 px-5 py-3 text-xs text-warning">
                      + {data.reviewQueue.length - 8} more in the last 30 days
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            <section>
              <div className="mb-3 flex items-baseline justify-between px-1">
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Active right now</h2>
                <span className="text-xs font-medium text-muted-foreground">{data?.active.length ?? 0}</span>
              </div>
              {!data?.active.length ? (
                <div className="rounded-3xl border border-dashed border-border bg-card/60 py-12 text-center text-sm text-muted-foreground">
                  No one is clocked in right now.
                </div>
              ) : (
                <div className="overflow-hidden rounded-3xl border border-border bg-card">
                  {data.active.map((c, idx) => (
                    <div key={`${c.cleanerId}-${idx}`} className={`flex items-center justify-between gap-3 px-4 py-4 sm:gap-4 sm:px-5 ${idx > 0 ? 'border-t border-border' : ''}`}>
                      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                          {initials(c.cleanerName)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-base font-medium text-foreground">{c.cleanerName}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {[c.customerName, c.siteName].filter(Boolean).join(' · ') || 'Site unknown'}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-end text-right">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-primary">
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
                          </span>
                          {formatDuration(c.durationMinutes)}
                        </div>
                        <div className="text-xs text-muted-foreground">in at {formatTime(c.clockIn)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-3 flex items-baseline justify-between px-1">
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Today's shifts</h2>
                <span className="text-xs font-medium text-muted-foreground">{data?.recent.length ?? 0}</span>
              </div>
              {!data?.recent.length ? (
                <div className="rounded-3xl border border-dashed border-border bg-card/60 py-12 text-center text-sm text-muted-foreground">
                  No clock events today.
                </div>
              ) : (
                <div className="overflow-hidden rounded-3xl border border-border bg-card">
                  {data.recent.map((s, idx) => (
                    // Stacked on phones: the name and the two time pills cannot
                    // share 360px without the site line collapsing to an ellipsis.
                    <div key={s.id} className={`flex flex-col gap-2.5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 ${idx > 0 ? 'border-t border-border' : ''}`}>
                      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                          {initials(s.cleanerName)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-base font-medium text-foreground">{s.cleanerName ?? 'Unknown'}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {[s.customerName, s.siteName].filter(Boolean).join(' · ') || 'Site unknown'}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 pl-[3.25rem] text-sm sm:gap-3 sm:pl-0">
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-primary">
                          <LogIn className="h-3 w-3" />
                          {formatTime(s.clockIn)}
                        </span>
                        <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 ${s.clockOut ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>
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
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-destructive">Needs attention</h2>
                <span className="text-xs font-medium text-muted-foreground">
                  {data?.needsAttention.length ?? 0} open
                </span>
              </div>
              {!data?.needsAttention.length ? (
                <div className="rounded-3xl border border-dashed border-border bg-card/60 py-12 text-center text-sm text-muted-foreground">
                  No requests need attention right now.
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.needsAttention.map((assist) => {
                    const statusClass =
                      assist.status === 'pending'
                        ? 'border-destructive/30 bg-destructive/10 text-destructive'
                        : assist.status === 'accepted'
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-destructive/30 bg-destructive/10 text-destructive'
                    const containerClass =
                      assist.status === 'pending'
                        ? 'border-destructive/30 bg-destructive/5'
                        : assist.status === 'accepted'
                        ? 'border-primary/15 bg-primary/5'
                        : 'border-destructive/30 bg-destructive/5'
                    return (
                      <div
                        key={assist.id}
                        className={`rounded-3xl border p-5 shadow-sm transition ${containerClass}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-primary">{assist.location}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{assist.customer}</p>
                          </div>
                          <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-caption2 font-semibold uppercase tracking-wide ${statusClass}`}>
                            <AlertCircle className="h-3 w-3" />
                            {assist.status}
                          </span>
                        </div>
                        {assist.issueType && (
                          <p className="mt-2 text-xs font-medium text-primary">{assist.issueType}</p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-caption2 text-muted-foreground">
                          <span className="font-semibold text-destructive">
                            Reported {formatDateTime(assist.reportedAt)}
                          </span>
                          {assist.acceptedAt && (
                            <span className="font-semibold text-primary">
                              Accepted {formatDateTime(assist.acceptedAt)}
                              {assist.acceptedByName ? ` · ${assist.acceptedByName}` : ''}
                            </span>
                          )}
                          {assist.escalatedAt && (
                            <span className="font-semibold text-destructive">
                              Escalated {formatDateTime(assist.escalatedAt)}
                            </span>
                          )}
                          {!assist.acceptedAt && assist.escalateAfter && (
                            <span className="font-medium text-destructive">
                              Escalates after {formatDateTime(assist.escalateAfter)}
                            </span>
                          )}
                        </div>
                        {(assist.notes || assist.escalationReason) && (
                          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
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
                            className="rounded-full border-success/30 text-success hover:bg-success/10 hover:text-success"
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
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">Recently resolved</h2>
                <span className="text-xs font-medium text-muted-foreground">{data?.resolved.length ?? 0}</span>
              </div>
              {!data?.resolved.length ? (
                <div className="rounded-3xl border border-dashed border-border bg-card/60 py-12 text-center text-sm text-muted-foreground">
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
                        className={`rounded-3xl border border-border bg-primary/5 p-5 text-left shadow-sm transition hover:border-border hover:bg-primary/5 ${isOpen ? 'bg-card' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-sm font-semibold text-primary">{assist.location}</span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-caption2 font-semibold uppercase tracking-wide text-success">
                            <CheckCircle2 className="h-3 w-3" />
                            Resolved
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{assist.customer}</p>
                        {assist.issueType && (
                          <p className="mt-2 text-xs text-primary">{assist.issueType}</p>
                        )}
                        <p className="mt-3 text-caption2 text-muted-foreground">
                          Reported {formatDateTime(assist.reportedAt)}
                        </p>
                        {assist.resolvedAt && (
                          <p className="text-caption2 text-success">
                            Resolved {formatDateTime(assist.resolvedAt)}
                            {assist.resolvedByName ? ` · ${assist.resolvedByName}` : ''}
                          </p>
                        )}
                        {!isOpen ? (
                          <p className="mt-2 text-caption2 font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            Show more
                          </p>
                        ) : (
                          <div className="mt-3 rounded-2xl border border-border bg-card/80 p-3 text-xs text-muted-foreground">
                            <p className="text-caption2 font-semibold uppercase tracking-[0.18em] text-muted-foreground">
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
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Task photos · last 7 days</h2>
                <span className="text-xs font-medium text-muted-foreground">{visiblePhotos.length} of {data?.photos.length ?? 0}</span>
              </div>

              <FilterStrip>
                <button
                  type="button"
                  onClick={() => setPhotoDayFilter('all')}
                  className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-medium transition ${
                    photoDayFilter === 'all'
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-muted-foreground hover:border-border'
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
                      className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-medium transition ${
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : count === 0
                          ? 'cursor-not-allowed border-border bg-card text-muted-foreground'
                          : 'border-border bg-card text-muted-foreground hover:border-border'
                      }`}
                    >
                      {d.label} · {count}{isLoading ? ' · loading…' : ''}
                    </button>
                  )
                })}
              </FilterStrip>

              {!fixtureGroups.length ? (
                <div className="rounded-3xl border border-dashed border-border bg-card/60 py-12 text-center text-sm text-muted-foreground">
                  {photoDayFilter === 'all' ? 'No photos yet.' : 'No photos for this day.'}
                </div>
              ) : (
                <div className="space-y-3">
                  {fixtureGroups.map((g) => (
                    <div key={g.key} className="rounded-3xl border border-border bg-card p-4">
                      <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {g.areaLabel}
                            {g.description ? <span className="font-normal text-muted-foreground"> · {g.description}</span> : null}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
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
                                className="group relative h-32 w-32 shrink-0 overflow-hidden rounded-2xl border border-border bg-muted transition hover:border-border hover:shadow-md"
                              >
                                <img
                                  src={photoData}
                                  alt={p.photoDescription ?? 'Task photo'}
                                  className="h-full w-full object-cover transition group-hover:scale-105"
                                  loading="lazy"
                                />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 text-left">
                                  <div className="truncate text-caption2 font-medium text-white">{p.cleanerName ?? 'Unknown'}</div>
                                  <div className="text-caption2 text-white/80">
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
                              className="group relative h-32 w-32 shrink-0 overflow-hidden rounded-2xl border border-dashed border-border bg-muted text-left transition hover:border-border hover:bg-muted"
                            >
                              <div className="flex h-full w-full flex-col items-center justify-center px-2 text-center">
                                <Camera className="h-5 w-5 text-muted-foreground" />
                                <div className="mt-1 text-caption2 font-medium text-muted-foreground">
                                  {dayLabel(pDayKey)} · {formatTime(p.photoTimestamp)}
                                </div>
                                <div className="mt-0.5 truncate text-caption2 text-muted-foreground">{p.cleanerName ?? 'Unknown'}</div>
                                <div className="mt-1 text-caption2 font-semibold uppercase tracking-wider text-primary">
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
            className="fixed inset-0 z-[100] flex items-center justify-center bg-card/30 p-4 backdrop-blur-sm"
            onClick={() => setOpenPhoto(null)}
          >
            <div
              className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl border border-border bg-card shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] ring-1 ring-border"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOpenPhoto(null)}
                  className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-card/90 text-foreground shadow-md hover:bg-card"
                >
                  <X className="h-4 w-4" />
                </button>
                <img
                  src={openPhoto.photoData ?? ''}
                  alt={openPhoto.photoDescription ?? 'Task photo'}
                  className="block max-h-[55dvh] w-full object-cover"
                />
              </div>
              <div className="space-y-1 px-6 py-4">
                <div className="text-base font-medium text-foreground">{openPhoto.cleanerName ?? 'Unknown'}</div>
                <div className="text-xs text-muted-foreground">
                  {openPhoto.areaType ? `${openPhoto.areaType} · ` : ''}
                  {new Date(openPhoto.photoTimestamp).toLocaleString()}
                </div>
                {openPhoto.photoDescription && (
                  <div className="pt-1 text-sm text-foreground">{openPhoto.photoDescription}</div>
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
    <div className="rounded-2xl border border-border bg-card p-4 sm:rounded-3xl sm:p-5">
      <div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full sm:mb-3 sm:h-9 sm:w-9 ${accent}`}>
        {icon}
      </div>
      <div className="text-title1 font-semibold leading-none text-foreground sm:text-2xl">{value}</div>
      <div className="mt-1.5 text-caption2 uppercase tracking-wider text-muted-foreground sm:text-xs">{label}</div>
    </div>
  )
}
