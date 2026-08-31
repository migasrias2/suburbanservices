import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { normalizePhoneToDigits, formatPhoneE164, deriveSyntheticEmail, type Role } from '../_shared/phone.ts'
import { authorizeAdminCaller } from '../_shared/adminGate.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const WORDS_A = ['swift','calm','brave','bold','quiet','sunny','bright','clear','still','quick','fresh','warm','cool','crisp','soft','sharp','glad','keen','neat','smart']
const WORDS_B = ['otter','river','peak','cloud','willow','meadow','forest','harbor','valley','summit','breeze','lantern','copper','silver','golden','marble','ember','horizon','quartz','aspen']

/**
 * Uniform pick from a CSPRNG. Math.random() is not seeded for secrecy and is
 * the wrong tool for anything that becomes a credential.
 */
function pick<T>(list: T[]): T {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return list[buf[0] % list.length]
}

function generateReadablePassword(): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return `${pick(WORDS_A)}-${pick(WORDS_B)}-${10 + (buf[0] % 90)}`
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

/**
 * True when an error means "this identity is already taken".
 *
 * Two independent guards can fire, and the operator must not have to care
 * which: GoTrue's own uniqueness on the synthetic email, and the
 * prevent_duplicate_phone_account trigger from migration 20260824160347,
 * which raises with errcode unique_violation (23505).
 */
function isDuplicateIdentity(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false
  if (err.code === '23505' || err.code === 'email_exists' || err.code === 'phone_exists') return true
  // Deliberately narrow. A bare /already exists/ would also swallow schema
  // errors like "relation already exists" and mislabel them as a taken phone.
  return /already (been )?registered|duplicate key|an account already exists for phone/i.test(err.message ?? '')
}

/**
 * The message the admin sees for a taken identity.
 *
 * Never the raw one. GoTrue says "User already registered" about a synthetic
 * email the admin never typed, and the duplicate-phone trigger embeds the
 * clashing row's UUID in its message — an internal id that has no business
 * reaching the browser.
 */
function duplicateMessage(role: Role): string {
  return role === 'cleaner' || role === 'manager'
    ? 'That number already has an account.'
    : 'That username is already taken.'
}

/** The one shape of the colliding account the browser is allowed to see. */
type CollidingUser = {
  existingUserId: string
  existingName: string
  existingRole: Role
  existingIsActive: boolean
}

type IdentityTable = 'cleaners' | 'managers' | 'admins'

type AdminClient = ReturnType<typeof createClient>

/**
 * Columns per table. `role` and `username` exist only on managers, `username`
 * also on admins, `mobile_number` not on admins at all. Naming a column the
 * table does not have is a 42703 that fails the whole lookup.
 */
const IDENTITY_COLUMNS: Record<IdentityTable, string> = {
  cleaners: 'id, first_name, last_name, is_active, mobile_number, created_at',
  managers: 'id, first_name, last_name, is_active, role, mobile_number, username, created_at',
  admins: 'id, first_name, last_name, is_active, username, created_at',
}

/**
 * The one table that can hold a given role's identity, and therefore the only
 * table that can refuse it. `manager` and `ops_manager` share `managers`.
 */
function identityTableFor(role: Role): IdentityTable {
  if (role === 'cleaner') return 'cleaners'
  if (role === 'admin') return 'admins'
  return 'managers'
}

/**
 * Ceiling on a collision scan. Staff tables are in the tens of rows (29 cleaners
 * and 19 managers as of 2026-08-31, so this cap is ~1% used), and this runs only
 * on the failure path, so the limit exists to bound a pathological case rather
 * than because it is expected to be reached.
 *
 * WHAT BREAKS IF THE COMPANY GROWS: past this many rows the scan stops being
 * exhaustive, `complete` goes false, and collisions degrade to 'unknown' -- the
 * refusal stays correct but STOPS NAMING THE HOLDER, which is the whole feature.
 * That is honest rather than wrong, and is why the flag exists, but if you are
 * reading this because holders stopped being named, a large staff table is why.
 * The fix is not a bigger number: it is an admin-gated RPC filtering on
 * public.normalize_phone_digits(mobile_number), which the indexes created in
 * 20260824160347 already support. That needs a migration.
 */
const IDENTITY_SCAN_LIMIT = 2000

type ScanResult = {
  /** Every matching row, oldest first. More than one is normal here. */
  rows: Record<string, unknown>[]
  /** False when this scan cannot be trusted to have seen every row. */
  complete: boolean
}

