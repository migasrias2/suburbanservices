/**
 * @vitest-environment node
 *
 * Node, not jsdom: this file transpiles the Deno Edge Function source with
 * esbuild, and esbuild refuses to run against jsdom's TextEncoder.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import { deriveSyntheticEmail } from '../lib/authHelpers'

/**
 * admin-create-user is the only way an account comes into existence, and it
 * runs in Deno against a service-role key, so it cannot be reached from a
 * normal test run and cannot be exercised safely against the live project.
 *
 * This file loads the real function source, hands it a fake Supabase admin
 * client, and drives its request handler directly. Nothing here touches a
 * network or the live database: every client method is a local stub, and the
 * assertions are about the rows the function *would* write.
 *
 * The guarantee is the whole arc, not the toast: an account this function
 * reports as created must be an account the login page can actually reach.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EDGE_FN = path.resolve(HERE, '../../supabase/functions/admin-create-user/index.ts')

const resolveLocal = (fromFile: string, spec: string): string | null => {
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

const flatten = (file: string, seen = new Set<string>()): string => {
  if (seen.has(file)) return ''
  seen.add(file)
  const source = readFileSync(file, 'utf8')
  const prelude: string[] = []
  const body = source.replace(
    /^\s*import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"];?\s*$/gm,
    (_m, spec: string) => {
      const local = spec.startsWith('.') ? resolveLocal(file, spec) : null
      if (local) prelude.push(flatten(local, seen))
      return ''
    },
  )
  return [...prelude, body]
    .join('\n')
    .replace(/^\s*export\s+(?=(?:async\s+)?(?:function|const|let|type)\b)/gm, '')
}

type Handler = (req: Request) => Promise<Response>

/** Loads the function and returns its request handler, wired to `client`. */
const loadHandler = (client: unknown): Handler => {
  const js = transformSync(flatten(EDGE_FN), { loader: 'ts', format: 'esm' }).code
  let handler: Handler | null = null
  const denoStub = {
    env: { get: () => 'stub-not-a-real-key' },
    serve: (fn: Handler) => {
      handler = fn
    },
  }
  new Function('Deno', 'createClient', js)(denoStub, () => client)
  if (!handler) throw new Error('admin-create-user did not register a request handler')
  return handler
}

// ---------------------------------------------------------------------------
// Fake Supabase admin client
// ---------------------------------------------------------------------------

const ADMIN_UID = '00000000-0000-4000-8000-00000000ad11'
const NEW_UID = '99999999-9999-4999-8999-999999999999'

type Written = { table: string; op: 'insert' | 'upsert'; row: Record<string, unknown> }

type FakeState = {
  written: Written[]
  deletedUsers: string[]
  createdAuthUsers: Array<Record<string, unknown>>
  callerIsActiveAdmin: boolean
  tokenValid: boolean
  createUserError: string | null
  insertError: Record<string, { message: string }>
  passwordRecordFails: boolean
}

let state: FakeState

const freshState = (): FakeState => ({
  written: [],
  deletedUsers: [],
  createdAuthUsers: [],
  callerIsActiveAdmin: true,
  tokenValid: true,
  createUserError: null,
  insertError: {},
  passwordRecordFails: false,
})

const makeClient = () => ({
  auth: {
    getUser: async () =>
      state.tokenValid
        ? { data: { user: { id: ADMIN_UID } }, error: null }
        : { data: { user: null }, error: { message: 'bad jwt' } },
    admin: {
      createUser: async (args: Record<string, unknown>) => {
        if (state.createUserError) {
          return { data: null, error: { message: state.createUserError } }
        }
        state.createdAuthUsers = [...state.createdAuthUsers, args]
        return { data: { user: { id: NEW_UID, email: args.email } }, error: null }
      },
      deleteUser: async (id: string) => {
        state.deletedUsers = [...state.deletedUsers, id]
        return { data: null, error: null }
      },
    },
  },
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () =>
          table === 'admins' && state.callerIsActiveAdmin
            ? { data: { id: ADMIN_UID, is_active: true }, error: null }
            : { data: null, error: null },
      }),
    }),
    insert: async (row: Record<string, unknown>) => {
      state.written = [...state.written, { table, op: 'insert', row }]
      return { error: state.insertError[table] ?? null }
    },
    upsert: async (row: Record<string, unknown>) => {
      state.written = [...state.written, { table, op: 'upsert', row }]
      return { error: state.passwordRecordFails ? { message: 'no such table' } : null }
    },
  }),
})

