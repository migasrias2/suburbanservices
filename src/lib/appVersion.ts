import { isAppReloadIdle, onAppReloadIdle } from './appReloadGuard'

export const VERSION_CHECK_INTERVAL_MS = 5 * 60_000
const REQUEST_TIMEOUT_MS = 10_000

/** Production only. Network/old-deploy errors never interrupt the current app. */
export function startAppVersionChecks(
  buildId: string,
  options: { canReload: () => boolean; reload?: () => void },
): () => void {
  let stopped = false
  let checking = false
  let updateAvailable = false
  let reloading = false
  let controller: AbortController | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  const reload = options.reload ?? (() => window.location.reload())

  const tryReload = () => {
    if (stopped || reloading || !updateAvailable || document.visibilityState === 'hidden') return
    if (!isAppReloadIdle() || !options.canReload()) return
    reloading = true
    reload()
  }
  // Let the caller finish its state updates before navigating away.
  const whenIdle = () => {
    clearTimeout(retry)
    retry = setTimeout(tryReload, 0)
  }
  const unsubscribe = onAppReloadIdle(whenIdle)

  const check = async () => {
    tryReload()
    if (stopped || checking || reloading) return
    checking = true
    controller = new AbortController()
    const timer = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch('/version.json', { cache: 'no-store', signal: controller.signal })
      if (!response.ok) return
      const data: unknown = await response.json()
      const version = (data as { buildId?: unknown } | null)?.buildId
      if (typeof version !== 'string' || !version.trim()) return
      updateAvailable = version !== buildId
      tryReload()
    } catch {
      // Offline, an old deployment without a manifest, or a failed request.
    } finally {
      clearTimeout(timer)
      checking = false
    }
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') void check()
  }
  const onOnline = () => { void check() }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  const interval = setInterval(() => void check(), VERSION_CHECK_INTERVAL_MS)
  void check()

  return () => {
    stopped = true
    controller?.abort()
    clearInterval(interval)
    clearTimeout(retry)
    unsubscribe()
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', onOnline)
  }
}
