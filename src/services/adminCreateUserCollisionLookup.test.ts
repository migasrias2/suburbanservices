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
import { normalizePhoneToDigits } from '../lib/authHelpers'

/**
 * WHY THIS FILE EXISTS, GIVEN adminCreateUserFunction.test.ts ALREADY PASSES.
 *
 * That file drives the same Edge Function through a fake whose entire database
 * is this:
 *
 *     select: () => ({ eq: () => ({ maybeSingle: async () =>
 *       table === 'admins' && state.callerIsActiveAdmin
 *         ? { data: { id: ADMIN_UID, is_active: true }, error: null }
 *         : { data: null, error: null } }) }),
 *     insert: async (row) => { state.written.push(row); return { error: ... } },
 *
 * It ignores which column was filtered on, ignores the value, holds no rows,
 * and accepts every insert. Three consequences, all of which this file exists
 * to close:
 *
 *   1. findCollidingUser() can only ever return null, because every lookup
 *      against cleaners/managers answers {data: null}. The whole "name the
 *      account you collided with" feature -- the headline of commit ab141b2,
 *      "tell admins why user creation failed" -- has NO test that exercises
 *      its success path. 352 green tests say nothing about it.
 *
 *   2. Nothing models public.prevent_duplicate_phone_account, so no test can
 *      tell which inserts the database would actually refuse.
 *
 *   3. insert() accepts any column name, so schema drift is invisible.
 *
 * The fake below holds real rows in real column sets and runs the real trigger
 * rule, so the function is asked the questions production asks it.
 *
 * COLUMN SETS ARE NOT GUESSED. They are the grant lists in migration
 * 20260826042644_restrict_staff_pii_reads.sql (which enumerates every readable
 * column on cleaners and managers), plus password_hash, which that same
 * migration revokes and therefore proves exists.
 *
 * PHONE NORMALISATION IS NOT REIMPLEMENTED. The trigger below calls
 * normalizePhoneToDigits from src/lib/authHelpers.ts, which migration
 * 20260824160347 states public.normalize_phone_digits mirrors rule for rule.
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
// A fake that holds rows, enforces columns, and runs the duplicate-phone rule
// ---------------------------------------------------------------------------

const ADMIN_UID = '00000000-0000-4000-8000-00000000ad11'
const NEW_UID = '99999999-9999-4999-8999-999999999999'
const HOLDER_UID = '11111111-1111-4111-8111-111111111111'

type Row = Record<string, unknown>

/** Straight from the grant lists in migration 20260826042644, plus password_hash. */
const COLUMNS: Record<string, readonly string[]> = {
  cleaners: [
    'id', 'first_name', 'last_name', 'mobile_number', 'email',
    'is_active', 'created_at', 'updated_at', 'password_hash',
  ],
  managers: [
    'id', 'first_name', 'last_name', 'mobile_number', 'email', 'employee_id',
    'is_active', 'created_at', 'updated_at', 'username', 'role', 'password_hash',
  ],
  admins: [
    'id', 'username', 'first_name', 'last_name', 'email',
    'is_active', 'created_at', 'updated_at', 'password_hash',
  ],
  user_passwords: ['user_id', 'role', 'password', 'updated_at', 'updated_by'],
}

type Db = {
  cleaners: Row[]
  managers: Row[]
  admins: Row[]
  user_passwords: Row[]
  authEmails: string[]
  deletedUsers: string[]
  getUserError: unknown | null
  /** Who the bearer token resolves to. Not necessarily an admin. */
  callerId: string
  /**
   * Postgres does NOT guarantee row order without an ORDER BY. scanIdentityTable
   * does `.select(...).limit(2000)` with none, so "whichever row came back first"
   * is not a stable fact. Setting this returns the rows in a different order on
   * each scan, which is a faithful model of that, not an adversarial one.
   */
  unstableScanOrder: boolean
  scanCalls: number
}

let db: Db

const freshDb = (): Db => ({
  cleaners: [],
  managers: [],
  admins: [{ id: ADMIN_UID, is_active: true, username: 'mig' }],
  user_passwords: [],
  authEmails: [],
  deletedUsers: [],
  getUserError: null,
  callerId: ADMIN_UID,
  unstableScanOrder: false,
  scanCalls: 0,
})

/**
 * public.prevent_duplicate_phone_account, migration 20260824160347.
 *
 * Note what it does and does not do, because both matter: it compares
 * normalize_phone_digits(mobile_number), so it catches a number stored in ANY
 * spelling -- and it executes `select id from public.%I` against tg_table_name,
 * so it only ever looks inside the table being inserted into.
 */
const duplicatePhoneTrigger = (table: 'cleaners' | 'managers', row: Row) => {
  const norm = normalizePhoneToDigits(String(row.mobile_number ?? ''))
  if (!norm) return null
  const clash = db[table].find(
    (r) => r.id !== row.id && normalizePhoneToDigits(String(r.mobile_number ?? '')) === norm,
  )
  if (!clash) return null
  return {
    code: '23505',
    message: `An account already exists for phone +${norm} (${table}.id = ${clash.id})`,
  }
}

