import { describe, it, expect, vi, beforeEach } from 'vitest'
import { installTestLocalStorage } from '@/test/localStorage'

/**
 * Two properties, both about a session that has quietly ended.
 *
 * 1. A privileged call must not be issued at all once the session is gone.
 *    supabase-js falls back to the anon key when there is no session, so the
 *    request would arrive unauthenticated — carrying a stale localStorage id
 *    as its p_admin_id argument.
 * 2. When one does come back 401, the admin must be told something they can
 *    act on. "Not authenticated" is true and useless.
 */

let getSessionImpl: () => Promise<unknown>
let invokeImpl: (fn: string, opts: { body: unknown }) => Promise<unknown>
const invokeCalls: Array<{ fn: string; body: unknown }> = []

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getSession: () => getSessionImpl() },
    functions: {
      invoke: (fn: string, opts: { body: unknown }) => {
        invokeCalls.push({ fn, body: opts.body })
        return invokeImpl(fn, opts)
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    rpc: async () => ({ data: [], error: null }),
  },
}))

vi.mock('./qrService', () => ({
  QRService: {},
  AREA_TASKS: {},
}))

const { createUserAccount, describeFunctionError } = await import('./customerOnboardingService')
const { SessionExpiredError } = await import('../lib/sessionIdentity')

const LIVE_ID = 'live-admin-uuid'
const STALE_ID = 'stale-admin-uuid-from-a-dead-session'

const newCleaner = {
  role: 'cleaner' as const,
  firstName: 'Ana',
  lastName: 'Silva',
  phone: '07700 900321',
}

const created = {
  userId: 'new-uuid',
  password: 'swift-otter-42',
  role: 'cleaner',
  firstName: 'Ana',
  lastName: 'Silva',
  identifier: '+447700900321',
  recorded: true,
}

beforeEach(() => {
  installTestLocalStorage()
  invokeCalls.length = 0
  getSessionImpl = async () => ({ data: { session: { user: { id: LIVE_ID } } }, error: null })
  invokeImpl = async () => ({ data: created, error: null })
  localStorage.setItem('userId', STALE_ID)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('createUserAccount with no live session', () => {
  beforeEach(() => {
    getSessionImpl = async () => ({ data: { session: null }, error: null })
  })

  it('throws SessionExpiredError', async () => {
    await expect(createUserAccount(newCleaner)).rejects.toBeInstanceOf(SessionExpiredError)
  })

  it('issues NO request at all', async () => {
    // The whole point: not "the server rejects it", but "it is never sent".
    await createUserAccount(newCleaner).catch(() => undefined)

    expect(invokeCalls).toEqual([])
  })

  it('never sends the stale localStorage id', async () => {
    await createUserAccount(newCleaner).catch(() => undefined)

    expect(JSON.stringify(invokeCalls)).not.toContain(STALE_ID)
  })
})

describe('createUserAccount with a live session', () => {
  it('identifies the admin from the session, not from localStorage', async () => {
    await createUserAccount(newCleaner)

    expect((invokeCalls[0].body as { adminId: string }).adminId).toBe(LIVE_ID)
  })

  it('does not carry the stale id anywhere in the payload', async () => {
    await createUserAccount(newCleaner)

    expect(JSON.stringify(invokeCalls[0].body)).not.toContain(STALE_ID)
  })

  it('returns the created user', async () => {
    await expect(createUserAccount(newCleaner)).resolves.toMatchObject({ userId: 'new-uuid' })
  })
})

describe('what the admin is told when a call comes back 401', () => {
  const httpError = (status: number, body: unknown) => ({
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify(body), { status }),
  })

  it('says the session expired, not "Not authenticated"', async () => {
    const message = await describeFunctionError(httpError(401, { error: 'Not authenticated' }), 'fallback')

    expect(message).toBe('Your session has expired. Please sign in again.')
  })

  it('tells the admin how to fix it', async () => {
    const message = await describeFunctionError(httpError(401, { error: 'Not authenticated' }), 'fallback')

    expect(message).toMatch(/sign in again/i)
  })

  it('still surfaces the real reason on a 403', async () => {
    const message = await describeFunctionError(httpError(403, { error: 'Not authorized' }), 'fallback')

    expect(message).toBe('Not authorized')
  })

  it('still surfaces the real reason on a 409', async () => {
    const message = await describeFunctionError(
      httpError(409, { error: 'That number already has an account.' }),
      'fallback',
    )

    expect(message).toBe('That number already has an account.')
  })

  it('does not swallow a non-Response error', async () => {
    const message = await describeFunctionError(new Error('offline'), 'fallback')

    expect(message).toBe('offline')
  })

  it('falls back to the status line when the body is unreadable', async () => {
    const message = await describeFunctionError(
      { message: 'x', context: new Response('', { status: 500 }) },
      'Failed to create user',
    )

    expect(message).toBe('Failed to create user (HTTP 500)')
  })
})
