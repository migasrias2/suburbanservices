import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { normalizePhoneToDigits, formatPhoneE164, deriveSyntheticEmail, type Role } from '../_shared/phone.ts'

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
 * One row by one column, or null. Never throws.
 *
 * maybeSingle also reports an error when more than one row matches, which for
 * a uniqueness lookup means "we cannot name a single holder" -- the same
 * answer as not finding one.
 */
async function selectIdentityRow(
  admin: AdminClient,
  table: IdentityTable,
  column: string,
  value: string,
): Promise<Record<string, unknown> | null> {
  // `role` only exists on managers; naming it on the others is a 42703.
  const columns = table === 'managers'
    ? 'id, first_name, last_name, is_active, role'
    : 'id, first_name, last_name, is_active'
  const { data, error } = await admin.from(table).select(columns).eq(column, value).maybeSingle()
  if (error) return null
  return (data as Record<string, unknown> | null) ?? null
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
 * Who the refused identity already belongs to.
 *
 * "That number already has an account." is a dead end on its own: the users
 * list hides deactivated people behind a filter, so the admin cannot see the
 * holder and reasonably concludes the account does not exist. Naming them --
 * id, name, role, active flag, and nothing else -- is what turns the refusal
 * into something actionable.
 *
 * Searches BOTH tables that can hold the identity, in the requested role's
 * order: prevent_duplicate_phone_account looks across cleaners and managers,
 * so a number can be taken by the other kind of person entirely. Both stored
 * phone shapes are tried because a row written before migration
 * 20260824160347 normalized everything to '+' || digits may still be bare.
 *
 * Failure path only, and it must stay best-effort: a lookup that goes wrong
 * still leaves a clean 409 rather than becoming a 500.
 */
async function findCollidingUser(
  admin: AdminClient,
  role: Role,
  phoneE164: string | null,
  phoneDigits: string | null,
  username: string | null,
): Promise<CollidingUser | null> {
  const lookups: Array<{ table: IdentityTable; column: string; value: string }> = []

  if (role === 'cleaner' || role === 'manager') {
    const tables: IdentityTable[] = role === 'cleaner' ? ['cleaners', 'managers'] : ['managers', 'cleaners']
    for (const value of [phoneE164, phoneDigits]) {
      if (!value) continue
      for (const table of tables) lookups.push({ table, column: 'mobile_number', value })
    }
  } else if (username) {
    const tables: IdentityTable[] = role === 'admin' ? ['admins', 'managers'] : ['managers', 'admins']
    for (const table of tables) lookups.push({ table, column: 'username', value: username })
  }

  try {
    for (const lookup of lookups) {
      const row = await selectIdentityRow(admin, lookup.table, lookup.column, lookup.value)
      const found = row ? toCollidingUser(lookup.table, row) : null
      if (found) return found
    }
  } catch (error) {
    console.error('Could not identify the colliding account:', error)
  }

  return null
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
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return jsonResponse({ error: 'Not authenticated' }, 401)

  const { data: callerData, error: callerErr } = await admin.auth.getUser(token)
  const callerId = callerData?.user?.id
  if (callerErr || !callerId) return jsonResponse({ error: 'Not authenticated' }, 401)

  const { data: adminRow, error: adminErr } = await admin
    .from('admins')
    .select('id, is_active')
    .eq('id', callerId)
    .maybeSingle()
  if (adminErr || !adminRow || adminRow.is_active === false) return jsonResponse({ error: 'Not authorized' }, 403)

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
      const collided = await findCollidingUser(admin, role as Role, phoneE164, phoneDigits, cleanUsername)
      return jsonResponse({ error: duplicateMessage(role as Role), ...(collided ?? {}) }, 409)
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
      await admin.auth.admin.deleteUser(userId)
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
    await admin.auth.admin.deleteUser(userId)
    if (isDuplicateIdentity(insertErr)) {
      const collided = await findCollidingUser(admin, role as Role, phoneE164, phoneDigits, cleanUsername)
      return jsonResponse({ error: duplicateMessage(role as Role), ...(collided ?? {}) }, 409)
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
