import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"

import { Sidebar07Layout } from "@/components/layout/Sidebar07Layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { fetchManagerRecentActivity } from "@/services/managerService"

type ActivityRow = Awaited<ReturnType<typeof fetchManagerRecentActivity>>[number]

const formatDateTime = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—"

const INITIAL_STATE = {
  managerId: "",
  managerName: "",
}

export default function ManagerActivityPage() {
  const navigate = useNavigate()
  const [{ managerId, managerName }, setIdentity] = useState(INITIAL_STATE)
  const [role, setRole] = useState<"manager" | "ops_manager">("manager")
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [error, setError] = useState<string>("")
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null)
  const [isPreviewVisible, setIsPreviewVisible] = useState(false)
  const hidePreviewTimeoutRef = useRef<number | null>(null)

  const clearHidePreviewTimeout = useCallback(() => {
    if (hidePreviewTimeoutRef.current !== null) {
      window.clearTimeout(hidePreviewTimeoutRef.current)
      hidePreviewTimeoutRef.current = null
    }
  }, [])

  const hidePreviewWithDelay = useCallback(() => {
    clearHidePreviewTimeout()
    hidePreviewTimeoutRef.current = window.setTimeout(() => {
      hidePreviewTimeoutRef.current = null
      setIsPreviewVisible(false)
    }, 120)
  }, [clearHidePreviewTimeout])

  useEffect(() => {
    return () => {
      clearHidePreviewTimeout()
    }
  }, [clearHidePreviewTimeout])

  useEffect(() => {
    if (!isPreviewVisible && previewPhotoUrl) {
      const timeout = window.setTimeout(() => {
        setPreviewPhotoUrl(null)
      }, 200)

      return () => {
        window.clearTimeout(timeout)
      }
    }
  }, [isPreviewVisible, previewPhotoUrl])

  useEffect(() => {
    const storedUserType = localStorage.getItem("userType")
    const storedManagerId = localStorage.getItem("userId")
    const storedManagerName = localStorage.getItem("userName")

    if ((storedUserType !== "manager" && storedUserType !== "ops_manager") || !storedManagerId || !storedManagerName) {
      navigate("/login")
      return
    }

    if (storedUserType === "ops_manager") {
      setRole("ops_manager")
    } else {
      setRole("manager")
    }
    setIdentity({ managerId: storedManagerId, managerName: storedManagerName })
  }, [navigate])

  useEffect(() => {
    if (!managerId) return

    const loadActivity = async () => {
      setIsLoading(true)
      try {
        const rows = await fetchManagerRecentActivity(managerId, 120, role)
        setActivity(rows)
        setError("")
      } catch (err) {
        console.error("Failed to load manager activity", err)
        setError(
          err instanceof Error
            ? err.message
            : "We couldn't load the recent activity right now. Please try again shortly."
        )
      } finally {
        setIsLoading(false)
      }
    }

    loadActivity()
  }, [managerId, role])

  const handleRefresh = useCallback(async () => {
    if (!managerId) return
    setIsRefreshing(true)
    try {
      const rows = await fetchManagerRecentActivity(managerId, 120, role)
      setActivity(rows)
      setError("")
    } catch (err) {
      console.error("Failed to refresh manager activity", err)
      setError(
        err instanceof Error
          ? err.message
          : "We couldn't refresh the activity feed. Please try again shortly."
      )
    } finally {
      setIsRefreshing(false)
    }
  }, [managerId, role])

  const tableContent = useMemo(() => {
    if (isLoading) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-gray-500">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[#00339B] border-t-transparent" />
          <p>Loading the latest cleaner history…</p>
        </div>
      )
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <p className="text-sm text-gray-600">{error}</p>
          <Button onClick={handleRefresh} disabled={isRefreshing} variant="gradient" className="px-6 py-2">
            Try again
          </Button>
        </div>
      )
    }

    if (!activity.length) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#E0ECFF] text-[#00339B] shadow-inner">
            📸
          </div>
          <h3 className="text-lg font-semibold text-[#1F2937]">No task or photo activity yet</h3>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            When cleaners submit areas or upload photos, they will appear here automatically after a refresh.
          </p>
        </div>
      )
    }

    return (
      <div className="overflow-hidden rounded-3xl border border-white/60 bg-white/80 shadow-[0_24px_60px_rgba(15,35,95,0.08)] backdrop-blur">
        <Table className="text-sm">
          <TableHeader className="bg-gradient-to-r from-white via-[#E0ECFF] to-white">
            <TableRow className="border-transparent">
              <TableHead className="w-[110px] text-xs font-semibold uppercase tracking-wide text-gray-500">Photo</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-500">Cleaner</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-500">Activity</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-500">Location</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-500">Tasks</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-500">Completed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activity.map((row) => (
              <TableRow
                key={row.id}
                className={cn(
                  "border-transparent bg-white/75 transition-all hover:bg-[#E0ECFF]/60",
                  "text-gray-700"
                )}
              >
                <TableCell
                  onMouseEnter={() => {
                    if (row.photo_url) {
                      clearHidePreviewTimeout()
                      setPreviewPhotoUrl(row.photo_url)
                      window.requestAnimationFrame(() => setIsPreviewVisible(true))
                    }
                  }}
                  onMouseLeave={() => {
                    hidePreviewWithDelay()
                  }}
                >
                  {row.photo_url ? (
                    <div className="h-16 w-16 overflow-hidden rounded-2xl border border-[#9DB8FF] bg-[#E0ECFF]/70 shadow-sm">
                      <img src={row.photo_url} alt="Task preview" className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">No photo</span>
                  )}
                </TableCell>
                <TableCell className="text-sm font-semibold text-gray-900">
                  <div className="flex flex-col">
                    <span>{row.cleaner_name || "Cleaner"}</span>
                    {row.cleaner_id && (
                      <span className="text-[11px] uppercase tracking-wide text-gray-400">{row.cleaner_id}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <span className="inline-flex rounded-full bg-[#E0ECFF] px-3 py-1 text-xs font-semibold text-[#00339B] shadow-sm">
                    {row.action}
                  </span>
                  {(row.detail || row.comments) && (
                    <div className="mt-2 space-y-1 text-xs text-gray-500">
                      {row.detail && <p className="text-gray-600">{row.detail}</p>}
                      {row.comments && <p className="text-gray-500">{row.comments}</p>}
                    </div>
                  )}
                </TableCell>
                <TableCell className="max-w-[220px] text-sm text-gray-600">
                  {row.site && (
                    <p className="font-medium text-gray-900">{row.site}</p>
                  )}
                  {row.area && (
                    <p className={cn(row.site ? "mt-1" : undefined)}>{row.area}</p>
                  )}
                  {!row.site && !row.area && <span className="text-xs uppercase tracking-wide text-gray-400">—</span>}
                </TableCell>
                <TableCell className="text-sm text-gray-600">
                  {(() => {
                    const totalTasks = typeof row.total_task_count === "number" ? row.total_task_count : null
                    const completedTasks = typeof row.completed_task_count === "number" ? row.completed_task_count : null
                    const hasTaskData = (totalTasks !== null && totalTasks > 0) || (completedTasks !== null && completedTasks > 0)

                    if (!hasTaskData) {
                      return row.entry_type === "task" ? <span className="text-xs text-gray-400">No tasks logged</span> : <span className="text-xs text-gray-400">—</span>
                    }

                    const resolvedTotal = totalTasks ?? completedTasks ?? 0
                    const resolvedCompleted = completedTasks ?? 0
                    const progress = resolvedTotal > 0 ? Math.min(100, Math.round((resolvedCompleted / resolvedTotal) * 100)) : 0

                    return (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-900">{resolvedCompleted}</span>
                          <span className="text-xs uppercase tracking-wide text-gray-400">of</span>
                          <span className="text-sm font-semibold text-gray-900">{resolvedTotal}</span>
                          <span className="text-xs uppercase tracking-wide text-gray-400">tasks</span>
                        </div>
                        {resolvedTotal > 0 && (
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                            <div
                              className="h-full rounded-full bg-[#00339B]/80 transition-all"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </TableCell>
                <TableCell className="text-sm text-gray-500">{formatDateTime(row.timestamp)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }, [activity, error, handleRefresh, isLoading, isRefreshing])

  if (!managerId || !managerName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-white via-[#FFF9C4] to-[#FFE27A]">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#00339B] border-t-transparent" />
      </div>
    )
  }

  const photoPreviewOverlay =
    typeof document !== "undefined" && previewPhotoUrl
      ? createPortal(
          <div
            className={cn(
              "pointer-events-none fixed inset-0 z-[100] flex items-center justify-center transition duration-200 ease-out",
              previewPhotoUrl ? "backdrop-blur-[18px]" : "backdrop-blur-0"
            )}
          >
            <div
              className={cn(
                "pointer-events-none overflow-hidden rounded-[32px] border border-white/90 bg-white/98 shadow-[0_30px_80px_rgba(15,35,95,0.25)] transition-transform duration-200 ease-out",
                isPreviewVisible ? "scale-100 opacity-100" : "scale-90 opacity-0"
              )}
            >
              <img src={previewPhotoUrl} alt="Task preview enlarged" className="max-h-[82vh] w-auto object-contain" />
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <Sidebar07Layout userType={role} userName={managerName}>
      <div className="space-y-8">
        <div className="text-left">
          <h1 className="text-3xl font-semibold text-[#141414]">Recent Cleaner Activity</h1>
          <p className="mt-2 text-sm text-gray-500">
            {role === "ops_manager"
              ? "Review the latest area submissions and task photos from every cleaner in the operation."
              : "Review the latest area submissions and task photos from the cleaners assigned to you."}
          </p>
        </div>

        <Card className="rounded-3xl border border-white/60 bg-white/70 shadow-[0_18px_40px_rgba(15,35,95,0.08)] backdrop-blur">
          <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-lg font-semibold text-gray-900">Recent updates</CardTitle>
              <p className="text-sm text-gray-500">Review the latest area submissions and task photos from your cleaners.</p>
            </div>
            <Button
              onClick={handleRefresh}
              disabled={isRefreshing || isLoading}
              variant="gradient"
              className="px-6 py-2"
            >
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {tableContent}
          </CardContent>
        </Card>
      </div>
      {photoPreviewOverlay}
    </Sidebar07Layout>
  )
}


