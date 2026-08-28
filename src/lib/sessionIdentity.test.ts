import { describe, it, expect, vi, beforeEach } from 'vitest'
import { installTestLocalStorage } from '@/test/localStorage'

/**
 * localStorage.userId outlives the session that created it — nothing sweeps it
 * and it has no expiry — so a signed-out browser could still address a
 * privileged RPC by the previous user's id. Every p_admin_id argument in this
 * codebase is such a call. These helpers make a stale id impossible rather
 * than unlikely, so what matters is that they REFUSE, not that they succeed.
 */

let getSessionImpl: () => Promise<unknown>

vi.mock('../services/supabase', () => ({
  supabase: { auth: { getSession: () => getSessionImpl() } },
}))

const { requireSessionUserId, getSessionUserId, SessionExpiredError } = await import('./sessionIdentity')

const withSession = (id: string) => async () => ({
  data: { session: { user: { id } } },
  error: null,
})

beforeEach(() => {
  installTestLocalStorage()
  getSessionImpl = withSession('live-user-id')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('requireSessionUserId', () => {
  it('returns the id from the live session', async () => {
    await expect(requireSessionUserId()).resolves.toBe('live-user-id')
  })

  it('throws SessionExpiredError when there is no session', async () => {
    getSessionImpl = async () => ({ data: { session: null }, error: null })

    await expect(requireSessionUserId()).rejects.toBeInstanceOf(SessionExpiredError)
  })

  it('throws when the session exists but carries no user', async () => {
    getSessionImpl = async () => ({ data: { session: {} }, error: null })

    await expect(requireSessionUserId()).rejects.toBeInstanceOf(SessionExpiredError)
  })

  it('throws rather than returning a value when the session read errors', async () => {
    getSessionImpl = async () => ({ data: { session: null }, error: { message: 'boom' } })

    await expect(requireSessionUserId()).rejects.toBeInstanceOf(SessionExpiredError)
  })

  it('says something the user can act on', async () => {
    getSessionImpl = async () => ({ data: { session: null }, error: null })

    await expect(requireSessionUserId()).rejects.toThrow(/sign in again/i)
  })

  it('never falls back to localStorage', async () => {
    localStorage.setItem('userId', 'stale-user-id')
    getSessionImpl = async () => ({ data: { session: null }, error: null })

    await expect(requireSessionUserId()).rejects.toBeInstanceOf(SessionExpiredError)
  })
})

describe('getSessionUserId', () => {
  it('returns the id from the live session', async () => {
    await expect(getSessionUserId()).resolves.toBe('live-user-id')
  })

  it('returns null instead of throwing when signed out', async () => {
    getSessionImpl = async () => ({ data: { session: null }, error: null })

    await expect(getSessionUserId()).resolves.toBeNull()
  })

  it('returns null when the session read errors', async () => {
    getSessionImpl = async () => ({ data: { session: null }, error: { message: 'boom' } })

    await expect(getSessionUserId()).resolves.toBeNull()
  })

  it('returns null when getSession rejects outright', async () => {
    getSessionImpl = () => Promise.reject(new Error('offline'))

    await expect(getSessionUserId()).resolves.toBeNull()
  })

  it('never returns a stale localStorage id', async () => {
    localStorage.setItem('userId', 'stale-user-id')
    getSessionImpl = async () => ({ data: { session: null }, error: null })

    await expect(getSessionUserId()).resolves.toBeNull()
  })
})
