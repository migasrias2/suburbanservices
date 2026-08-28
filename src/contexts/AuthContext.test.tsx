import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'

/**
 * The session is the app's access decision, so these tests are about what
 * happens at the MOMENT it ends — not what a page concluded when it mounted.
 *
 * auth-js emits SIGNED_OUT for any non-retryable token refresh, not only for a
 * deliberate sign-out. A phone left closed overnight comes back with a rotated
 * refresh token and gets SIGNED_OUT on wake. Everything below treats that as
 * the normal case, because for a cleaner in the field it is.
 */

import { installTestLocalStorage as installStorage } from '@/test/localStorage'

installStorage()

type AuthListener = (event: string, session: unknown) => void

let listener: AuthListener | null = null
let getSessionImpl: () => Promise<unknown>
let rpcImpl: (fn: string, args: unknown) => Promise<unknown>
const unsubscribe = vi.fn()
const rpcCalls: Array<{ fn: string; args: unknown }> = []

vi.mock('../services/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => getSessionImpl(),
      onAuthStateChange: (cb: AuthListener) => {
        listener = cb
        return { data: { subscription: { unsubscribe } } }
      },
      signInWithPassword: vi.fn(),
      signOut: vi.fn(async () => ({ error: null })),
    },
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args })
      return rpcImpl(fn, args)
    },
  },
}))

vi.mock('../lib/managerScope', () => ({
  hydrateManagerScopes: vi.fn(),
  invalidateManagerScopes: vi.fn(),
}))

const { AuthProvider, useAuth } = await import('./AuthContext')

const sessionFor = (overrides: Record<string, unknown> = {}) => ({
  access_token: 'token',
  user: {
    id: 'user-uuid-1',
    user_metadata: { app_role: 'cleaner', first_name: 'Ana', last_name: 'Silva' },
    ...overrides,
  },
})

const Probe = () => {
  const { session, isLoading, verifiedRole, roleStatus } = useAuth()
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="session">{session ? 'yes' : 'no'}</span>
      <span data-testid="role">{verifiedRole ?? 'null'}</span>
      <span data-testid="status">{roleStatus}</span>
    </div>
  )
}

const renderProvider = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )

/** Work state a cleaner accumulates mid-shift. */
const WORK_KEYS = {
  currentClockInData: '{"siteId":"site-1","at":"2026-08-27T06:00:00Z"}',
  currentClockInPhase: 'clocked_in',
  currentSiteName: 'Metalex House',
  recentClockOutAt: '2026-08-27T05:00:00Z',
}

/** Who the user is. */
const IDENTITY_KEYS = {
  userType: 'cleaner',
  userId: 'user-uuid-1',
  userName: 'Ana Silva',
  userMobile: '447700900123',
}

const seedStorage = () => {
  for (const [k, v] of Object.entries({ ...WORK_KEYS, ...IDENTITY_KEYS })) {
    localStorage.setItem(k, v)
  }
}

beforeEach(() => {
  listener = null
  rpcCalls.length = 0
  installStorage()
  getSessionImpl = async () => ({ data: { session: null } })
  rpcImpl = async () => ({ data: true, error: null })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a session ending does not destroy work in progress', () => {
  // THE ONE THAT MATTERS. A non-retryable token refresh is indistinguishable
  // from a sign-out at the auth-js level, so this fires on its own, in the
  // field, mid-shift. Wiping the clock-in leaves a cleaner clocked in with no
  // way to clock out.
  it.each(Object.keys(WORK_KEYS))('keeps %s when SIGNED_OUT fires', async (key) => {
    getSessionImpl = async () => ({ data: { session: sessionFor() } })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('session').textContent).toBe('yes'))
    seedStorage()

    await act(async () => {
      listener?.('SIGNED_OUT', null)
    })

    expect(localStorage.getItem(key)).toBe(WORK_KEYS[key as keyof typeof WORK_KEYS])
  })

  it.each(Object.keys(IDENTITY_KEYS))('clears %s when SIGNED_OUT fires', async (key) => {
    getSessionImpl = async () => ({ data: { session: sessionFor() } })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('session').textContent).toBe('yes'))
    seedStorage()

    await act(async () => {
      listener?.('SIGNED_OUT', null)
    })

    expect(localStorage.getItem(key)).toBeNull()
  })

  it('keeps the clock-in through a cold boot that finds no session', async () => {
    // The overnight case: app reopened, refresh token already dead.
    seedStorage()

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))
    expect(localStorage.getItem('currentClockInData')).toBe(WORK_KEYS.currentClockInData)
    expect(localStorage.getItem('userId')).toBeNull()
  })
})