const post = (body: unknown, token = 'a-real-admin-jwt') =>
  new Request('https://stub.functions.supabase.co/admin-create-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

const call = async (body: unknown, token?: string) => {
  const handler = loadHandler(makeClient())
  const res = await handler(post(body, token))
  return { status: res.status, body: await res.json() }
}

const rowFor = (table: string) => state.written.find((w) => w.table === table)?.row

const validCleaner = {
  adminId: ADMIN_UID,
  role: 'cleaner',
  firstName: 'Ana',
  lastName: 'Silva',
  phone: '07700 900321',
}

beforeEach(() => {
  state = freshState()
})

describe('admin-create-user: the account it creates is the account login looks for', () => {
  it.each([
    '07700 900321',
    '07700900321',
    '+44 7700 900321',
    '+447700900321',
    '7700900321',
    '0044 7700 900321',
    '044 7700 900321',
    '+44 (0)7700 900321',
  ])('a cleaner created from "%s" gets the auth email the login page derives', async (phone) => {
    const { status } = await call({ ...validCleaner, phone })

    expect(status).toBe(200)
    expect(state.createdAuthUsers[0]?.email).toBe(deriveSyntheticEmail('cleaner', phone))
  })

  it('confirms the email so the new user is not stuck awaiting a mailbox that does not exist', async () => {
    await call(validCleaner)

    expect(state.createdAuthUsers[0]?.email_confirm).toBe(true)
  })

  it('stamps app_role on the auth user, which login checks before letting them in', async () => {
    await call(validCleaner)

    const meta = state.createdAuthUsers[0]?.user_metadata as Record<string, unknown>
    expect(meta.app_role).toBe('cleaner')
  })
})

describe('admin-create-user: the role-table row', () => {
  it('stores the phone in E.164, the format every existing row uses', async () => {
    // Live check on 2026-08-27: cleaners.mobile_number for the seeded test
    // cleaner is '+447700900123'. Migration 20260824160347 backfilled every
    // row to '+' || digits and did NOT add a trigger to normalise inserts, so
    // a row written without the '+' stays inconsistent forever.
    await call(validCleaner)

    expect(rowFor('cleaners')?.mobile_number).toBe('+447700900321')
  })

  it('marks the new cleaner active so they are not created pre-deactivated', async () => {
    await call(validCleaner)

    expect(rowFor('cleaners')?.is_active).toBe(true)
  })

  it('uses the same id as the auth user, which is what ties the two together', async () => {
    await call(validCleaner)

    expect(rowFor('cleaners')?.id).toBe(NEW_UID)
  })

  it('records the sentinel password hash the rest of the app expects', async () => {
    await call(validCleaner)

    expect(rowFor('cleaners')?.password_hash).toBe('managed_by_supabase_auth')
  })

  it('gives a manager a NULL phone rather than an empty string when none is usable', async () => {
    await call({ ...validCleaner, role: 'ops_manager', username: 'ops.lead', phone: undefined })

    expect(rowFor('managers')?.mobile_number).toBeNull()
  })
})

describe('admin-create-user: a failed create must not leave a half-made account', () => {
  it('deletes the auth user when the role-table insert fails', async () => {
    state.insertError = { cleaners: { message: 'null value in column "first_name"' } }

    await call(validCleaner)

    expect(state.deletedUsers).toEqual([NEW_UID])
  })

  it('reports a failed role-table insert as an error rather than a success', async () => {
    state.insertError = { cleaners: { message: 'null value in column "first_name"' } }

    const { status } = await call(validCleaner)

    expect(status).toBeGreaterThanOrEqual(400)
  })

  it('tells the admin what actually went wrong, not a generic failure', async () => {
    state.insertError = { cleaners: { message: 'null value in column "first_name"' } }

    const { body } = await call(validCleaner)

    expect(body.error).toContain('first_name')
  })

  it('deletes the auth user when an admin is created without the email it requires', async () => {
    const { status } = await call({
      adminId: ADMIN_UID,
      role: 'admin',
      firstName: 'Mig',
      lastName: 'Martins',
      username: 'mig',
    })

    expect(status).toBe(400)
    expect(state.deletedUsers).toEqual([NEW_UID])
  })

  it('surfaces the reason when Supabase Auth refuses to create the user', async () => {
    // A non-duplicate Auth failure: the admin can only act on it if they are
    // told what it was. (Duplicates are a separate, friendlier 409 — below.)
    state.createUserError = 'Password should be at least 6 characters'

    const { status, body } = await call(validCleaner)

    expect(status).toBeGreaterThanOrEqual(400)
    expect(body.error).toContain('at least 6 characters')
  })

  it('refuses a phone with no digits instead of creating an account', async () => {
    // Asserts the outcome, not the mechanism: rejecting it up front and
    // failing at Supabase Auth are both acceptable, creating it is not.
    const { status } = await call({ ...validCleaner, phone: 'not a phone' })

    expect(status).toBe(400)
    expect(state.written).toEqual([])
  })

  it('tells the admin something when it refuses a phone with no digits', async () => {
    const { body } = await call({ ...validCleaner, phone: 'not a phone' })

    expect(String(body.error ?? '')).not.toBe('')
  })
})

describe('admin-create-user: authorization', () => {
  it('refuses a caller whose token is not valid', async () => {
    state.tokenValid = false

    const { status, body } = await call(validCleaner)

    expect(status).toBe(401)
    expect(body.error).toBe('Not authenticated')
  })

  it('refuses a valid caller who is not an admin', async () => {
    state.callerIsActiveAdmin = false

    const { status, body } = await call(validCleaner)

    expect(status).toBe(403)
    expect(body.error).toBe('Not authorized')
  })

  it('creates nothing at all when the caller is not an admin', async () => {
    state.callerIsActiveAdmin = false

    await call(validCleaner)

    expect(state.createdAuthUsers).toEqual([])
    expect(state.written).toEqual([])
  })

  it('ignores a body-supplied adminId and authorizes off the caller token', async () => {
    state.callerIsActiveAdmin = false

    const { status } = await call({ ...validCleaner, adminId: ADMIN_UID })

    expect(status).toBe(403)
  })
})

describe('admin-create-user: the response the admin is shown', () => {
  it('returns the password that was actually set on the account', async () => {
    const { body } = await call(validCleaner)

    expect(typeof body.password).toBe('string')
    expect(body.password.length).toBeGreaterThan(0)
  })

  it('reports recorded=false when the password could not be stored for later', async () => {
    state.passwordRecordFails = true

    const { body } = await call(validCleaner)

    expect(body.recorded).toBe(false)
  })

  it('still returns a usable account when the password record fails', async () => {
    state.passwordRecordFails = true

    const { status, body } = await call(validCleaner)

    expect(status).toBe(200)
    expect(body.userId).toBe(NEW_UID)
  })

  it('shows the admin the identifier the account can actually be logged in with', async () => {
    const { body } = await call({ ...validCleaner, phone: '7700900321' })

    // The admin reads this off the screen and gives it to the new starter.
    // If it is the raw string rather than the stored identity, they are told
    // to log in with something that is not their account.
    expect(deriveSyntheticEmail('cleaner', body.identifier)).toBe(
      state.createdAuthUsers[0]?.email,
    )
  })
})

describe('admin-create-user: input the form actually permits', () => {
  it('rejects a cleaner with no phone', async () => {
    const { status, body } = await call({ ...validCleaner, phone: undefined })

    expect(status).toBe(400)
    expect(body.error).toBe('Phone required')
  })

  it('rejects a cleaner whose phone is only whitespace', async () => {
    const { status } = await call({ ...validCleaner, phone: '   ' })

    expect(status).toBe(400)
  })

  it('rejects an unknown role rather than creating something unroutable', async () => {
    const { status, body } = await call({ ...validCleaner, role: 'superuser' })

    expect(status).toBe(400)
    expect(body.error).toBe('Invalid role')
  })

  it('keeps accented Portuguese names intact on the row it writes', async () => {
    await call({ ...validCleaner, firstName: 'João', lastName: 'Gonçalves' })

    expect(rowFor('cleaners')?.first_name).toBe('João')
    expect(rowFor('cleaners')?.last_name).toBe('Gonçalves')
  })

  it('does not create an account whose identity is empty', async () => {
    // 'abc' has no digits, so the local part is '' and the address is
    // '@cleaner.suburbanservices.local' — an account nobody can ever log into.
    await call({ ...validCleaner, phone: 'abc' })

    const email = String(state.createdAuthUsers[0]?.email ?? 'none@none')
    expect(email.split('@')[0]).not.toBe('')
  })
})

describe('admin-create-user: an identity that is already taken', () => {
  // Two different layers can catch a duplicate and they must look identical to
  // the admin. Supabase Auth rejects the synthetic email; the trigger from
  // migration 20260824160347 rejects the phone with a unique_violation. Either
  // way the admin typed a number, not an email address, so that is what the
  // message has to talk about — and nothing may be left behind.
  const DUP_PHONE_MESSAGE = 'That number already has an account.'
  const DUP_USERNAME_MESSAGE = 'That username is already taken.'

  describe('caught by Supabase Auth on the synthetic email', () => {
    beforeEach(() => {
      state.createUserError = 'A user with this email address has already been registered'
    })

    it('answers 409 rather than 400', async () => {
      const { status } = await call(validCleaner)

      expect(status).toBe(409)
    })

    it('talks about the number the admin typed, not an email they never saw', async () => {
      const { body } = await call(validCleaner)

      expect(body.error).toBe(DUP_PHONE_MESSAGE)
    })

    it('writes no role-table row', async () => {
      await call(validCleaner)

      expect(state.written).toEqual([])
    })
  })

  describe('caught by the duplicate-phone trigger on insert', () => {
    beforeEach(() => {
      // Verbatim shape of the exception raised by
      // public.prevent_duplicate_phone_account (errcode unique_violation).
      state.insertError = {
        cleaners: {
          message: 'An account already exists for phone +447700900321 (cleaners.id = 11111111-1111-4111-8111-111111111111)',
        },
      }
    })

    it('answers 409, the same as the Auth-level duplicate', async () => {
      const { status } = await call(validCleaner)

      expect(status).toBe(409)
    })

    it('gives the same message as the Auth-level duplicate', async () => {
      const { body } = await call(validCleaner)

      expect(body.error).toBe(DUP_PHONE_MESSAGE)
    })

    it('does not leak the clashing employee id to the admin', async () => {
      // The raw exception names another person's UUID. Any UUID in this body
      // is a leak of one employee's identity to whoever is adding another.
      const { body } = await call(validCleaner)

      expect(String(body.error)).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      )
    })

    it('deletes the orphaned auth user it had already created', async () => {
      await call(validCleaner)

      expect(state.deletedUsers).toEqual([NEW_UID])
    })
  })

  describe('a username that is already taken', () => {
    it.each(['ops_manager', 'admin'] as const)('answers 409 for %s', async (role) => {
      state.createUserError = 'A user with this email address has already been registered'

      const { status } = await call({
        adminId: ADMIN_UID,
        role,
        firstName: 'Mig',
        lastName: 'Martins',
        username: 'mig',
        email: 'mig@example.com',
      })

      expect(status).toBe(409)
    })

    it.each(['ops_manager', 'admin'] as const)('says the username is taken for %s', async (role) => {
      state.createUserError = 'A user with this email address has already been registered'

      const { body } = await call({
        adminId: ADMIN_UID,
        role,
        firstName: 'Mig',
        lastName: 'Martins',
        username: 'mig',
        email: 'mig@example.com',
      })

      expect(body.error).toBe(DUP_USERNAME_MESSAGE)
    })
  })
})