/**
 * managers_mobile_number_unique_idx, as it stands after migration 20260826034537:
 *
 *   create unique index managers_mobile_number_unique_idx
 *     on public.managers (mobile_number)
 *     where coalesce(mobile_number, '') <> '';
 *
 * PARTIAL. Rows with NULL or '' are outside the index entirely, so any number
 * of username-identified managers can coexist. Modelling the WHERE clause is
 * the whole point -- a full index here would make the ops_manager tests below
 * pass for the wrong reason.
 */
const uniqueManagerPhone = (row: Row) => {
  const phone = row.mobile_number
  if (phone === null || phone === undefined || phone === '') return null
  const clash = db.managers.find((r) => r.mobile_number === phone)
  if (!clash) return null
  return {
    code: '23505',
    message: 'duplicate key value violates unique constraint "managers_mobile_number_unique_idx"',
  }
}

const makeClient = () => ({
  auth: {
    getUser: async () =>
      db.getUserError
        ? { data: { user: null }, error: db.getUserError }
        : { data: { user: { id: db.callerId } }, error: null },
    admin: {
      createUser: async (args: Row) => {
        const email = String(args.email)
        // GoTrue's uniqueness is on the synthetic email, nothing else.
        if (db.authEmails.includes(email)) {
          return {
            data: null,
            error: { code: 'email_exists', message: 'A user with this email address has already been registered' },
          }
        }
        db.authEmails = [...db.authEmails, email]
        // A fresh uuid per account, so a test can create two in a row and the
        // second is a genuinely different person.
        const id = `99999999-9999-4999-8999-${String(db.authEmails.length).padStart(12, '0')}`
        return { data: { user: { id, email } }, error: null }
      },
      deleteUser: async (id: string) => {
        db.deletedUsers = [...db.deletedUsers, id]
        return { data: null, error: null }
      },
    },
  },
  from: (table: string) => {
    const known = COLUMNS[table]
    return {
      select: (cols: string) => {
        const requested = String(cols).split(',').map((c) => c.trim()).filter(Boolean)
        const colError = () => {
          if (!known) return { code: '42P01', message: `relation "public.${table}" does not exist` }
          const unknown = requested.filter((c) => !known.includes(c))
          if (unknown.length > 0) return { code: '42703', message: `column ${table}.${unknown[0]} does not exist` }
          return null
        }
        const rows = () => db[table as keyof Db] as Row[]
        // PostgREST returns ONLY the selected columns. Projecting proves the
        // function never reads a column it forgot to ask for.
        const project = (r: Row): Row => Object.fromEntries(requested.map((c) => [c, r[c]]))
        return {
          eq: (column: string, value: unknown) => ({
            maybeSingle: async () => {
              const e = colError()
              if (e) return { data: null, error: e }
              if (!known!.includes(column)) {
                return { data: null, error: { code: '42703', message: `column ${table}.${column} does not exist` } }
              }
              const hits = rows().filter((r) => r[column] === value)
              // maybeSingle also errors when more than one row matches.
              if (hits.length > 1) {
                return { data: null, error: { code: 'PGRST116', message: 'multiple rows returned' } }
              }
              return { data: hits[0] ? project(hits[0]) : null, error: null }
            },
          }),
          /** The capped scan added by Maria's fix: .select(cols).limit(n). */
          limit: async (n: number) => {
            const e = colError()
            if (e) return { data: null, error: e }
            db.scanCalls += 1
            const page = rows().slice(0, n)
            const ordered = db.unstableScanOrder && db.scanCalls % 2 === 0
              ? [...page].reverse()
              : page
            return { data: ordered.map(project), error: null }
          },
        }
      },
      insert: async (row: Row) => {
        if (!known) {
          return { error: { code: '42P01', message: `relation "public.${table}" does not exist` } }
        }
        const bad = Object.keys(row).find((c) => !known.includes(c))
        if (bad) {
          return {
            error: {
              code: 'PGRST204',
              message: `Could not find the '${bad}' column of '${table}' in the schema cache`,
            },
          }
        }
        if (table === 'cleaners' || table === 'managers') {
          const trigger = duplicatePhoneTrigger(table, row)
          if (trigger) return { error: trigger }
        }
        if (table === 'managers') {
          const indexed = uniqueManagerPhone(row)
          if (indexed) return { error: indexed }
        }
        db[table as keyof Db] = [...(db[table as keyof Db] as Row[]), row] as never
        return { error: null }
      },
      upsert: async (row: Row) => {
        if (!known) {
          return { error: { code: '42P01', message: `relation "public.${table}" does not exist` } }
        }
        db[table as keyof Db] = [...(db[table as keyof Db] as Row[]), row] as never
        return { error: null }
      },
    }
  },
})

const call = async (body: unknown) => {
  const handler = loadHandler(makeClient())
  const res = await handler(
    new Request('https://stub.functions.supabase.co/admin-create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer a-real-admin-jwt' },
      body: JSON.stringify(body),
    }),
  )
  return { status: res.status, body: await res.json() }
}

