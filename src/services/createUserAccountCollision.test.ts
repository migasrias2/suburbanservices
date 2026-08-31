import { describe, it, expect, vi, beforeEach } from 'vitest'
import { installTestLocalStorage } from '@/test/localStorage'

/**
 * The client half of "tell the admin who already has that number".
 *
 * customerOnboardingService.test.ts covers describeFunctionError thoroughly and
 * stops there. readCollidingUser and DuplicateIdentityError.existing — the code
 * that actually carries the holder to the dialog in UsersPage — have no test at
 * all. The server half has the same hole (see
 * adminCreateUserCollisionLookup.test.ts), so the feature shipped in ab141b2 is
 * untested end to end on BOTH sides of the wire.
 *
 * Only the network is mocked here. createUserAccount itself is the unit under
 * test and is imported for real.
 */

let getSessionImpl: () => Promise<unknown>
let invokeImpl: () => Promise<unknown>

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getSession: () => getSessionImpl() },
    functions: { invoke: () => invokeImpl() },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
    rpc: async () => ({ data: [], error: null }),
  },
}))

vi.mock('./qrService', () => ({ QRService: {}, AREA_TASKS: {} }))

const { createUserAccount, DuplicateIdentityError } = await import('./customerOnboardingService')

const newCleaner = {
  role: 'cleaner' as const,
  firstName: 'Ana',
  lastName: 'Silva',
  phone: '07700 900321',
}

const HOLDER_UID = '11111111-1111-4111-8111-111111111111'

/** Exactly the shape supabase-js hands back for a non-2xx edge function reply. */
const functionsHttpError = (status: number, body: unknown) => ({
  message: 'Edge Function returned a non-2xx status code',
  context: new Response(JSON.stringify(body), { status }),
})

/** The 409 body admin-create-user sends when it could name the holder. */
const collisionBody = {
  error: 'That number already has an account.',
  existingUserId: HOLDER_UID,
  existingName: 'Ana Costa',
  existingRole: 'cleaner',
  existingIsActive: false,
}

const rejectWith = (status: number, body: unknown) => {
  invokeImpl = async () => ({ data: null, error: functionsHttpError(status, body) })
}

/** The thrown error, or a failure if the call unexpectedly succeeded. */
const createAndCatch = async (): Promise<unknown> => {
  try {
    await createUserAccount(newCleaner)
  } catch (err) {
    return err
  }
  throw new Error('createUserAccount resolved when it should have thrown')
}

