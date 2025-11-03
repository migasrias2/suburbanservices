import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { endOfMonth, format, startOfMonth } from 'date-fns'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { FullScreenCalendar, type CalendarData } from '@/components/ui/fullscreen-calendar'
import { getStoredCleanerName } from '@/lib/identity'
import {
  fetchAttendanceShiftsInRange,
  fetchCleanerLogsInRange,
  type AttendanceShift,
  type CleanerLogCalendarEntry,
} from '@/services/calendarService'

const getInitialRange = () => {
  const today = new Date()
  const start = startOfMonth(today)
  const end = endOfMonth(today)
  start.setHours(0, 0, 0, 0)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

const AdminWeeklySchedulePage: React.FC = () => {
  const navigate = useNavigate()
  const [userName, setUserName] = useState<string>('')
  const [calendarRange, setCalendarRange] = useState<{ start: Date; end: Date }>(() => getInitialRange())
  const [calendarData, setCalendarData] = useState<CalendarData[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)

  useEffect(() => {
    const storedRole = localStorage.getItem('userType')
    const storedName = getStoredCleanerName()

    if (storedRole !== 'admin' || !storedName) {
      navigate('/login')
      return
    }

    setUserName(storedName)
  }, [navigate])

  const buildCalendarData = useCallback(
    (attendance: AttendanceShift[], logs: CleanerLogCalendarEntry[]): CalendarData[] => {
      const map = new Map<string, CalendarData>()

      const ensureEntry = (date: Date) => {
        const normalized = new Date(date)
        normalized.setHours(0, 0, 0, 0)
        const key = format(normalized, 'yyyy-MM-dd')
        const existing = map.get(key)
        if (existing) {
          return existing
        }
        const entry: CalendarData = { day: normalized, events: [], logs: [] }
        map.set(key, entry)
        return entry
      }

      attendance.forEach((shift) => {
        const clockInDate = new Date(shift.clockIn)
        if (Number.isNaN(clockInDate.getTime())) {
          return
        }

        const entry = ensureEntry(clockInDate)
        const clockOutDate = shift.clockOut ? new Date(shift.clockOut) : null
        const timeLabel = `${format(clockInDate, 'p')}${clockOutDate ? ` – ${format(clockOutDate, 'p')}` : ' (Active)'}`
        const nameLabel = shift.siteName ? `${shift.cleanerName} • ${shift.siteName}` : shift.cleanerName

        entry.events.push({
          id: shift.id,
          name: nameLabel,
          time: timeLabel,
          datetime: shift.clockIn,
        })
      })

      logs.forEach((log) => {
        const timestamp = new Date(log.timestamp)
        if (Number.isNaN(timestamp.getTime())) {
          return
        }

        const entry = ensureEntry(timestamp)
        entry.logs = [...(entry.logs ?? []), log]
      })

      return Array.from(map.values()).sort((a, b) => a.day.getTime() - b.day.getTime())
    },
    [],
  )

  useEffect(() => {
    if (!userName) {
      return
    }

    let isSubscribed = true

    const loadCalendar = async () => {
      setIsLoading(true)
      try {
        const [attendance, logs] = await Promise.all([
          fetchAttendanceShiftsInRange(calendarRange.start, calendarRange.end),
          fetchCleanerLogsInRange(calendarRange.start, calendarRange.end),
        ])

        if (isSubscribed) {
          setCalendarData(buildCalendarData(attendance, logs))
        }
      } catch (error) {
        if (isSubscribed) {
          console.error('Failed to load calendar data', error)
        }
      } finally {
        if (isSubscribed) {
        setIsLoading(false)
      }
      }
    }

    loadCalendar()

    return () => {
      isSubscribed = false
    }
  }, [buildCalendarData, calendarRange, userName])

  const handleMonthChange = useCallback((range: { start: Date; end: Date }) => {
    setCalendarRange((previous) => {
      const nextStart = new Date(range.start.getTime())
      const nextEnd = new Date(range.end.getTime())

      if (previous.start.getTime() === nextStart.getTime() && previous.end.getTime() === nextEnd.getTime()) {
        return previous
      }

      return { start: nextStart, end: nextEnd }
    })
  }, [])

  const emptyStateMessage = useMemo(() => 'No attendance or cleaner logs for this day.', [])

  if (!userName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-blue-50">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType="admin" userName={userName}>
      <FullScreenCalendar
        data={calendarData}
        isLoading={isLoading}
        onMonthChange={handleMonthChange}
        emptyState={emptyStateMessage}
      />
    </Sidebar07Layout>
  )
}

export default AdminWeeklySchedulePage