const newCleaner = {
  adminId: ADMIN_UID,
  role: 'cleaner',
  firstName: 'Ana',
  lastName: 'Silva',
  phone: '07700 900321',
}

beforeEach(() => {
  db = freshDb()
})

// ---------------------------------------------------------------------------

describe('the fake is faithful before anything is asserted with it', () => {
  // If these do not hold, every failure below is my harness, not the function.
  it('creates a cleaner into an empty database', async () => {
    const { status } = await call(newCleaner)

    expect(status).toBe(200)
  })

  it('rejects a column that is not in the real table', async () => {
    const client = makeClient()
    const { error } = await client.from('cleaners').insert({ id: NEW_UID, nickname: 'Ana' })

    expect(error?.code).toBe('PGRST204')
  })

  it('accepts every column admin-create-user actually writes to cleaners', async () => {
    await call(newCleaner)

    expect(db.cleaners).toHaveLength(1)
  })

  it('accepts every column admin-create-user actually writes to managers', async () => {
    await call({ ...newCleaner, role: 'manager' })

    expect(db.managers).toHaveLength(1)
  })
})

describe('naming the account a refused creation collided with', () => {
  /**
   * The point of the feature, in Miguel's words in UsersPage.tsx: "A taken
   * identity is not a failure the admin can retry their way out of... When the
   * function names the holder, keep it in the dialog with a way to reach them."
   *
   * The existing suite asserts the 409 and the message. It never once asserts
   * that a holder came back, because its fake cannot hold one.
   */
  it('names the holder when the stored number is in E.164, the shape the migration wrote', async () => {
    db.cleaners = [{
      id: HOLDER_UID,
      first_name: 'Ana',
      last_name: 'Costa',
      mobile_number: '+447700900321',
      is_active: false,
    }]

    const { status, body } = await call(newCleaner)

    expect(status).toBe(409)
    expect(body.existingUserId).toBe(HOLDER_UID)
  })

  it('names the holder even when they are deactivated, which is the whole reason the admin could not find them', async () => {
    db.cleaners = [{
      id: HOLDER_UID,
      first_name: 'Ana',
      last_name: 'Costa',
      mobile_number: '+447700900321',
      is_active: false,
    }]

    const { body } = await call(newCleaner)

    expect(body.existingIsActive).toBe(false)
  })

  it('names the holder when the stored number is a bare-digit row', async () => {
    db.cleaners = [{
      id: HOLDER_UID,
      first_name: 'Ana',
      last_name: 'Costa',
      mobile_number: '447700900321',
      is_active: true,
    }]

    const { body } = await call(newCleaner)

    expect(body.existingUserId).toBe(HOLDER_UID)
  })

  it('names the holder when the stored number was left un-normalised by migration 20260824160347', async () => {
    /**
     * THIS IS THE CASE THE FEATURE WAS BUILT FOR AND THE ONE IT MISSES.
     *
     * Migration 20260824160347 normalised rows to '+' || digits but explicitly
     * SKIPPED any row in a pre-existing duplicate group -- see the
     * `having count(*) = 1` guard on both UPDATEs, and the
     * public.phone_account_duplicates view it created to report the leftovers.
     * So the database is DOCUMENTED to still contain numbers stored as
     * '07700900321' and '+4407700900321'.
     *
     * prevent_duplicate_phone_account catches those, because it compares
     * normalize_phone_digits(). findCollidingUser does NOT, because it compares
     * the raw string against exactly two spellings. The rows most likely to
     * collide are precisely the rows whose holder cannot be named.
     */
    db.cleaners = [{
      id: HOLDER_UID,
      first_name: 'Ana',
      last_name: 'Costa',
      mobile_number: '07700900321',
      is_active: false,
    }]

    const { status, body } = await call(newCleaner)

    expect(status).toBe(409)
    expect(body.existingUserId).toBe(HOLDER_UID)
  })
})

