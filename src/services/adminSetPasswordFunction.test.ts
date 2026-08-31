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

/**
 * admin-set-password shipped in b60628d with NO test file of any kind. It can
 * rewrite any staff credential, so "untested" is the wrong state for it.
 *
 * Two of its gates conflate a database fault with a negative answer, which is
 * the same defect adminCreateUserCollisionLookup.test.ts pins in
 * admin-create-user:
 *
 *   index.ts:79   if (adminErr || !adminRow || ...) -> 403 'Not authorized'
 *   index.ts:113  if (targetErr || !targetRow)      -> 404 'User not found'
 *
 * Maria is fixing the admin-create-user copy. This file exists so the fix
 * cannot land half-applied, leaving the identical six lines here.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EDGE_FN = path.resolve(HERE, '../../supabase/functions/admin-set-password/index.ts')

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
  if (!handler) throw new Error('admin-set-password did not register a request handler')
  return handler
}

// ---------------------------------------------------------------------------

const ADMIN_UID = '00000000-0000-4000-8000-00000000ad11'
const TARGET_UID = '22222222-2222-4222-8222-222222222222'

type Lookup = { data: Record<string, unknown> | null; error: { code: string; message: string } | null }

type State = {
  tokenValid: boolean
  getUserError: unknown | null
  adminsLookup: Lookup
  targetLookup: Lookup
  updateError: string | null
  passwordsSet: Array<{ userId: string; password: string }>
  recorded: Array<Record<string, unknown>>
}

let state: State

const freshState = (): State => ({
  tokenValid: true,
  getUserError: null,
  adminsLookup: { data: { id: ADMIN_UID, is_active: true }, error: null },
  targetLookup: { data: { id: TARGET_UID }, error: null },
  updateError: null,
  passwordsSet: [],
  recorded: [],
})

const makeClient = () => ({
  auth: {
    getUser: async () => {
      if (state.getUserError) return { data: { user: null }, error: state.getUserError }
      return state.tokenValid
        ? { data: { user: { id: ADMIN_UID } }, error: null }
        : { data: { user: null }, error: { message: 'bad jwt' } }
    },
    admin: {
      updateUserById: async (userId: string, attrs: { password: string }) => {
        if (state.updateError) return { data: null, error: { message: state.updateError } }
        state.passwordsSet = [...state.passwordsSet, { userId, password: attrs.password }]
        return { data: { user: { id: userId } }, error: null }
      },
    },
  },
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => (table === 'admins' ? state.adminsLookup : state.targetLookup),
      }),
    }),
    upsert: async (row: Record<string, unknown>) => {
      state.recorded = [...state.recorded, row]
      return { error: null }
    },
  }),
})

const call = async (body: unknown, token: string | null = 'a-real-admin-jwt') => {
  const handler = loadHandler(makeClient())
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await handler(
    new Request('https://stub.functions.supabase.co/admin-set-password', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
  return { status: res.status, body: await res.json() }
}

const reset = { userId: TARGET_UID, role: 'cleaner', password: 'correct-horse' }

beforeEach(() => {
  state = freshState()
})

// ---------------------------------------------------------------------------

describe('admin-set-password: it works at all', () => {
  // Confirms the harness reaches the end of the function, so every red below
  // is the function and not my loader.
  it('sets the password the admin chose', async () => {
    const { status } = await call(reset)

    expect(status).toBe(200)
    expect(state.passwordsSet).toEqual([{ userId: TARGET_UID, password: 'correct-horse' }])
  })

  it('uses the admin-chosen password verbatim rather than mangling it', async () => {
    await call({ ...reset, password: '  Sp aces  And  Case  ' })

    // Only an all-whitespace password means "generate"; a password with
    // spaces in it is a password.
    expect(state.passwordsSet[0].password).toBe('  Sp aces  And  Case  ')
  })

  it('generates one when the admin left it empty', async () => {
    const { body } = await call({ ...reset, password: '' })

    expect(String(body.password)).toMatch(/^[a-z]+-[a-z]+-\d{2}$/)
  })

  it('records the password it actually set, not the one it was asked for', async () => {
    const { body } = await call({ ...reset, password: '' })

    expect(state.recorded[0].password).toBe(body.password)
    expect(state.passwordsSet[0].password).toBe(body.password)
  })
})

describe('admin-set-password: a database fault is not an answer about the caller', () => {
  it('tells a real admin something different from what it tells a non-admin', async () => {
    state.adminsLookup = { data: null, error: null }
    const notAnAdmin = await call(reset)

    state = freshState()
    state.adminsLookup = { data: null, error: { code: '42703', message: 'column admins.is_active does not exist' } }
    const lookupBroke = await call(reset)

    // Fail closed is right; saying the same words for both is not. No status is
    // pinned, so the fix may choose any.
    expect(lookupBroke.body.error).not.toBe(notAnAdmin.body.error)
  })

  it('does not report a broken staff-table lookup as "User not found"', async () => {
    state.targetLookup = { data: null, error: null }
    const genuinelyMissing = await call(reset)

    state = freshState()
    state.targetLookup = { data: null, error: { code: '42P01', message: 'relation "public.cleaners" does not exist' } }
    const lookupBroke = await call(reset)

    // index.ts:113 -- the same conflation as :79, one line of code apart in
    // spirit. "User not found" sends the admin hunting for a user who is right
    // there.
    expect(lookupBroke.body.error).not.toBe(genuinelyMissing.body.error)
  })
})

describe('admin-set-password: authorization', () => {
  it('refuses a request with no Authorization header', async () => {
    const { status, body } = await call(reset, null)

    expect(status).toBe(401)
    expect(body.error).toBe('Not authenticated')
  })

  it('refuses a caller whose token is not valid', async () => {
    state.tokenValid = false

    const { status } = await call(reset)

    expect(status).toBe(401)
  })

  it('refuses a deactivated admin', async () => {
    state.adminsLookup = { data: { id: ADMIN_UID, is_active: false }, error: null }

    const { status } = await call(reset)

    expect(status).toBe(403)
  })

  it('changes no password when the caller is refused', async () => {
    state.adminsLookup = { data: null, error: null }

    await call(reset)

    expect(state.passwordsSet).toEqual([])
  })

  it('ignores a body-supplied adminId', async () => {
    state.adminsLookup = { data: null, error: null }

    const { status } = await call({ ...reset, adminId: ADMIN_UID })

    expect(status).toBe(403)
  })
})

describe('admin-set-password: the length limits are about bytes, not characters', () => {
  it('refuses a password below the 8-character minimum', async () => {
    const { status, body } = await call({ ...reset, password: 'short7c' })

    expect(status).toBe(400)
    expect(String(body.error)).toMatch(/at least 8/)
  })

  it('accepts exactly 8 characters', async () => {
    const { status } = await call({ ...reset, password: 'eightchr' })

    expect(status).toBe(200)
  })

  it('accepts a password of exactly 72 bytes', async () => {
    const { status } = await call({ ...reset, password: 'a'.repeat(72) })

    expect(status).toBe(200)
  })

  it('refuses a password of 73 bytes', async () => {
    const { status } = await call({ ...reset, password: 'a'.repeat(73) })

    expect(status).toBe(400)
  })

  it('refuses an accented password that is short in characters but over 72 bytes', async () => {
    // This is Miguel's code: "Ç" is two bytes in UTF-8. 40 of them is 40
    // characters and 80 bytes. bcrypt would silently truncate at 72, so the
    // admin would be shown a password whose tail does nothing -- and the part
    // that survives depends on where the cut lands.
    const { status } = await call({ ...reset, password: 'Ç'.repeat(40) })

    expect(status).toBe(400)
  })

  it('sets no password at all when the length check refuses it', async () => {
    await call({ ...reset, password: 'Ç'.repeat(40) })

    expect(state.passwordsSet).toEqual([])
  })
})

describe('admin-set-password: input the caller controls', () => {
  it('refuses a role that is not one of the four', async () => {
    const { status, body } = await call({ ...reset, role: 'superuser' })

    expect(status).toBe(400)
    expect(body.error).toBe('Invalid role')
  })

  it('refuses a missing userId', async () => {
    const { status } = await call({ role: 'cleaner', password: 'correct-horse' })

    expect(status).toBe(400)
  })

  it('refuses a whitespace-only userId', async () => {
    const { status } = await call({ ...reset, userId: '   ' })

    expect(status).toBe(400)
  })

  it('refuses a non-POST method', async () => {
    const handler = loadHandler(makeClient())
    const res = await handler(
      new Request('https://stub.functions.supabase.co/admin-set-password', { method: 'GET' }),
    )

    expect(res.status).toBe(405)
  })
})

describe('admin-set-password: reporting whether the new password was recorded', () => {
  it('reports recorded=true when the record succeeded', async () => {
    const { body } = await call(reset)

    expect(body.recorded).toBe(true)
  })

  it('records it against the target user, not the admin who reset it', async () => {
    await call(reset)

    expect(state.recorded[0].user_id).toBe(TARGET_UID)
    expect(state.recorded[0].updated_by).toBe(ADMIN_UID)
  })
})

describe('admin-set-password: could not reach the auth service is not a bad token', () => {
  /**
   * Gaby's B1, on the second endpoint. Both functions share
   * _shared/adminGate.ts, so this is the test that proves the shared gate really
   * is shared rather than merely imported -- if admin-set-password ever grows
   * its own copy again, these go red.
   *
   * Stakes are the same and slightly worse here: this endpoint is reached from a
   * profile panel, so an admin resetting a cleaner's password during a GoTrue
   * blip would be told their session expired, sign out, fail to fix it, and
   * reasonably conclude their own admin account is broken.
   */
  const RETRYABLE = { name: 'AuthRetryableFetchError', message: 'fetch failed' }
  const GOTRUE_5XX = { name: 'AuthApiError', status: 502, message: 'bad gateway' }
  const BAD_TOKEN = { name: 'AuthApiError', status: 401, message: 'invalid claim' }

  it('answers 503, not 401, when the auth service cannot be reached', async () => {
    state.getUserError = RETRYABLE

    const { status } = await call(reset)

    expect(status).toBe(503)
  })

  it('answers 503 when GoTrue itself returns a 5xx', async () => {
    state.getUserError = GOTRUE_5XX

    const { status } = await call(reset)

    expect(status).toBe(503)
  })

  it('tells the admin to retry rather than to sign in again', async () => {
    state.getUserError = RETRYABLE

    const { body } = await call(reset)

    expect(String(body.error)).toMatch(/try again/i)
    expect(String(body.error)).not.toMatch(/sign in/i)
  })

  it('still answers 401 when the token is genuinely rejected', async () => {
    state.getUserError = BAD_TOKEN

    const { status, body } = await call(reset)

    expect(status).toBe(401)
    expect(body.error).toBe('Not authenticated')
  })

  it('changes nobody\'s password when the auth service is unreachable', async () => {
    state.getUserError = RETRYABLE

    await call(reset)

    expect(state.passwordsSet).toEqual([])
  })

  it('changes nobody\'s password when the token is rejected', async () => {
    state.getUserError = BAD_TOKEN

    await call(reset)

    expect(state.passwordsSet).toEqual([])
  })

  it('records nothing to user_passwords on either branch', async () => {
    state.getUserError = RETRYABLE
    await call(reset)
    state.getUserError = BAD_TOKEN
    await call(reset)

    expect(state.recorded).toEqual([])
  })
})
