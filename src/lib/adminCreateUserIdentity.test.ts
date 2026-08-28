/**
 * @vitest-environment node
 *
 * Node, not jsdom: this file transpiles the Deno Edge Function source with
 * esbuild, and esbuild refuses to run against jsdom's TextEncoder.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import { deriveSyntheticEmail } from './authHelpers'

/**
 * An account's synthetic email IS its identity. It is written once, by the
 * admin-create-user Edge Function, and re-derived on every login by
 * deriveSyntheticEmail in src/lib/authHelpers.ts. Those two derivations live in
 * different runtimes (Deno vs the browser) and cannot share a module, so
 * nothing but a test can hold them to the same answer.
 *
 * If they disagree by one character the account is created, the password is
 * shown to the admin, and the person can never log in — the worst shape of
 * failure this app has, because it looks like success.
 *
 * These tests load the real Edge Function source, transpile it, and run its
 * identity derivation against the client's for every phone spelling an admin
 * can actually type into the Add user form (which is a free-text input, not a
 * constrained PhoneInput, so all of these are reachable).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EDGE_FN = path.resolve(HERE, '../../supabase/functions/admin-create-user/index.ts')

/** Resolves a relative import specifier to a file on disk, or null. */
const resolveLocal = (fromFile: string, spec: string): string | null => {
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) return candidate
  }
  return null
}

/**
 * Inlines relative imports and drops remote ones (jsr:/npm:/https:), so the
 * function's own logic can be executed here whether it keeps the derivation
 * inline or moves it to a shared file under supabase/functions/.
 */
const flatten = (file: string, seen = new Set<string>()): string => {
  if (seen.has(file)) return ''
  seen.add(file)

  const source = readFileSync(file, 'utf8')
  const prelude: string[] = []

  const body = source.replace(
    /^\s*import\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"];?\s*$/gm,
    (_match, spec: string) => {
      const local = spec.startsWith('.') ? resolveLocal(file, spec) : null
      if (local) prelude.push(flatten(local, seen))
      return ''
    },
  )

  // A shared module exports its helpers; inlined, those exports must become
  // plain declarations or the source is not valid inside a function body.
  return [...prelude, body].join('\n').replace(/^\s*export\s+(?=(?:async\s+)?(?:function|const|let|type)\b)/gm, '')
}

/** The identity derivation as the create path actually performs it. */
const loadCreatePathDerivation = (): ((role: string, identifier: string) => string) => {
  const js = transformSync(flatten(EDGE_FN), { loader: 'ts', format: 'esm' }).code

  const capture = `
    return typeof deriveSyntheticEmail === 'function' ? deriveSyntheticEmail : null
  `
  // Deno globals the module touches while loading. The request handler is
  // registered and never invoked, so nothing here talks to a network.
  const denoStub = {
    env: { get: () => 'stub' },
    serve: () => undefined,
  }

  const factory = new Function('Deno', 'createClient', `${js}\n${capture}`)
  const derive = factory(denoStub, () => undefined)

  if (typeof derive !== 'function') {
    throw new Error(
      'admin-create-user no longer exposes deriveSyntheticEmail by that name — ' +
        'this contract test must be pointed at whatever replaced it.',
    )
  }
  return derive as (role: string, identifier: string) => string
}

const createPathEmail = loadCreatePathDerivation()

/**
 * Every spelling of the same UK mobile an admin might plausibly type. The Add
 * user form does no formatting, so the raw string reaches the function as-is.
 * All of these are the Ofcom reserved-for-fiction number 07700 900123.
 */
const PHONE_SPELLINGS = [
  '07700 900123',
  '07700900123',
  '+44 7700 900123',
  '+447700900123',
  '447700900123',
  '7700900123',
  '7700 900123',
  '0044 7700 900123',
  '00447700900123',
  '+44 07700 900123',
  '044 7700 900123',
  '+44 (0)7700 900123',
  '  07700900123  ',
  '07700-900123',
  '(07700) 900123',
]

describe('admin-create-user writes the identity the login page derives', () => {
  describe.each(['cleaner', 'manager'] as const)('%s', (role) => {
    it.each(PHONE_SPELLINGS)(
      'a %s account created from this spelling can be logged into',
      (typed) => {
        expect(createPathEmail(role, typed)).toBe(deriveSyntheticEmail(role, typed))
      },
    )
  })

  it.each([
    ['ops_manager', 'ops.lead'],
    ['ops_manager', 'Ops.Lead'],
    ['ops_manager', '  ops.lead  '],
    ['ops_manager', 'OPS.LEAD'],
    ['admin', 'miguel'],
    ['admin', 'Miguel'],
    ['admin', ' Miguel '],
  ] as const)('%s account created as "%s" can be logged into', (role, username) => {
    expect(createPathEmail(role, username)).toBe(deriveSyntheticEmail(role, username))
  })

  it('uses the same domain per role on both sides', () => {
    for (const role of ['ops_manager', 'admin'] as const) {
      const created = createPathEmail(role, 'someone')
      const login = deriveSyntheticEmail(role, 'someone')
      expect(created.split('@')[1]).toBe(login.split('@')[1])
    }
    for (const role of ['cleaner', 'manager'] as const) {
      const created = createPathEmail(role, '07700900123')
      const login = deriveSyntheticEmail(role, '07700900123')
      expect(created.split('@')[1]).toBe(login.split('@')[1])
    }
  })
})