describe('one phone number across two roles is ALLOWED, deliberately', () => {
  /**
   * DECIDED BY MIGUEL, 2026-08-31. Do not "fix" this back.
   *
   * I originally asserted the opposite here, reasoning from migration
   * 20260824160347's stated intent ("the same person got several accounts, each
   * with its own login and its own slice of history"). That reasoning was about
   * one ROLE, not two. Miguel overruled it, and the reasons are good:
   *
   *   - a supervisor who also cleans is a real person on this team;
   *   - both logins genuinely work today, because the synthetic emails differ by
   *     role domain -- 447999380349@cleaner... is not 447999380349@manager...;
   *   - blocking it now would need a migration AND a decision about which of an
   *     existing person's rows gets deleted. That is not a code fix.
   *
   * So the mechanism is not a bug: prevent_duplicate_phone_account runs
   * `select id from public.%I` against tg_table_name -- its own table only -- and
   * GoTrue cannot see across role domains. One number, one account PER ROLE.
   *
   * What WAS wrong is the comment at index.ts:130-133 claiming the trigger
   * "looks across cleaners and managers". It does not, and findCollidingUser's
   * two-table search was justified by that false claim. The search should stay;
   * the justification has to change.
   */
  const managerHoldingTheNumber = {
    id: HOLDER_UID,
    first_name: 'Courtney',
    last_name: 'Reed',
    mobile_number: '+447700900321',
    is_active: true,
    role: 'manager',
  }

  it('creates a cleaner for a number that already has a manager account', async () => {
    db.managers = [managerHoldingTheNumber]

    const { status } = await call(newCleaner)

    expect(status).toBe(200)
  })

  it('writes the cleaner row, so the supervisor really has both logins', async () => {
    db.managers = [managerHoldingTheNumber]

    await call(newCleaner)

    expect(db.cleaners).toHaveLength(1)
  })

  it('still refuses a SECOND cleaner on that number -- one account per role', async () => {
    db.managers = [managerHoldingTheNumber]
    await call(newCleaner)

    const { status } = await call(newCleaner)

    expect(status).toBe(409)
  })

  it('names a holder from the requested role first, not the other table', async () => {
    // Both tables hold the number. The account that actually blocked this
    // creation is the cleaner, so that is the one the admin needs to be sent to.
    db.managers = [managerHoldingTheNumber]
    await call(newCleaner)

    const { body } = await call(newCleaner)

    expect(body.existingRole).toBe('cleaner')
  })
})

describe('managers who identify by username and managers who identify by phone', () => {
  /**
   * Regression cover for a bug that ALREADY REACHED PRODUCTION ONCE, with the
   * same symptom Miguel is reporting now. Migration
   * 20260826034503_make_manager_phone_optional_for_username_roles.sql, verbatim:
   *
   *   "Because managers.mobile_number was NOT NULL, the admin-create-user Edge
   *    Function wrote '' for those roles, and the UNIQUE constraint then allowed
   *    exactly one such account to exist. The first ops_manager took the ''
   *    slot; every later one failed with 23505 and the function returned 400,
   *    surfacing in the UI as 'Could not create user'."
   *
   * The fix was NULL plus a partial index. Nothing tests the behaviour, only
   * the single stored value, so a future caller reintroducing '' would ship
   * the same outage again. These are the behavioural tests.
   */
  const opsManager = (username: string) => ({
    adminId: ADMIN_UID,
    role: 'ops_manager',
    firstName: 'Ops',
    lastName: 'Lead',
    username,
  })

  it('creates a SECOND ops_manager after a first one already exists', async () => {
    await call(opsManager('ops.one'))

    const { status } = await call(opsManager('ops.two'))

    expect(status).toBe(200)
  })

  it('ends up with both username-identified managers, not just the first', async () => {
    await call(opsManager('ops.one'))
    await call(opsManager('ops.two'))

    expect(db.managers).toHaveLength(2)
  })

  it('creates a phone-identified manager alongside a username-identified one', async () => {
    await call(opsManager('ops.one'))

    const { status } = await call({ ...newCleaner, role: 'manager' })

    expect(status).toBe(200)
  })

  it('creates two phone-identified managers on different numbers', async () => {
    await call({ ...newCleaner, role: 'manager' })

    const { status } = await call({ ...newCleaner, role: 'manager', phone: '07700 900999' })

    expect(status).toBe(200)
  })

  it('never writes the empty-string sentinel that caused the original outage', async () => {
    await call(opsManager('ops.one'))

    expect(db.managers[0].mobile_number).not.toBe('')
  })
})

describe('a database fault is not an authorization decision', () => {
  /**
   * index.ts:
   *   if (adminErr || !adminRow || adminRow.is_active === false)
   *     return jsonResponse({ error: 'Not authorized' }, 403)
   *
   * Three different production states collapse into one opaque 403:
   *   (a) the caller is genuinely not an admin
   *   (b) the caller IS an admin, but no admins row is keyed by their auth uid
   *   (c) the lookup itself failed -- missing column, missing table, bad grant
   *
   * The existing fake cannot return an error from that lookup at all, so (c)
   * is unreachable in the current suite. An operator who is a real admin and
   * hits (b) or (c) is told the same thing as a cleaner poking the endpoint:
   * "Not authorized". That is the "idk why".
   */
  /** Drives the function with an `admins` lookup that behaves however we say. */
  const callWithAdminsLookup = async (
    result: { data: Row | null; error: { code: string; message: string } | null },
  ) => {
    const client = makeClient()
    const broken = {
      ...client,
      from: (table: string) =>
        table === 'admins'
          ? { select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }
          : client.from(table),
    }
    const handler = loadHandler(broken)
    const res = await handler(
      new Request('https://stub.functions.supabase.co/admin-create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer a-real-admin-jwt' },
        body: JSON.stringify(newCleaner),
      }),
    )
    return { status: res.status, body: await res.json() }
  }

  /**
   * Refusing on a failed lookup is correct -- fail closed. Saying the SAME
   * WORDS for both is not: the operator cannot tell "you may not do this" from
   * "we could not check whether you may do this", and only one of those is
   * fixed by calling Miguel.
   *
   * This asserts distinguishability, not a particular status or wording, so a
   * fix is free to choose either.
   */
  it('tells a real admin something different from what it tells a non-admin', async () => {
    const notAnAdmin = await callWithAdminsLookup({ data: null, error: null })
    const lookupBroke = await callWithAdminsLookup({
      data: null,
      error: { code: '42703', message: 'column admins.is_active does not exist' },
    })

    expect(lookupBroke.body.error).not.toBe(notAnAdmin.body.error)
  })
})

