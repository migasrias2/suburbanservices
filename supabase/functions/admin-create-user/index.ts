import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const DOMAINS: Record<string, string> = {
  cleaner: 'cleaner.suburbanservices.local',
  manager: 'manager.suburbanservices.local',
  ops_manager: 'ops.suburbanservices.local',
  admin: 'admin.suburbanservices.local',
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Role = 'cleaner' | 'manager' | 'ops_manager' | 'admin'

function normalizePhoneToDigits(phone: string): string {
  let d = phone.replace(/\D/g, '')
  if (d.startsWith('440') && d.length > 11) d = '44' + d.slice(3)
  if (d.startsWith('0')) d = '44' + d.slice(1)
  return d
}

function deriveSyntheticEmail(role: Role, identifier: string) {
  const domain = DOMAINS[role]
  if (role === 'ops_manager' || role === 'admin') {
    return `${identifier.trim().toLowerCase()}@${domain}`
  }
  return `${normalizePhoneToDigits(identifier)}@${domain}`
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

  const password = generateReadablePassword()
  const email = deriveSyntheticEmail(role as Role, String(identifier))
  const phoneDigits = (role === 'cleaner' || role === 'manager') ? normalizePhoneToDigits(String(phone)) : null
  const cleanUsername = (role === 'ops_manager' || role === 'admin') ? String(username).trim().toLowerCase() : null

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

  if (authErr || !authUser?.user) return jsonResponse({ error: authErr?.message || 'Failed to create auth user' }, 400)

  const userId = authUser.user.id

  let insertErr: { message: string } | null = null
  if (role === 'cleaner') {
    const { error } = await admin.from('cleaners').insert({
      id: userId,
      first_name: firstName,
      last_name: lastName,
      mobile_number: phoneDigits,
      password_hash: 'managed_by_supabase_auth',
      email: adminEmail || null,
      is_active: true,
    })
    insertErr = error
  } else if (role === 'manager' || role === 'ops_manager') {
    const employeeId = `${role === 'ops_manager' ? 'OPS' : 'MGR'}_${Date.now()}`
    const { error } = await admin.from('managers').insert({
      id: userId,
      first_name: firstName,
      last_name: lastName,
      // NULL, never '': ops managers identify by username and have no phone.
      // The '' sentinel used to collide with the unique index on the second
      // such account and surfaced as "Could not create user".
      mobile_number: phoneDigits,
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
    await admin.auth.admin.deleteUser(userId)
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