describe('admin-create-user: a phone that is not a phone', () => {
  // "abc" normalises to '', which used to mint an account addressed
  // '@cleaner.suburbanservices.local' — creatable, and unreachable forever.
  it.each(['abc', 'n/a', '---', ' '])('refuses "%s" with a message about the number', async (phone) => {
    const { status, body } = await call({ ...validCleaner, phone })

    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/mobile number|phone/i)
  })

  it('creates no auth user for a phone with no digits', async () => {
    await call({ ...validCleaner, phone: 'abc' })

    expect(state.createdAuthUsers).toEqual([])
  })

  it('creates no role-table row for a phone with no digits', async () => {
    await call({ ...validCleaner, phone: 'abc' })

    expect(state.written).toEqual([])
  })
})

describe('admin-create-user: the password is recoverable afterwards', () => {
  // Managers created through the new-client wizard used to go through
  // admin-create-manager, which recorded nothing, so their password was shown
  // once and then lost. Going through this function, it is recorded.
  it.each(['cleaner', 'manager'] as const)('records the %s password for the profile panel', async (role) => {
    await call({ ...validCleaner, role })

    const record = state.written.find((w) => w.table === 'user_passwords')
    expect(record?.op).toBe('upsert')
  })

  it('records it against the new user, not the admin who created them', async () => {
    await call(validCleaner)

    const record = state.written.find((w) => w.table === 'user_passwords')
    expect(record?.row.user_id).toBe(NEW_UID)
  })

  it('records the same password it hands back to the admin', async () => {
    const { body } = await call(validCleaner)

    const record = state.written.find((w) => w.table === 'user_passwords')
    expect(record?.row.password).toBe(body.password)
  })
})