describe('production shape: one number, four rows, two roles', () => {
  /**
   * NOT INVENTED AND NO LONGER GUESSED. Read from production 2026-08-31 and
   * relayed by the foreman, including the auth emails I previously had to
   * assume:
   *
   *  table     id        stored number     auth email                              active
   *  managers  00a3caf6  +4407999380349    447999380349@manager.…  (2025-10-02)    no
   *  managers  101ae380  07999380349       NONE - no auth user at all              YES
   *  cleaners  891817a5  +447999380349     447999380349@cleaner.…  (2025-10-07)    no
   *  cleaners  0525d91c  7999380349        7999380349@cleaner.…    (malformed)     no
   *
   * All four normalize to 447999380349. Two are un-normalised because migration
   * 20260824160347 deliberately skipped rows in duplicate groups.
   *
   * THE DECISIVE FACT: the canonical synthetic email already exists for BOTH
   * roles, so a new cleaner AND a new manager on this number are both refused by
   * Supabase Auth. The duplicate-phone trigger never runs. Every test here is
   * therefore built on the auth path, which is the path production actually
   * takes for every duplicate group.
   */
  const LIVE_DIGITS = '447999380349'
  const MGR_INTL = '00a3caf6-0000-4000-8000-000000000001'
  const MGR_TRUNK = '101ae380-0000-4000-8000-000000000002'
  const CLN_E164 = '891817a5-0000-4000-8000-000000000003'
  const CLN_LEGACY = '0525d91c-0000-4000-8000-000000000004'

  const seedLive = () => {
    db.managers = [
      { id: MGR_INTL, first_name: 'Courtney', last_name: 'Reed', mobile_number: '+4407999380349', is_active: false, role: 'manager' },
      { id: MGR_TRUNK, first_name: 'Courtney', last_name: 'Reed', mobile_number: '07999380349', is_active: true, role: 'manager' },
    ]
    db.cleaners = [
      { id: CLN_E164, first_name: 'Courtney', last_name: 'Reed', mobile_number: '+447999380349', is_active: false },
      { id: CLN_LEGACY, first_name: 'Courtney', last_name: 'Reed', mobile_number: '7999380349', is_active: false },
    ]
    db.authEmails = [
      `${LIVE_DIGITS}@manager.suburbanservices.local`,
      `${LIVE_DIGITS}@cleaner.suburbanservices.local`,
      '7999380349@cleaner.suburbanservices.local',
    ]
  }

  const onThatNumber = { ...newCleaner, phone: '07999380349' }

  it('normalises all four stored spellings to the same identity', () => {
    for (const stored of ['7999380349', '+447999380349', '07999380349', '+4407999380349']) {
      expect(normalizePhoneToDigits(stored)).toBe(LIVE_DIGITS)
    }
  })

  it('is refused by Supabase Auth, not by the trigger', async () => {
    // The observable difference: the auth path never mints a user, so nothing
    // is unwound. The trigger path creates one and then deletes it.
    seedLive()

    await call(onThatNumber)

    expect(db.deletedUsers).toEqual([])
  })

  it('names a CLEANER when a cleaner is what was refused', async () => {
    seedLive()

    const { status, body } = await call(onThatNumber)

    expect(status).toBe(409)
    expect(body.existingRole).toBe('cleaner')
  })

  it('names a MANAGER when a manager is what was refused', async () => {
    /**
     * GABY'S B1, in the exact live shape. Before the fix, a manager creation
     * looked up '+447999380349' and '447999380349' as raw strings: neither
     * matches either manager row ('+4407999380349', '07999380349'), so the
     * search fell through to cleaners and named a CLEANER. The admin was sent to
     * fix a record that was not the blocker, and would fail identically forever.
     *
     * "Named the wrong person" and "named nobody" are the same dead end.
     */
    seedLive()

    const { status, body } = await call({ ...onThatNumber, role: 'manager' })

    expect(status).toBe(409)
    expect(body.existingRole).toBe('manager')
  })

  it('never puts a uuid in the message the admin reads', async () => {
    seedLive()

    const { body } = await call(onThatNumber)

    expect(String(body.error)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    )
  })

  it('does not call this an orphaned login -- there are four real people-rows', async () => {
    seedLive()

    const { body } = await call(onThatNumber)

    expect(body.orphanedLogin).not.toBe(true)
  })

  it('leaves the duplicate group exactly as it found it', async () => {
    seedLive()

    await call(onThatNumber)

    expect(db.cleaners).toHaveLength(2)
    expect(db.managers).toHaveLength(2)
  })
})

