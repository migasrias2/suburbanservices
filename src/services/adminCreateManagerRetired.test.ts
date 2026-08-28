/**
 * @vitest-environment node
 *
 * Node, not jsdom: this file transpiles Deno Edge Function source with
 * esbuild, and esbuild refuses to run against jsdom's TextEncoder.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

/**
 * admin-create-manager authorised off a UUID supplied in the request BODY and
 * never authenticated the caller, so the anon key that ships in the browser
 * bundle was enough to mint an ops_manager and receive its plaintext password.
 *
 * The first version of this file asserted the source directory was GONE. That
 * was the wrong property, and it gave false assurance: on 2026-08-26, with the
 * directory already deleted, a live probe still reached the old bundle's own
 * `admins` lookup (403, from the anon key alone). Deleting source does not
 * undeploy a function. A test that goes green on a deletion which changes
 * nothing in production is worse than no test.
 *
 * So these assert CAPABILITY — that whatever is deployed under this name
 * cannot create anything, whether or not anyone remembers to run
 * `supabase functions delete`. The live 404/410 probe stays manual, because a
 * network assertion has no business in a unit suite.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const TOMBSTONE = path.join(ROOT, 'supabase/functions/admin-create-manager/index.ts')

const source = () => readFileSync(TOMBSTONE, 'utf8')

// --- executing the tombstone ------------------------------------------------

type Handler = (req: Request) => Promise<Response> | Response

const loadHandler = (): Handler => {
  const stripped = source().replace(
    /^\s*import\s+(?:[^'"]*?from\s+)?['"][^'"]+['"];?\s*$/gm,
    '',
  )
  const js = transformSync(stripped, { loader: 'ts', format: 'esm' }).code
  let handler: Handler | null = null
  const denoStub = {
    env: {
      get: () => {
        throw new Error('the retired endpoint must not read any secret from the environment')
      },
    },
    serve: (fn: Handler) => {
      handler = fn
    },
  }
  new Function('Deno', js)(denoStub)
  if (!handler) throw new Error('admin-create-manager registered no request handler')
  return handler
}

const request = (method: string) =>
  new Request('https://stub.functions.supabase.co/admin-create-manager', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(method === 'POST' || method === 'PUT'
      ? {
          body: JSON.stringify({
            adminId: '00000000-0000-4000-8000-00000000ad11',
            role: 'ops_manager',
            firstName: 'Probe',
            lastName: 'Probe',
            username: 'probe',
          }),
        }
      : {}),
  })

describe('the retired admin-create-manager endpoint cannot mint an account', () => {
  it('refuses the exact request that used to create an ops_manager', async () => {
    const res = await loadHandler()(request('POST'))

    expect(res.status).toBe(410)
  })

  it.each(['POST', 'GET', 'PUT', 'DELETE', 'PATCH'])(
    'never answers %s with success',
    async (method) => {
      const res = await loadHandler()(request(method))

      expect(res.ok).toBe(false)
    },
  )

  it('hands back no credential of any kind', async () => {
    const res = await loadHandler()(request('POST'))
    const body = await res.json()

    expect(body.password).toBeUndefined()
    expect(body.managerId).toBeUndefined()
    expect(body.userId).toBeUndefined()
  })

  it('points the caller at the endpoint that does authenticate', async () => {
    const res = await loadHandler()(request('POST'))
    const body = await res.json()

    expect(String(body.error)).toContain('admin-create-user')
  })

  it('still answers the CORS preflight, so it fails visibly rather than opaquely', async () => {
    const res = await loadHandler()(request('OPTIONS'))

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

describe('the retired endpoint holds no capability to create with', () => {
  it('constructs no Supabase client', () => {
    expect(source()).not.toContain('createClient')
  })

  it('names no service-role key', () => {
    expect(source()).not.toContain('SERVICE_ROLE')
  })

  it('reaches for no admin auth API', () => {
    expect(source()).not.toContain('auth.admin')
  })

  it('reads no environment secret at all', () => {
    // loadHandler throws from the Deno.env stub if this is ever violated.
    expect(() => loadHandler()).not.toThrow()
  })

  it('records why it still exists, so nobody deletes the fail-safe by tidying', () => {
    expect(source()).toContain('supabase functions delete admin-create-manager')
  })
})

// --- nothing may call it again ---------------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])

const sourceFiles = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP_DIRS.has(entry)) return []
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    if (!/\.(ts|tsx|js|jsx|sql)$/.test(full)) return []
    // Test files legitimately name the thing they are asserting is dead.
    if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(full)) return []
    return [full]
  })
}

const appFilesContaining = (needle: string): string[] =>
  sourceFiles(path.join(ROOT, 'src'))
    .filter((file) => readFileSync(file, 'utf8').includes(needle))
    .map((file) => path.relative(ROOT, file))

describe('nothing in the app can reach the retired endpoint', () => {
  it('is invoked from nowhere', () => {
    expect(appFilesContaining('admin-create-manager')).toEqual([])
  })

  it('has no client wrapper left to call it', () => {
    expect(appFilesContaining('createManagerAccount')).toEqual([])
  })

  it('leaves no CreatedManager type for the wizard to depend on', () => {
    expect(appFilesContaining('CreatedManager')).toEqual([])
  })
})

describe('admin-create-user is the one way an account is made', () => {
  const createUser = () =>
    readFileSync(path.join(ROOT, 'supabase/functions/admin-create-user/index.ts'), 'utf8')

  it('still exists', () => {
    expect(existsSync(path.join(ROOT, 'supabase/functions/admin-create-user/index.ts'))).toBe(true)
  })

  it('identifies the caller from their token', () => {
    expect(createUser()).toContain('auth.getUser(token)')
  })

  it('never authorises off a body-supplied id', () => {
    expect(createUser()).not.toMatch(/\.eq\(\s*'id'\s*,\s*adminId\s*\)/)
  })
})