/**
 * Oldest first, so the same collision names the same person every time.
 *
 * Without an order the holder is whichever row Postgres happened to return
 * first, which is not stable between calls. Production has a duplicate group of
 * two ACTIVE manager rows for one number, so an admin retrying the same creation
 * could be sent to a different person each time. Sorted here rather than with
 * .order() because the scan is only trusted when it saw every row anyway, which
 * makes the two equivalent -- and this keeps the query a plain select.
 */
function oldestFirst(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const byAge = String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
    if (byAge !== 0) return byAge
    // created_at alone is not enough. It can be absent, and rows created in one
    // batch can share a timestamp to the microsecond -- which is exactly how
    // duplicate rows tend to be born. Falling back to array order there would
    // hand the choice back to whatever order the database happened to return,
    // which is the non-determinism this function exists to remove. The id is
    // arbitrary but total, so the same collision names the same person forever.
    return String(a.id ?? '').localeCompare(String(b.id ?? ''))
  })
}

/**
 * Every row of one table, matched in TypeScript rather than by SQL equality.
 *
 * The identity is the NORMALISED number, not the stored spelling. PostgREST
 * cannot filter on public.normalize_phone_digits(mobile_number) without an RPC,
 * so the comparison happens here, against the same canonical function the login
 * path uses. Never throws.
 */
async function scanIdentityTable(
  admin: AdminClient,
  table: IdentityTable,
  matches: (row: Record<string, unknown>) => boolean,
): Promise<ScanResult> {
  const { data, error } = await admin
    .from(table)
    .select(IDENTITY_COLUMNS[table])
    .limit(IDENTITY_SCAN_LIMIT)

  if (error) {
    console.error(`Could not scan ${table} while naming the colliding account:`, error)
    return { rows: [], complete: false }
  }

  const rows = (data ?? []) as Record<string, unknown>[]
  return {
    rows: oldestFirst(rows.filter(matches)),
    complete: rows.length < IDENTITY_SCAN_LIMIT,
  }
}

function toCollidingUser(table: IdentityTable, row: Record<string, unknown>): CollidingUser | null {
  const id = row.id
  if (typeof id !== 'string' || !id) return null

  const role: Role = table === 'cleaners'
    ? 'cleaner'
    : table === 'admins'
      ? 'admin'
      : row.role === 'ops_manager' ? 'ops_manager' : 'manager'

  return {
    existingUserId: id,
    existingName: [row.first_name, row.last_name].filter(Boolean).join(' ').trim(),
    existingRole: role,
    // Absent or NULL is active everywhere else in this schema; only an explicit
    // false is a deactivation.
    existingIsActive: row.is_active !== false,
  }
}

/**
 * What a collision lookup is allowed to conclude.
 *
 * 'none' is a POSITIVE finding -- every row was seen and none holds the
 * identity -- and callers act on it. It must therefore never be returned for a
 * lookup that merely failed to find something; that is 'unknown'. Collapsing
 * the two is how "we could not check" turns into "nobody has this", which is
 * the class of bug this whole change is about.
 */
type CollisionLookup =
  | { outcome: 'found'; holder: CollidingUser; matchCount: number }
  | { outcome: 'none' }
  | { outcome: 'unknown' }

/**
 * Who the refused identity already belongs to.
 *
 * "That number already has an account." is a dead end on its own: the users
 * list hides deactivated people behind a filter, so the admin cannot see the
 * holder and reasonably concludes the account does not exist. Naming them --
 * id, name, role, active flag, and nothing else -- is what turns the refusal
 * into something actionable.
 *
 * MATCHES ON THE NORMALISED IDENTITY, not on stored spelling. The previous
 * version compared the raw column against two literal spellings, which missed
 * exactly the rows it most needed to find: migration 20260824160347 normalised
 * numbers to '+' || digits but skipped every row already in a duplicate group
 * (both its UPDATEs are guarded by `having count(*) = 1`), so the numbers most
 * likely to collide are precisely the ones still stored in an arbitrary shape.
 * Production holds one number as '7999380349', '07999380349', '+447999380349'
 * and '+4407999380349' across two tables.
 *
 * SEARCHES ONLY THE TABLE THAT CAN ACTUALLY BLOCK, which corrects a false claim
 * that used to stand here. The old comment asserted that
 * prevent_duplicate_phone_account "looks across cleaners and managers", and the
 * cross-table search below it existed for that reason. The trigger does no such
 * thing: it runs `select id from public.%I` against tg_table_name, its OWN table
 * (20260824160347:102-105). Both refusal paths are therefore same-table --
 * the trigger only ever fires on the table being inserted into, and an
 * auth-level collision is same-role because each role has its own email domain
 * (phone.ts:27-32). A cross-table fallback has no correct case: it can only name
 * a row that could not have caused the refusal. With one number now legitimately
 * allowed to hold both a cleaner and a manager account, it would confidently
 * blame a perfectly valid cleaner for a manager that failed to insert, and send
 * the admin off to "fix" data that was never the problem.
 *
 * Failure path only, and it must stay best-effort: a lookup that goes wrong
 * still leaves a clean 409 rather than becoming a 500.
 */