describe('admin-create-user: the two phone representations are deliberate', () => {
  /**
   * These two disagree ON PURPOSE and the difference is load-bearing:
   *   auth user_metadata.mobile_number -> BARE DIGITS  (447700900321)
   *   cleaners/managers.mobile_number  -> E.164        (+447700900321)
   *
   * Documented in supabase/functions/_shared/phone.ts. Rewriting the metadata
   * to E.164 would desynchronise in-progress shifts against attendance rows
   * written under the old shape, so it is knowingly left alone. Pinning both
   * here so that a later "let's unify these" tidy-up has to argue with a test
   * instead of quietly breaking attendance.
   */
  it('keeps the auth metadata phone as bare digits', async () => {
    await call(validCleaner)

    const meta = state.createdAuthUsers[0]?.user_metadata as Record<string, unknown>
    expect(meta.mobile_number).toBe('447700900321')
  })

  it('keeps the role-table phone in E.164', async () => {
    await call(validCleaner)

    expect(rowFor('cleaners')?.mobile_number).toBe('+447700900321')
  })

  it('normalises both from the same spelling, however it was typed', async () => {
    await call({ ...validCleaner, phone: '0044 7700 900321' })

    const meta = state.createdAuthUsers[0]?.user_metadata as Record<string, unknown>
    expect(meta.mobile_number).toBe('447700900321')
    expect(rowFor('cleaners')?.mobile_number).toBe('+447700900321')
  })

  it('leaves the metadata phone null for a username-identified role', async () => {
    await call({ ...validCleaner, role: 'ops_manager', username: 'ops.lead', phone: undefined })

    const meta = state.createdAuthUsers[0]?.user_metadata as Record<string, unknown>
    expect(meta.mobile_number).toBeNull()
  })
})
