import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/services/supabase'
import { fetchShiftsInRange } from '@/services/shiftsService'

/**
 * Clock-out is a second physical QR scan at the end of a shift — exactly when
 * someone is tired and heading for the door. 17.8% of shifts in the last 90
 * days ended up unusable for payroll because of it, 167 of them running past
 * 24 hours.
 *
 * The hourly server sweep repairs those after the fact. This nudges the cleaner
 * before it happens, which is much cheaper than a payroll correction.
 *
 * Scope note: this reaches the cleaner while the app is open, plus a local
 * OS notification when the tab is merely backgrounded. Reaching a fully closed
 * app needs a service worker and web-push infrastructure, which is a separate
 * piece of work.
 */

/** Used when the cleaner has no rostered shift to measure against. */
const DEFAULT_SHIFT_HOURS = 9

/** How long after the due time before we nudge again. */
const RENUDGE_MINUTES = 30

const POLL_MS = 60_000

export interface ClockOutReminder {
  /** True once the shift is past its expected end. */
  isOverdue: boolean
  /** Minutes past the expected end; 0 when not overdue. */
  minutesOverdue: number
  /** Whether the due time came from a rostered shift or the fallback. */
  basis: 'rostered' | 'default' | null
  dismiss: () => void
}

const notifyOnce = (title: string, body: string) => {
  if (typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  // Only worth an OS-level notification when they aren't looking at the app.
  if (document.visibilityState === 'visible') return
  try {
    new Notification(title, { body, tag: 'clock-out-reminder', renotify: false } as NotificationOptions)
  } catch {
    // Some browsers refuse Notification construction outside a service worker.
  }
}

export function useClockOutReminder(cleanerId: string, enabled: boolean): ClockOutReminder {
  const [state, setState] = useState<{ isOverdue: boolean; minutesOverdue: number; basis: 'rostered' | 'default' | null }>({
    isOverdue: false,
    minutesOverdue: 0,
    basis: null,
  })
  const dismissedUntilRef = useRef<number>(0)
  const notifiedForRef = useRef<string | null>(null)

  const check = useCallback(async () => {
    if (!cleanerId) return

    try {
      const { data, error } = await supabase
        .from('time_attendance')
        .select('id, clock_in')
        .eq('cleaner_uuid', cleanerId)
        .is('clock_out', null)
        .order('clock_in', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error || !data) {
        setState({ isOverdue: false, minutesOverdue: 0, basis: null })
        return
      }

      const clockIn = new Date(data.clock_in as string)

      // Prefer the rostered end time; fall back to a plausible shift length.
      const dayStart = new Date(clockIn)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)

      let dueAt: Date
      let basis: 'rostered' | 'default'
      const rostered = await fetchShiftsInRange(dayStart, dayEnd, {
        cleanerId,
        publishedOnly: true,
      }).catch(() => [])

      if (rostered.length) {
        dueAt = new Date(rostered[rostered.length - 1].endAt)
        basis = 'rostered'
      } else {
        dueAt = new Date(clockIn.getTime() + DEFAULT_SHIFT_HOURS * 3600_000)
        basis = 'default'
      }

      const now = Date.now()
      const minutesOverdue = Math.max(0, Math.round((now - dueAt.getTime()) / 60000))
      const overdue = minutesOverdue > 0

      if (overdue && now >= dismissedUntilRef.current) {
        const key = `${data.id}`
        if (notifiedForRef.current !== key) {
          notifiedForRef.current = key
          notifyOnce(
            'Still clocked in',
            "Your shift looks finished. Scan the clock-out code so your hours are recorded correctly.",
          )
        }
        setState({ isOverdue: true, minutesOverdue, basis })
      } else {
        setState({ isOverdue: false, minutesOverdue, basis })
      }
    } catch (err) {
      console.warn('Clock-out reminder check failed', err)
    }
  }, [cleanerId])

  useEffect(() => {
    if (!enabled || !cleanerId) {
      setState({ isOverdue: false, minutesOverdue: 0, basis: null })
      return
    }

    check()
    const interval = setInterval(check, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, cleanerId, check])

  const dismiss = useCallback(() => {
    dismissedUntilRef.current = Date.now() + RENUDGE_MINUTES * 60_000
    setState((prev) => ({ ...prev, isOverdue: false }))
  }, [])

  return { ...state, dismiss }
}
