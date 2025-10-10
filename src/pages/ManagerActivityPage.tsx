import { useCallback, useEffect, useMemo, useState } from "react"
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

export default function ManagerActivityPage() {
  const navigate = useNavigate()
  const [managerId, setManagerId] = useState<string>("")
  const [managerName, setManagerName] = useState<string>("")
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [activity, setActivity] = useState<ActivityRow[]>([])
  const [error, setError] = useState<string>("")

  useEffect(() => {
    const storedUserType = localStorage.getItem("userType")
    const storedManagerId = localStorage.getItem("userId")
    const storedManagerName = localStorage.getItem("userName")

    if (storedUserType !== "manager" || !storedManagerId || !storedManagerName) {
      navigate("/login")
      return
    }

    setManagerId(storedManagerId)
    setManagerName(storedManagerName)
  }, [navigate])

  useEffect(() => {
    if (!managerId) {
      return
    }

    const loadActivity = async () => {
      setIsLoading(true)
      try {
        const rows = await fetchManagerRecentActivity(managerId, 120)
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
  }, [managerId])

  const handleRefresh = useCallback(async () => {
    if (!managerId) return
    setIsRefreshing(true)
    try {
      const rows = await fetchManagerRecentActivity(managerId, 120)
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
  }, [managerId])

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
          <Button onClick={handleRefresh} disabled={isRefreshing} variant="pill-primary">
            Try again
          </Button>
        </div>
      )
    }

    if (!activity.length) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#E0ECFF] text-[#00339B] shadow-inner">
            ✨
          </div>
          <h3 className="text-lg font-semibold text-[#1F2937]">No recent activity yet</h3>
          <p className="mt-1 max-w-xs text-sm text-gray-500">
            Once your team clocks in, scans an area, or uploads task photos, the feed updates automatically.
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
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-gray-500">Details</TableHead>
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
                <TableCell>
                  {row.photo_url ? (
                    <div className="relative h-16 w-16 overflow-hidden rounded-2xl border border-[#9DB8FF] bg-[#E0ECFF]/70 shadow-sm">
                      <img
                        src={row.photo_url}
                        alt="Task preview"
                        className="h-full w-full object-cover"
                      />
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
                </TableCell>
                <TableCell className="max-w-[280px] text-sm text-gray-600">
                  {row.site && (
                    <p>
                      <span className="text-xs uppercase tracking-wide text-gray-400">Site</span>
                      <br />
                      <span className="font-medium text-gray-900">{row.site}</span>
                    </p>
                  )}
                  {row.area && (
                    <p className={cn(row.site ? "mt-2" : undefined)}>
                      <span className="text-xs uppercase tracking-wide text-gray-400">Area</span>
                      <br />
                      <span className="font-medium text-gray-900">{row.area}</span>
                    </p>
                  )}
                  {row.comments && (
                    <p className="mt-2 text-sm text-gray-600">{row.comments}</p>
                  )}
                  {!row.site && !row.area && !row.comments && row.detail && (
                    <p className="text-sm text-gray-600">{row.detail}</p>
                  )}
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

  return (
    <Sidebar07Layout userType="manager" userName={managerName}>
      <div className="space-y-8">
        <div className="text-left">
          <h1 className="text-3xl font-semibold text-[#141414]">Recent Cleaner Activity</h1>
          <p className="mt-2 text-sm text-gray-500">
            Track the latest scans and completed tasks across all cleaners assigned to you.
          </p>
        </div>

        <Card className="rounded-3xl border border-white/60 bg-white/70 shadow-[0_18px_40px_rgba(15,35,95,0.08)] backdrop-blur">
          <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-lg font-semibold text-gray-900">Recent updates</CardTitle>
              <p className="text-sm text-gray-500">Track clock-ins, area progress, and task photos from your cleaners in one feed.</p>
            </div>
            <Button
              onClick={handleRefresh}
              disabled={isRefreshing || isLoading}
              variant="pill"
              className="bg-[#00339B] px-6 py-2 text-white hover:bg-[#00297A]"
            >
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {tableContent}
          </CardContent>
        </Card>
      </div>
    </Sidebar07Layout>
  )
}


