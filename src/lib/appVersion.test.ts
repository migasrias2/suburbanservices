import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startAppVersionChecks, VERSION_CHECK_INTERVAL_MS } from './appVersion'
import { holdAppReload, isAppReloadIdle } from './appReloadGuard'

let stop = () => {}
const reload = vi.fn()
const request = vi.fn()
const response = (buildId: unknown) => ({ ok: true, json: async () => ({ buildId }) })

beforeEach(() => {
  vi.useFakeTimers()
  reload.mockReset()
  request.mockReset().mockResolvedValue(response('current'))
  vi.stubGlobal('fetch', request)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
})
afterEach(() => {
  stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const start = (canReload = () => true) => {
  stop = startAppVersionChecks('current', { canReload, reload })
}

describe('production version checks', () => {
  it('checks without cache at startup, on foreground/online and every five minutes', async () => {
    start()
    await vi.advanceTimersByTimeAsync(0)
    expect(request).toHaveBeenCalledWith('/version.json', expect.objectContaining({ cache: 'no-store' }))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(VERSION_CHECK_INTERVAL_MS)
    expect(request).toHaveBeenCalledTimes(4)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads once for a different build', async () => {
    request.mockResolvedValue(response('new'))
    start()
    await vi.advanceTimersByTimeAsync(0)
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(VERSION_CHECK_INTERVAL_MS)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('defers across overlapping saves/scans, including repeated release calls', async () => {
    const releaseScan = holdAppReload()
    const releaseSave = holdAppReload()
    request.mockResolvedValue(response('new'))
    start()
    await vi.advanceTimersByTimeAsync(0)
    expect(reload).not.toHaveBeenCalled()
    releaseScan()
    releaseScan()
    await vi.advanceTimersByTimeAsync(0)
    expect(isAppReloadIdle()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    releaseSave()
    await vi.advanceTimersByTimeAsync(0)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not reload when a new scan starts before the deferred reload runs', async () => {
    const release = holdAppReload()
    request.mockResolvedValue(response('new'))
    start()
    await vi.advanceTimersByTimeAsync(0)
    release()
    const releaseNext = holdAppReload()
    await vi.advanceTimersByTimeAsync(0)
    expect(reload).not.toHaveBeenCalled()
    releaseNext()
    await vi.advanceTimersByTimeAsync(0)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('waits for memory-only queued scans to be safe, and for the page to be visible', async () => {
    let durable = false
    request.mockResolvedValue(response('new'))
    start(() => durable)
    await vi.advanceTimersByTimeAsync(0)
    expect(reload).not.toHaveBeenCalled()
    durable = true
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(0)
    expect(reload).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(reload).toHaveBeenCalledOnce()
  })

  it.each([null, {}, '', 4])('ignores malformed build ids: %s', async (id) => {
    request.mockResolvedValue(response(id))
    start()
    await vi.advanceTimersByTimeAsync(0)
    expect(reload).not.toHaveBeenCalled()
  })

  it('ignores failed requests, non-JSON responses and HTTP errors', async () => {
    request.mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => { throw new Error('HTML') } })
    start()
    await vi.advanceTimersByTimeAsync(VERSION_CHECK_INTERVAL_MS * 2)
    expect(request).toHaveBeenCalledTimes(3)
    expect(reload).not.toHaveBeenCalled()
  })

  it('aborts a slow request and removes all triggers when stopped', async () => {
    request.mockImplementation((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    start()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(request.mock.calls[0][1].signal.aborted).toBe(true)
    stop()
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(VERSION_CHECK_INTERVAL_MS)
    expect(request).toHaveBeenCalledOnce()
  })

  it('ignores a response that arrives after unmount', async () => {
    let finish!: (value: ReturnType<typeof response>) => void
    request.mockReturnValue(new Promise(resolve => { finish = resolve }))
    start()
    stop()
    finish(response('new'))
    await vi.advanceTimersByTimeAsync(0)
    expect(reload).not.toHaveBeenCalled()
  })
})
