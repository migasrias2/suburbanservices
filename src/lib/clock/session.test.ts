import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('@/services/supabase', () => ({ supabase: { auth } }))

const { readSessionState, SESSION_TIMEOUT_MS } = await import('./session')

const setOnline = (online: boolean) =>
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })

beforeEach(() => {
  auth.getSession.mockReset()
  setOnline(true)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('readSessionState', () => {
  it('signed in: who', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    expect(await readSessionState()).toEqual({ status: 'signed_in', userId: 'u1' })
  })

  it('no session and no error: signed out', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    expect(await readSessionState()).toEqual({ status: 'signed_out' })
  })

  it('a refresh that failed on the network is "no signal", not "signed out"', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 0 } })
    expect(await readSessionState()).toEqual({ status: 'unreachable' })
  })

  it('a phone that says it is offline is "no signal", without asking', async () => {
    setOnline(false)
    expect(await readSessionState()).toEqual({ status: 'unreachable' })
    expect(auth.getSession).not.toHaveBeenCalled()
  })

  it('a session check that never answers (auth lock, stalled refresh) is "no signal" after the time limit (review M1)', async () => {
    vi.useFakeTimers()
    auth.getSession.mockReturnValue(new Promise(() => {}))
    const result = readSessionState()
    await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS)
    expect(await result).toEqual({ status: 'unreachable' })
    expect(SESSION_TIMEOUT_MS).toBeLessThanOrEqual(5_000)
  })

  it('a throw is "no signal"', async () => {
    auth.getSession.mockRejectedValue(new Error('boom'))
    expect(await readSessionState()).toEqual({ status: 'unreachable' })
  })
})