async function findCollidingUser(
  admin: AdminClient,
  role: Role,
  phoneDigits: string | null,
  username: string | null,
): Promise<CollisionLookup> {
  const table = identityTableFor(role)
  let matches: (row: Record<string, unknown>) => boolean

  if (role === 'cleaner' || role === 'manager') {
    if (!phoneDigits) return { outcome: 'unknown' }
    matches = (row) => normalizePhoneToDigits(String(row.mobile_number ?? '')) === phoneDigits
  } else {
    if (!username) return { outcome: 'unknown' }
    matches = (row) => String(row.username ?? '').trim().toLowerCase() === username
  }

  try {
    const result = await scanIdentityTable(admin, table, matches)
    if (result.rows.length > 0) {
      const holder = toCollidingUser(table, result.rows[0])
      if (holder) return { outcome: 'found', holder, matchCount: result.rows.length }
      // A row matched but carried no usable id. Someone holds this identity and
      // we cannot name them -- which is 'unknown', and never 'none'.
      return { outcome: 'unknown' }
    }
    return result.complete ? { outcome: 'none' } : { outcome: 'unknown' }
  } catch (error) {
    console.error('Could not identify the colliding account:', error)
    return { outcome: 'unknown' }
  }
}

/**
 * The exact row the duplicate-phone trigger refused for, taken from its own
 * message rather than inferred.
 *
 * The trigger raises 'An account already exists for phone +% (%.id = %)' with
 * the table and the clashing row's id already resolved (20260824160347:108).
 * That is strictly better than any scan: it is the row that actually blocked,
 * not a row that merely matches. Where a duplicate GROUP exists -- production
 * has two manager rows for one number -- a scan can only return "a" holder,
 * while this returns "the" holder.
 *
 * WHICH PATH SERVES WHEN, because it is not obvious and the answer inverts:
 * on TODAY's data this never runs. Every duplicate group has a sibling already
 * holding the canonical synthetic email, so GoTrue refuses at createUser and the
 * insert is never reached -- the SCAN is what serves production right now. This
 * becomes the live path once the duplicates are merged by hand: a surviving row
 * whose redundant auth user was removed still matches the trigger on normalised
 * digits while nothing holds its email. Manager 101ae380 is exactly that shape
 * already, and mid-cleanup is the worst possible moment for a nameless 409.
 *
 * The id is used server-side only, to build the same four-field sanitized shape
 * as every other path. It does not reach the browser, so the :55-59 rule about
 * not leaking the trigger's raw message still holds.
 */
async function holderFromTriggerMessage(
  admin: AdminClient,
  message: string | undefined,
): Promise<CollidingUser | null> {
  const match = /\b(cleaners|managers)\.id = ([0-9a-fA-F-]{36})\)/.exec(message ?? '')
  if (!match) {
    // Falling back to the scan is correct but degraded, and silent degradation
    // is how this class of bug survives. If 20260824160347's wording is ever
    // edited, this line is the only thing that will say so.
    if (/already exists for phone/i.test(message ?? '')) {
      console.error('Duplicate-phone trigger fired but its message did not parse:', message)
    }
    return null
  }

  const table = match[1] as IdentityTable
  const { data, error } = await admin
    .from(table)
    .select(IDENTITY_COLUMNS[table])
    .eq('id', match[2])
    .maybeSingle()

  if (error || !data) return null
  return toCollidingUser(table, data as Record<string, unknown>)
}

/**
 * The message for an identity held by a login with no staff record behind it.
 *
 * Distinct from duplicateMessage because the remedy is different: there is no
 * person to go and look at, so pointing the admin at the users list wastes
 * their time. Reported, not repaired -- reclaiming a login touches auth records
 * and is not something this endpoint should decide to do on its own.
 */
function orphanedLoginMessage(role: Role): string {
  const identity = role === 'cleaner' || role === 'manager' ? 'That number' : 'That username'
  return `${identity} already has a login, but no staff record is linked to it. ` +
    'An administrator needs to remove that login before this person can be added.'
}