beforeEach(() => {
  installTestLocalStorage()
  getSessionImpl = async () => ({ data: { session: { user: { id: 'live-admin' } } }, error: null })
  invokeImpl = async () => ({ data: null, error: null })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('a 409 that names the holder', () => {
  beforeEach(() => rejectWith(409, collisionBody))

  it('throws DuplicateIdentityError, which is what makes UsersPage keep the dialog open', async () => {
    // UsersPage.submitAdd branches on `err instanceof DuplicateIdentityError &&
    // err.existing`. A plain Error there means the admin gets a toast that is
    // gone in seconds instead of a link to the person holding the number.
    expect(await createAndCatch()).toBeInstanceOf(DuplicateIdentityError)
  })

  it('carries the holder id', async () => {
    const err = (await createAndCatch()) as InstanceType<typeof DuplicateIdentityError>

    expect(err.existing?.userId).toBe(HOLDER_UID)
  })

  it('carries the holder name', async () => {
    const err = (await createAndCatch()) as InstanceType<typeof DuplicateIdentityError>

    expect(err.existing?.name).toBe('Ana Costa')
  })

  it('carries the deactivated flag, which is why the admin could not find them', async () => {
    const err = (await createAndCatch()) as InstanceType<typeof DuplicateIdentityError>

    expect(err.existing?.isActive).toBe(false)
  })

  it('keeps the message AND the holder from one response body', async () => {
    /**
     * createUserAccount reads the SAME Response twice: describeFunctionError
     * does context.clone().text(), then readCollidingUser does it again. If the
     * second read comes back empty the admin gets the message with no holder —
     * the exact dead end the feature exists to remove — and it would fail
     * silently, because readCollidingUser swallows the parse error and
     * returns null.
     */
    const err = (await createAndCatch()) as InstanceType<typeof DuplicateIdentityError>

    expect(err.message).toBe('That number already has an account.')
    expect(err.existing).not.toBeNull()
  })
})

describe('a 409 the function could not attach a holder to', () => {
  it('is still a DuplicateIdentityError', async () => {
    rejectWith(409, { error: 'That number already has an account.' })

    expect(await createAndCatch()).toBeInstanceOf(DuplicateIdentityError)
  })

  it('reports no holder rather than inventing one', async () => {
    rejectWith(409, { error: 'That number already has an account.' })
    const err = (await createAndCatch()) as InstanceType<typeof DuplicateIdentityError>

    expect(err.existing).toBeNull()
  })

  it('still tells the admin the number is taken', async () => {
    rejectWith(409, { error: 'That number already has an account.' })
    const err = (await createAndCatch()) as InstanceType<typeof DuplicateIdentityError>

    expect(err.message).toBe('That number already has an account.')
  })
})

describe('a 409 whose holder fields are not trustworthy', () => {
  it('ignores a role the app does not have', async () => {
    rejectWith(409, { ...collisionBody, existingRole: 'superuser' })
    const err = (await createAndCatch()) as InstanceType<typeof DuplicateIdentityError>

    expect(err.existing).toBeNull()
  })

  it('ignores a missing holder id', async () => {
    rejectWith(409, { ...collisionBody, existingUserId: undefined })
    const err = (await createAndCatch()) as InstanceType<typeof DuplicateIdentityError>

    expect(err.existing).toBeNull()
  })

  it('treats an absent active flag as active, matching the row default', async () => {
    rejectWith(409, { ...collisionBody, existingIsActive: undefined })
    const err = (await createAndCatch()) as InstanceType<typeof DuplicateIdentityError>

    expect(err.existing?.isActive).toBe(true)
  })
})

describe('failures that are not a collision', () => {
  it('does not dress a 403 up as a duplicate identity', async () => {
    rejectWith(403, { error: 'Not authorized' })

    expect(await createAndCatch()).not.toBeInstanceOf(DuplicateIdentityError)
  })

  it('does not dress a 500 up as a duplicate identity', async () => {
    rejectWith(500, { error: 'boom' })

    expect(await createAndCatch()).not.toBeInstanceOf(DuplicateIdentityError)
  })
})

describe('a 200 that is not actually a created account', () => {
  it('refuses a response with no userId rather than reporting success', async () => {
    // The admin would otherwise be shown a password for an account that does
    // not exist, and would hand it to a new starter.
    invokeImpl = async () => ({ data: { password: 'swift-otter-42' }, error: null })

    await expect(createUserAccount(newCleaner)).rejects.toThrow()
  })

  it('refuses a response with no password rather than reporting success', async () => {
    invokeImpl = async () => ({ data: { userId: 'new-uuid' }, error: null })

    await expect(createUserAccount(newCleaner)).rejects.toThrow()
  })
})

/**
 * WITHDRAWN 2026-08-31 — there was a block here asserting that createUserAccount
 * survives a 409 whose Response body has already been consumed.
 *
 * Gaby was right and I was wrong. functions-js 2.4.6 throws FunctionsHttpError
 * at `if (!response.ok)` BEFORE reading the body (FunctionsClient.js), and its
 * constructor only stores the Response (types.js:18-22). Per the fetch spec
 * clone() tees the stream, so the original's bodyUsed stays false and the second
 * clone in readCollidingUser is legal. This app installs no custom fetch, no
 * Sentry hook and no interceptor -- supabase.ts is a bare createClient.
 *
 * I could not name anything in the real client path that sets bodyUsed = true,
 * so the test was manufacturing its own precondition. That is not evidence of a
 * defect, and a test that can only fail in a state production cannot reach
 * teaches the team to ignore red. Deleted rather than weakened.
 *
 * The property worth keeping is the positive one, and it is still asserted above:
 * "keeps the message AND the holder from one response body" exercises the double
 * clone on the path that production actually takes.
 */

describe('a login that exists with no staff record behind it', () => {
  /**
   * Maria's fix adds a distinct 409: orphanedLogin, for an identity held by an
   * auth user with no cleaners/managers/admins row. The remedy is different
   * from a normal duplicate -- there is no person to go and look at -- so the
   * wording has to survive the trip to the browser intact. Nothing on the
   * client had a test for it.
   */
  const orphanBody = {
    error:
      'That number already has a login, but no staff record is linked to it. ' +
      'An administrator needs to remove that login before this person can be added.',
    orphanedLogin: true,
  }

  it('passes the orphaned-login explanation through to the admin unchanged', async () => {
    rejectWith(409, orphanBody)
    const err = (await createAndCatch()) as Error

    expect(err.message).toBe(orphanBody.error)
  })

  it('reports no holder, because there genuinely is not one', async () => {
    rejectWith(409, orphanBody)
    const err = (await createAndCatch()) as InstanceType<typeof DuplicateIdentityError>

    expect(err.existing).toBeNull()
  })

  it('tells the admin what has to happen next', async () => {
    rejectWith(409, orphanBody)
    const err = (await createAndCatch()) as Error

    expect(err.message).toMatch(/remove that login/i)
  })
})
