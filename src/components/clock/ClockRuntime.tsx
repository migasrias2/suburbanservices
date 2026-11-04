import { useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { startClockRuntime } from '@/lib/clock/clockRuntime'
import { useClockSwitches } from '@/lib/clock/clockFlags'
import { warmUpDecoder } from '@/lib/scanner/decoder'

/**
 * Starts the clock outbox's background sending and the kill-switch reads once
 * for the whole app. Runs whatever clock_v2 says, so scans saved on the phone
 * are still sent after the switch is turned off.
 *
 * For people who scan, it also downloads the scanner (the ~410 KB gzip wasm)
 * once the app is idle, while they probably still have signal, rather than
 * when the camera opens in a basement (review M2). Renders nothing.
 */
const SCANNING_ROLES = new Set(['cleaner', 'ops_manager'])
const IDLE_FALLBACK_MS = 2_000

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (id: number) => void
}

const whenIdle = (task: () => void): (() => void) => {
  const w = window as IdleWindow
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(task, { timeout: 10_000 })
    return () => w.cancelIdleCallback?.(id)
  }
  const timer = setTimeout(task, IDLE_FALLBACK_MS)
  return () => clearTimeout(timer)
}

export function ClockRuntime(): null {
  const { appUser } = useAuth()
  const { scannerV2 } = useClockSwitches()
  const scans = Boolean(appUser && SCANNING_ROLES.has(appUser.userType))

  useEffect(() => startClockRuntime(), [])

  useEffect(() => {
    if (!scans || !scannerV2) return undefined
    return whenIdle(() => void warmUpDecoder())
  }, [scans, scannerV2])

  return null
}