/**
 * The 409 for a taken identity.
 *
 * `source` decides what a nameless collision means, and the two cases are not
 * interchangeable. When GOTRUE refused, a login provably exists; if no role row
 * holds the identity either, what is left is a login with no staff record, and
 * saying so is the difference between an actionable refusal and a dead end.
 * When the ROLE TABLE refused, a role row provably exists -- the trigger found
 * it -- so a lookup that names nobody is our own blind spot, not an orphan, and
 * must not be dressed up as one.
 */
function duplicateResponse(role: Role, lookup: CollisionLookup, source: 'auth' | 'role-table') {
  if (lookup.outcome === 'found') {
    // How MANY rows hold this identity, not just the first. Production has
    // duplicate groups -- one of them two active manager rows for one number --
    // and an admin sent to a single record would fix half the problem and hit
    // the same refusal again. Miguel merges these by hand, so the count is the
    // part he actually needs.
    return jsonResponse(
      { error: duplicateMessage(role), ...lookup.holder, existingMatchCount: lookup.matchCount },
      409,
    )
  }
  if (lookup.outcome === 'none' && source === 'auth') {
    return jsonResponse({ error: orphanedLoginMessage(role), orphanedLogin: true }, 409)
  }
  return jsonResponse({ error: duplicateMessage(role) }, 409)
}

/**
 * Removes the auth user created moments ago, reporting whether it worked.
 *
 * The result is NOT decoration. A discarded failure here is how an auth user
 * with no role row comes into existence: it holds the synthetic email forever,
 * every later attempt for that person is refused, and the code that created it
 * is the same code written to prevent it.
 */
async function unwindAuthUser(admin: AdminClient, userId: string): Promise<boolean> {
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) {
    // The ONLY record of this id. It is not returned to the browser, because the
    // person who can delete an auth user needs service-role or database access
    // and is reading this log, not a response body. Say what it is and what it
    // needs, so it is actionable without reading this file first.
    console.error(
      'ORPHANED LOGIN: auth user could not be removed after a failed role insert. ' +
        'It holds the synthetic email and will refuse every future create for this ' +
        'person until it is deleted by hand. auth.users.id =',
      userId,
      error,
    )
    return false
  }
  return true
}

/**
 * A create that half-succeeded and could not be cleaned up. Never a 2xx.
 *
 * Carries NO id. The leftover login's uuid is written to the server log by
 * unwindAuthUser instead, because the only person who can act on it needs
 * service-role or database access to delete an auth user -- they are reading
 * logs, not a browser response body. Shipping the id here would be an
 * identifier no consumer reads, which is how a field becomes load-bearing
 * later without anyone having decided that it should be.
 */