describe('the session state reacts rather than being read once', () => {
  it('drops the session when SIGNED_OUT fires on a mounted app', async () => {
    getSessionImpl = async () => ({ data: { session: sessionFor() } })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('session').textContent).toBe('yes'))

    await act(async () => {
      listener?.('SIGNED_OUT', null)
    })

    expect(screen.getByTestId('session').textContent).toBe('no')
  })

  it('forgets the verified role when the session ends', async () => {
    getSessionImpl = async () => ({ data: { session: sessionFor() } })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('role').textContent).toBe('cleaner'))

    await act(async () => {
      listener?.('SIGNED_OUT', null)
    })

    await waitFor(() => expect(screen.getByTestId('role').textContent).toBe('null'))
  })

  it('adopts a session that arrives after mount', async () => {
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('session').textContent).toBe('no'))

    await act(async () => {
      listener?.('SIGNED_IN', sessionFor())
    })

    expect(screen.getByTestId('session').textContent).toBe('yes')
  })

  it('unsubscribes on unmount so a late event cannot set state on a dead tree', async () => {
    const { unmount } = renderProvider()
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))

    unmount()

    expect(unsubscribe).toHaveBeenCalled()
  })
})

describe('cold load never flashes a signed-out state at a valid session', () => {
  it('reports isLoading until the session has been restored', async () => {
    let release: (v: unknown) => void = () => undefined
    getSessionImpl = () =>
      new Promise((resolve) => {
        release = resolve
      })

    renderProvider()

    expect(screen.getByTestId('loading').textContent).toBe('true')
    expect(screen.getByTestId('session').textContent).toBe('no')

    await act(async () => {
      release({ data: { session: sessionFor() } })
    })

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))
    expect(screen.getByTestId('session').textContent).toBe('yes')
  })

  it('stops loading even when getSession REJECTS', async () => {
    // A rejection, not a resolved null. Without the .finally this hangs on a
    // spinner forever and the app is simply dead on that device.
    getSessionImpl = () => Promise.reject(new Error('network down'))

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))
  })

  it('treats a rejected getSession as no session rather than a half state', async () => {
    getSessionImpl = () => Promise.reject(new Error('network down'))

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))
    expect(screen.getByTestId('session').textContent).toBe('no')
  })
})

describe('the role is verified against the database, not the token', () => {
  it('asks has_app_role for the claimed role', async () => {
    getSessionImpl = async () => ({ data: { session: sessionFor() } })
    renderProvider()

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('verified'))
    expect(rpcCalls).toContainEqual({ fn: 'has_app_role', args: { p_roles: ['cleaner'] } })
  })

  it('refuses the claim when has_app_role says no', async () => {
    // metadata says admin; the admins table disagrees.
    getSessionImpl = async () => ({
      data: { session: sessionFor({ user_metadata: { app_role: 'admin' } }) },
    })
    rpcImpl = async () => ({ data: false, error: null })

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('verified'))
    expect(screen.getByTestId('role').textContent).toBe('null')
  })

  it('reports error, not "no", when the check cannot be reached', async () => {
    getSessionImpl = async () => ({ data: { session: sessionFor() } })
    rpcImpl = async () => ({ data: null, error: { message: 'network error' } })

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'))
  })

  it('grants nothing while the check is failing', async () => {
    getSessionImpl = async () => ({ data: { session: sessionFor() } })
    rpcImpl = async () => ({ data: null, error: { message: 'network error' } })

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'))
    expect(screen.getByTestId('role').textContent).toBe('null')
  })

  it('keeps the user signed in when the check fails', async () => {
    // Ejecting a cleaner in the field over one failed request is worse than
    // asking them to try again.
    getSessionImpl = async () => ({ data: { session: sessionFor() } })
    rpcImpl = async () => ({ data: null, error: { message: 'network error' } })

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'))
    expect(screen.getByTestId('session').textContent).toBe('yes')
  })

  it('reports error when the rpc rejects outright', async () => {
    getSessionImpl = async () => ({ data: { session: sessionFor() } })
    rpcImpl = () => Promise.reject(new Error('offline'))

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'))
  })
})
