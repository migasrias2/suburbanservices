import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { getClockView, shiftStore, type ClockView } from '@/lib/clock/clockRuntime'
import type { CurrentShiftView } from '@/lib/clock/currentShift'

/**
 * "Am I clocked in?" for the new clock path: the server's current_shift(),
 * kept current by clock results and scans waiting on the phone (see
 * lib/clock/currentShift.ts). Asks the server on mount and whenever the app
 * comes back to the front.
 */
export function useCurrentShift(userId: string): {
  view: ClockView
  /** False until the first answer (server, cache or a waiting scan) is known. */
  ready: boolean
  refresh: () => Promise<CurrentShiftView>
} {
  // The store's version changes on every update; reading it re-renders us.
  useSyncExternalStore(shiftStore.subscribe, shiftStore.version, shiftStore.version)
  const [asked, setAsked] = useState(false)
  const refresh = useCallback(() => shiftStore.refresh(userId), [userId])

  useEffect(() => {
    if (!userId) return undefined
    refresh()
      .catch((error: unknown) => console.warn('Could not check the current shift', error))
      .finally(() => setAsked(true))
    const onFocus = () => void refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId, refresh])

  const view = getClockView(userId)
  return { view, ready: asked || !userId || view.status !== 'unknown', refresh }
}
