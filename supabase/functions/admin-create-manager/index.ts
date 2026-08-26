import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const MANAGER_DOMAINS: Record<string, string> = {
  manager: 'manager.suburbanservices.local',
  ops_manager: 'ops.suburbanservices.local',
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function normalizePhoneToDigits(phone: string): string {
  let d = phone.replace(/\D/g, '')
  if (d.startsWith('440') && d.length > 11) d = '44' + d.slice(3)
  if (d.startsWith('0')) d = '44' + d.slice(1)
  return d
}

function deriveSyntheticEmail(role: 'manager' | 'ops_manager', identifier: string) {
  const domain = MANAGER_DOMAINS[role]
  if (role === 'ops_manager') return `${identifier.trim().toLowerCase()}@${domain}`
  return `${normalizePhoneToDigits(identifier)}@${domain}`
}

const WORDS_A = ['swift','calm','brave','bold','quiet','sunny','bright','clear','still','quick','fresh','warm','cool','crisp','soft','sharp','glad','keen','neat','smart']
const WORDS_B = ['otter','river','peak','cloud','willow','meadow','forest','harbor','valley','summit','breeze','lantern','copper','silver','golden','marble','ember','horizon','quartz','aspen']

function generateReadablePassword(): string {
  const a = WORDS_A[Math.floor(Math.random() * WORDS_A.length)]
  const b = WORDS_B[Math.floor(Math.random() * WORDS_B.length)]
  const n = Math.floor(Math.random() * 90 + 10)
  return `${a}-${b}-${n}`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }

  let payload: any
  try { payload = await req.json() } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }) }

  const { adminId, firstName, lastName, phone, role, username } = payload ?? {}
  if (!adminId || !firstName || !lastName || !role) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }
  if (role !== 'manager' && role !== 'ops_manager') {
    return new Response(JSON.stringify({ error: 'Invalid role' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }

  const identifier = role === 'ops_manager' ? username : phone
  if (!identifier || String(identifier).trim() === '') {
    return new Response(JSON.stringify({ error: role === 'ops_manager' ? 'Username required' : 'Phone required' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const { data: adminRow, error: adminErr } = await admin
    .from('admins')
    .select('id, is_active')
    .eq('id', adminId)
    .maybeSingle()
  if (adminErr || !adminRow || adminRow.is_active === false) {
    return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }

  const password = generateReadablePassword()
  const email = deriveSyntheticEmail(role, identifier)
  const phoneDigits = role === 'manager' ? normalizePhoneToDigits(String(phone)) : null

  const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      app_role: role,
      first_name: firstName,
      last_name: lastName,
      mobile_number: phoneDigits,
      username: role === 'ops_manager' ? String(username).trim().toLowerCase() : null,
    },
  })

  if (authErr || !authUser?.user) {
    return new Response(JSON.stringify({ error: authErr?.message || 'Failed to create auth user' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }

  const managerId = authUser.user.id
  const employeeId = `${role === 'ops_manager' ? 'OPS' : 'MGR'}_${Date.now()}`

  const { error: insertErr } = await admin.from('managers').insert({
    id: managerId,
    first_name: firstName,
    last_name: lastName,
    // NULL, never '': ops managers identify by username and have no phone.
    // The '' sentinel used to collide with the unique index on the second
    // such account and surfaced as "Could not create manager".
    mobile_number: phoneDigits,
    password_hash: 'managed_by_supabase_auth',
    employee_id: employeeId,
    is_active: true,
    role,
    username: role === 'ops_manager' ? String(username).trim().toLowerCase() : null,
  })

  if (insertErr) {
    // Roll back the auth user if the managers row failed
    await admin.auth.admin.deleteUser(managerId)
    return new Response(JSON.stringify({ error: insertErr.message }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }

  return new Response(
    JSON.stringify({ managerId, password, role, firstName, lastName, identifier }),
    { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
  )
})