function partialAccountResponse() {
  return jsonResponse({
    error: 'The account was partly created and could not be cleaned up automatically. ' +
      'Ask an administrator to remove the leftover login before trying again.',
  }, 500)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  let payload: any
  try { payload = await req.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }

  const { adminId, role, firstName, lastName, phone, username, email: adminEmail } = payload ?? {}
  if (!adminId || !firstName || !lastName || !role) return jsonResponse({ error: 'Missing required fields' }, 400)
  if (!['cleaner', 'manager', 'ops_manager', 'admin'].includes(role)) return jsonResponse({ error: 'Invalid role' }, 400)

  let identifier: string | undefined
  if (role === 'cleaner' || role === 'manager') identifier = phone
  else identifier = username

  if (!identifier || String(identifier).trim() === '') {
    return jsonResponse({ error: (role === 'cleaner' || role === 'manager') ? 'Phone required' : 'Username required' }, 400)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  // Authorization comes from the caller's own JWT, not from payload.adminId.
  // A body-supplied UUID is only a claim, and this endpoint mints accounts --
  // including admin accounts, which can read every recorded staff password.
  // Membership is unchanged by the move into _shared/adminGate.ts: an active
  // row in `admins`, keyed by the caller's own auth.uid(). Only the reporting
  // improved, so a database fault no longer reads as a lost permission.
  const gate = await authorizeAdminCaller(admin, req)
  if (!gate.ok) return jsonResponse({ error: gate.denial.error }, gate.denial.status)
  const callerId = gate.callerId

  const phoneDigits = (role === 'cleaner' || role === 'manager') ? normalizePhoneToDigits(String(phone)) : null
  const cleanUsername = (role === 'ops_manager' || role === 'admin') ? String(username).trim().toLowerCase() : null

  // A phone that normalizes to nothing would derive the email "@cleaner…local"
  // and mint an account nobody can ever log into. Refuse before creating.
  if ((role === 'cleaner' || role === 'manager') && !phoneDigits) {
    return jsonResponse({ error: 'Enter a valid UK mobile number.' }, 400)
  }

  const password = generateReadablePassword()
  const email = deriveSyntheticEmail(role as Role, String(identifier))
  // E.164 for storage, bare digits for the auth identity. Migration
  // 20260824160347 normalized every existing row to '+' || digits, and
  // cleaners_mobile_number_key compares raw strings, so bare digits stored here
  // would sit beside the "+44…" rows without ever colliding as a duplicate.
  const phoneE164 = (role === 'cleaner' || role === 'manager') ? formatPhoneE164(String(phone)) : null

  const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      app_role: role,
      first_name: firstName,
      last_name: lastName,
      mobile_number: phoneDigits,
      username: cleanUsername,
    },
  })

  if (authErr || !authUser?.user) {
    if (isDuplicateIdentity(authErr)) {
      const lookup = await findCollidingUser(admin, role as Role, phoneDigits, cleanUsername)
      return duplicateResponse(role as Role, lookup, 'auth')
    }
    return jsonResponse({ error: authErr?.message || 'Failed to create auth user' }, 400)
  }

  const userId = authUser.user.id

  let insertErr: { message: string; code?: string } | null = null
  if (role === 'cleaner') {
    const { error } = await admin.from('cleaners').insert({
      id: userId,
      first_name: firstName,
      last_name: lastName,
      mobile_number: phoneE164,
      password_hash: 'managed_by_supabase_auth',
      email: adminEmail || null,
      is_active: true,
    })
    insertErr = error
  } else if (role === 'manager' || role === 'ops_manager') {
    // Latent, pre-existing: two managers created in the same millisecond collide
    // on employee_id. That 23505 would now be reported as a duplicate phone by
    // isDuplicateIdentity rather than as the raw error. Known, not fixed here.
    const employeeId = `${role === 'ops_manager' ? 'OPS' : 'MGR'}_${Date.now()}`
    const { error } = await admin.from('managers').insert({
      id: userId,
      first_name: firstName,
      last_name: lastName,
      // NULL, never '': ops managers identify by username and have no phone.
      // The '' sentinel used to collide with the unique index on the second
      // such account and surfaced as "Could not create user".
      mobile_number: phoneE164,
      password_hash: 'managed_by_supabase_auth',
      employee_id: employeeId,
      is_active: true,
      role,
      username: cleanUsername,
    })
    insertErr = error
  } else if (role === 'admin') {
    if (!adminEmail || String(adminEmail).trim() === '') {
      if (!(await unwindAuthUser(admin, userId))) return partialAccountResponse()
      return jsonResponse({ error: 'Email required for admin' }, 400)
    }
    const { error } = await admin.from('admins').insert({
      id: userId,
      username: cleanUsername,
      first_name: firstName,
      last_name: lastName,
      email: String(adminEmail).trim(),
      password_hash: 'managed_by_supabase_auth',
      is_active: true,
    })
    insertErr = error
  }

  if (insertErr) {
    // Unwind the auth user so a failed role insert cannot leave a login with no
    // role row behind it. An orphan is a credential that authenticates and then
    // resolves to no role at all -- signed in, and refused everywhere.
    // If the unwind itself fails, say so: reporting the original error while
    // silently leaving the login behind is what makes the next attempt refuse
    // for a reason nobody can see.
    if (!(await unwindAuthUser(admin, userId))) return partialAccountResponse()

    if (isDuplicateIdentity(insertErr)) {
      // The trigger already resolved the exact row it refused for. Prefer it: a
      // scan can only find "a" holder of this number, this is "the" one that
      // blocked -- and production has duplicate groups where those differ.
      const named = await holderFromTriggerMessage(admin, insertErr.message)
      if (named) return jsonResponse({ error: duplicateMessage(role as Role), ...named }, 409)

      const lookup = await findCollidingUser(admin, role as Role, phoneDigits, cleanUsername)
      return duplicateResponse(role as Role, lookup, 'role-table')
    }
    return jsonResponse({ error: insertErr.message }, 400)
  }

  // Record the plaintext so the profile panel can show it later. Supabase Auth
  // keeps only a bcrypt hash, so this is the one moment the value exists in
  // readable form. A failure here leaves a working account whose password is
  // shown once and then only resettable -- not worth unwinding the user.
  const { error: recordErr } = await admin
    .from('user_passwords')
    .upsert({ user_id: userId, role, password, updated_by: callerId }, { onConflict: 'user_id' })

  return jsonResponse({
    userId,
    password,
    recorded: !recordErr,
    role,
    firstName,
    lastName,
    identifier: String(identifier),
  })
})