describe('the identity scan is capped, and the cap must not become a lie', () => {
  /**
   * scanIdentityTable fetches at most IDENTITY_SCAN_LIMIT (2000) rows and
   * decides `complete: rows.length < LIMIT`. Past that, the holder may simply
   * not be in the page it read.
   *
   * The danger is not the missing holder -- it is what gets said instead.
   * outcome 'none' plus an auth-level refusal produces orphanedLogin: true,
   * which tells the admin "there is no person here, get someone to delete that
   * login". If a capped scan could yield 'none', that sentence would be aimed
   * at a real employee's account.
   */
  const CAP = 2000

  const fillCleaners = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`,
      first_name: 'Filler',
      last_name: `Number${i}`,
      mobile_number: `+4477000${String(i).padStart(5, '0')}`,
      is_active: true,
    }))

  it('still names a holder that sits inside the cap', async () => {
    db.cleaners = [
      ...fillCleaners(CAP - 1),
      { id: HOLDER_UID, first_name: 'Ana', last_name: 'Costa', mobile_number: '07700900321', is_active: true },
    ]
    db.authEmails = ['447700900321@cleaner.suburbanservices.local']

    const { body } = await call(newCleaner)

    expect(body.existingUserId).toBe(HOLDER_UID)
  })

  it('does not call a real person an orphaned login when the scan hit its cap', async () => {
    // The holder is row 2001. The scan reads 2000 rows and never sees them.
    db.cleaners = [
      ...fillCleaners(CAP),
      { id: HOLDER_UID, first_name: 'Ana', last_name: 'Costa', mobile_number: '07700900321', is_active: true },
    ]
    db.authEmails = ['447700900321@cleaner.suburbanservices.local']

    const { body } = await call(newCleaner)

    expect(body.orphanedLogin).not.toBe(true)
  })

  it('still reports a genuinely orphaned login as one', async () => {
    // Auth holds the email and no staff row anywhere matches: nobody to name,
    // and the scan is complete, so this really is a login with no person.
    db.authEmails = ['447700900321@cleaner.suburbanservices.local']

    const { body } = await call(newCleaner)

    expect(body.orphanedLogin).toBe(true)
  })
})

describe('C1: could not reach the auth service is not a bad token', () => {
  /**
   * Gaby's B1. _shared/adminGate.ts:92 separates "we could not REACH GoTrue"
   * from "we reached it and your token is no good". Nothing in the suite
   * exercised it -- I grepped for retryable/503/AuthRetryableFetchError and
   * found nothing.
   *
   * The stakes are on the client: customerOnboardingService.ts turns ANY 401
   * into "Your session has expired. Please sign in again." So the wrong branch
   * tells a validly signed-in admin, during an outage, to do the one thing that
   * cannot possibly help -- and to keep doing it.
   */
  const RETRYABLE = { name: 'AuthRetryableFetchError', message: 'fetch failed' }
  const GOTRUE_5XX = { name: 'AuthApiError', status: 503, message: 'service unavailable' }
  const BAD_TOKEN = { name: 'AuthApiError', status: 401, message: 'invalid claim' }

  it('answers 503, not 401, when the auth service cannot be reached', async () => {
    db.getUserError = RETRYABLE

    const { status } = await call(newCleaner)

    expect(status).toBe(503)
  })

  it('answers 503 when GoTrue itself returns a 5xx', async () => {
    db.getUserError = GOTRUE_5XX

    const { status } = await call(newCleaner)

    expect(status).toBe(503)
  })

  it('tells the admin to retry rather than to sign in again', async () => {
    db.getUserError = RETRYABLE

    const { body } = await call(newCleaner)

    expect(String(body.error)).toMatch(/try again/i)
    expect(String(body.error)).not.toMatch(/sign in/i)
  })

  it('still answers 401 when the token is genuinely rejected', async () => {
    db.getUserError = BAD_TOKEN

    const { status, body } = await call(newCleaner)

    expect(status).toBe(401)
    expect(body.error).toBe('Not authenticated')
  })

  it('fails closed on an unreachable auth service: no auth user is minted', async () => {
    db.getUserError = RETRYABLE

    await call(newCleaner)

    expect(db.authEmails).toEqual([])
  })

  it('fails closed on a rejected token: no auth user is minted', async () => {
    db.getUserError = BAD_TOKEN

    await call(newCleaner)

    expect(db.authEmails).toEqual([])
  })

  it('writes no role-table row on either branch', async () => {
    db.getUserError = RETRYABLE
    await call(newCleaner)
    db.getUserError = BAD_TOKEN
    await call(newCleaner)

    expect(db.cleaners).toEqual([])
  })
})

describe('C2: one number held by two rows at once', () => {
  /**
   * LIVE. managers 447759721201 (Sharron Harman) holds TWO ACTIVE rows,
   * '+4407759721201' and '07759721201'. Both satisfy the normalised predicate,
   * so `rows.find(matches)` has two legitimate answers.
   *
   * scanIdentityTable issues `.select(...).limit(2000)` with NO ORDER BY.
   * Postgres is free to return those two rows in either order, and that order
   * can change after an update or a vacuum. db.unstableScanOrder models exactly
   * that -- it is not an adversarial fake, it is the absence of a guarantee.
   */
  const SHARRON_A = 'aaaa1111-0000-4000-8000-000000000001'
  const SHARRON_B = 'bbbb2222-0000-4000-8000-000000000002'

  const seedSharron = () => {
    db.managers = [
      { id: SHARRON_A, first_name: 'Sharron', last_name: 'Harman', mobile_number: '+4407759721201', is_active: true, role: 'manager' },
      { id: SHARRON_B, first_name: 'Sharron', last_name: 'Harman', mobile_number: '07759721201', is_active: true, role: 'manager' },
    ]
    db.authEmails = ['447759721201@manager.suburbanservices.local']
  }

  const addManager = {
    adminId: ADMIN_UID,
    role: 'manager',
    firstName: 'Sharron',
    lastName: 'Harman',
    phone: '07759721201',
  }

  it('names the same holder on two successive attempts', async () => {
    seedSharron()
    db.unstableScanOrder = true

    const first = await call(addManager)
    const second = await call(addManager)

    // Without an ORDER BY, the admin can be sent to a different person for the
    // same input. Whichever row is chosen, it has to be chosen consistently.
    expect(second.body.existingUserId).toBe(first.body.existingUserId)
  })

  it('tells the admin that more than one record holds the number', async () => {
    /**
     * Miguel ruled duplicates report-only and merges them by hand, so the COUNT
     * is the deliverable. Naming one of two arbitrarily answers a question he
     * did not ask and hides the one he did.
     *
     * Maria has implemented existingMatchCount; this pins it.
     */
    seedSharron()

    const { body } = await call(addManager)

    expect(body.existingMatchCount).toBe(2)
  })

  it('reports a count of one when only one record holds it', async () => {
    db.managers = [
      { id: SHARRON_A, first_name: 'Sharron', last_name: 'Harman', mobile_number: '+4407759721201', is_active: true, role: 'manager' },
    ]
    db.authEmails = ['447759721201@manager.suburbanservices.local']

    const { body } = await call(addManager)

    expect(body.existingMatchCount).toBe(1)
  })

  it('counts matches across BOTH tables, not just the requested role', async () => {
    // Courtney is the live case: four rows, two of them cleaners. A manager
    // creation that reports "1" while three other records hold the number sends
    // the admin away thinking one merge will finish the job.
    seedSharron()
    db.cleaners = [
      { id: 'cccc3333-0000-4000-8000-000000000003', first_name: 'Sharron', last_name: 'Harman', mobile_number: '447759721201', is_active: true },
    ]

    const { body } = await call(addManager)

    expect(body.existingMatchCount).toBeGreaterThanOrEqual(2)
  })
})

describe('C3: the trigger path, which Miguel will reach while merging', () => {
  /**
   * Today the trigger never fires: the canonical synthetic email already exists
   * for every duplicate group, so Supabase Auth refuses first.
   *
   * That changes the moment Miguel merges by hand. managers 101ae380 is ACTIVE
   * with NO auth user, and its sibling 00a3caf6 holds the canonical email. Delete
   * the redundant auth user and the number lands in exactly this state:
   * createUser SUCCEEDS, and the duplicate-phone trigger is the only thing that
   * refuses. holderFromTriggerMessage then becomes the only code that can name
   * the blocker.
   *
   * He will hit this while cleaning up, so it is tested before he does.
   */
  const MGR_TRUNK = '101ae380-0000-4000-8000-000000000002'

  const seedPostMerge = () => {
    db.managers = [
      { id: MGR_TRUNK, first_name: 'Courtney', last_name: 'Reed', mobile_number: '07999380349', is_active: true, role: 'manager' },
    ]
    db.authEmails = [] // the redundant auth user has been removed
  }

  const addManager = {
    adminId: ADMIN_UID,
    role: 'manager',
    firstName: 'Courtney',
    lastName: 'Reed',
    phone: '07999380349',
  }

  it('gets past Supabase Auth, so the trigger is what refuses', async () => {
    seedPostMerge()

    await call(addManager)

    // An auth user really was minted on this path -- and then unwound.
    expect(db.deletedUsers).toHaveLength(1)
  })

  it('refuses with 409', async () => {
    seedPostMerge()

    const { status } = await call(addManager)

    expect(status).toBe(409)
  })

  it('names the exact row the trigger named, not merely a row that matches', async () => {
    seedPostMerge()

    const { body } = await call(addManager)

    expect(body.existingUserId).toBe(MGR_TRUNK)
  })

  it('unwinds the auth user it had already created', async () => {
    seedPostMerge()

    await call(addManager)

    expect(db.authEmails).toHaveLength(1) // minted...
    expect(db.deletedUsers).toHaveLength(1) // ...and removed again
  })

  it('leaks no uuid into the message the admin reads', async () => {
    // The trigger's raw message embeds the clashing row's uuid.
    seedPostMerge()

    const { body } = await call(addManager)

    expect(String(body.error)).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    )
  })

  it('writes no manager row', async () => {
    seedPostMerge()

    await call(addManager)

    expect(db.managers).toHaveLength(1)
  })
})

describe('C2b: "oldest first" has to actually be oldest', () => {
  /**
   * oldestFirst() sorts by created_at and falls back to id. The determinism it
   * buys is real and my C2 test confirms it.
   *
   * But IDENTITY_COLUMNS never SELECTS created_at:
   *   cleaners: 'id, first_name, last_name, is_active, mobile_number'
   *   managers: 'id, first_name, last_name, is_active, role, mobile_number, username'
   * PostgREST returns only the selected columns, so row.created_at is undefined
   * on every row and the comparison collapses to the id tiebreak every time.
   *
   * Stable, but arbitrary -- and the two are not the same thing here. The ORIGINAL
   * record is the one carrying the history, and it is the correct merge target.
   * Miguel is merging these by hand on a report-only ruling, so being sent to the
   * newest of two duplicates is being sent to the wrong one.
   *
   * (This is only visible because the fake projects to the selected columns, the
   * way PostgREST does. A fake that returned whole rows would hide it.)
   */
  const OLDER_BUT_LATER_ID = 'ffffffff-0000-4000-8000-00000000000f'
  const NEWER_BUT_EARLIER_ID = 'aaaaaaaa-0000-4000-8000-00000000000a'

  const addManager = {
    adminId: ADMIN_UID,
    role: 'manager',
    firstName: 'Sharron',
    lastName: 'Harman',
    phone: '07759721201',
  }

  beforeEach(() => {
    db.managers = [
      {
        id: OLDER_BUT_LATER_ID,
        first_name: 'Sharron',
        last_name: 'Harman',
        mobile_number: '+4407759721201',
        is_active: true,
        role: 'manager',
        created_at: '2024-01-15T09:00:00Z',
      },
      {
        id: NEWER_BUT_EARLIER_ID,
        first_name: 'Sharron',
        last_name: 'Harman',
        mobile_number: '07759721201',
        is_active: true,
        role: 'manager',
        created_at: '2025-06-01T09:00:00Z',
      },
    ]
    db.authEmails = ['447759721201@manager.suburbanservices.local']
  })

  it('names the row that was created first, not the one with the lower id', async () => {
    const { body } = await call(addManager)

    expect(body.existingUserId).toBe(OLDER_BUT_LATER_ID)
  })

  it('is still deterministic whichever way the database returns them', async () => {
    // The determinism half already works and must not regress while the
    // oldest-first half is fixed.
    db.unstableScanOrder = true

    const first = await call(addManager)
    const second = await call(addManager)

    expect(second.body.existingUserId).toBe(first.body.existingUserId)
  })

  it('falls back to the id when two rows really do share a timestamp', async () => {
    // The batch-duplicate case oldestFirst's comment describes. This is the
    // branch that currently does all the work.
    db.managers = db.managers.map((row) => ({ ...row, created_at: '2024-01-15T09:00:00Z' }))

    const { body } = await call(addManager)

    expect(body.existingUserId).toBe(NEWER_BUT_EARLIER_ID)
  })
})

describe('the body-supplied adminId is not a credential', () => {
  /**
   * The behavioural half of the regression guard in
   * adminCreateManagerRetired.test.ts, and the property that actually matters.
   *
   * The retired admin-create-manager authorized off a UUID in the request body
   * and authenticated nobody, so the anon key in the browser bundle was enough
   * to mint an ops_manager and read back its plaintext password. The structural
   * checks prove the gate is still wired in; these prove it still refuses.
   *
   * The attack shape exactly: a caller who CAN sign in (any cleaner) sends a
   * real admin's uuid as adminId.
   */
  const A_CLEANERS_UID = 'cccccccc-0000-4000-8000-00000000c1ea'

  const forgedPayload = { ...newCleaner, adminId: ADMIN_UID }

  beforeEach(() => {
    // A valid token -- for someone who is not an admin.
    db.callerId = A_CLEANERS_UID
  })

  it('refuses a signed-in non-admin who names a real admin in the body', async () => {
    const { status } = await call(forgedPayload)

    expect(status).toBe(403)
  })

  it('mints no auth user for them', async () => {
    await call(forgedPayload)

    expect(db.authEmails).toEqual([])
  })

  it('writes no role-table row for them', async () => {
    await call(forgedPayload)

    expect(db.cleaners).toEqual([])
  })

  it('hands back no password', async () => {
    const { body } = await call(forgedPayload)

    expect(body.password).toBeUndefined()
  })

  it('records nothing to user_passwords', async () => {
    await call(forgedPayload)

    expect(db.user_passwords).toEqual([])
  })

  it('still admits the real admin, so the gate is refusing the caller and not everyone', async () => {
    db.callerId = ADMIN_UID

    const { status } = await call(newCleaner)

    expect(status).toBe(200)
  })
})
