import { useEffect } from 'react'
import { startAppVersionChecks } from '@/lib/appVersion'
import { canReloadClock } from '@/lib/clock/clockRuntime'

declare const __APP_BUILD_ID__: string

export function AppVersionUpdater(): null {
  useEffect(() => {
    if (!import.meta.env.PROD || typeof __APP_BUILD_ID__ !== 'string') return
    return startAppVersionChecks(__APP_BUILD_ID__, { canReload: canReloadClock })
  }, [])
  return null
}
