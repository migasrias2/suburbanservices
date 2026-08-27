import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Role = 'cleaner' | 'manager' | 'ops_manager' | 'admin'

const ROLE_TABLE: Record<Role, string> = {
  cleaner: 'cleaners',
  manager: 'managers',
  ops_manager: 'managers',
  admin: 'admins',
}

/** Supabase Auth's own floor is 6; 8 is the product minimum for staff. */
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 72 // bcrypt truncates beyond 72 bytes

// Duplicated from admin-create-user on purpose: each edge function deploys as
// its own bundle, so the two cannot import a shared module without a
// cross-function path that does not survive deployment. Keep the two lists in
// step if either changes.
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  // Authorization comes from the caller's own JWT, never from the request
  // body. A body-supplied adminId is just a UUID the caller typed, and this
  // endpoint can rewrite any staff credential.
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
  if (adminErr || !adminRow || adminRow.is_active === false) {
    return jsonResponse({ error: 'Not authorized' }, 403)
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const userId = typeof payload?.userId === 'string' ? payload.userId.trim() : ''
  const role = payload?.role as Role
  const requested = typeof payload?.password === 'string' ? payload.password : ''

  if (!userId) return jsonResponse({ error: 'userId is required' }, 400)
  if (!role || !(role in ROLE_TABLE)) return jsonResponse({ error: 'Invalid role' }, 400)

  // An admin-chosen password is used verbatim; an empty one means "generate".
  const password = requested.trim() === '' ? generateReadablePassword() : requested
  if (password.length < MIN_PASSWORD_LENGTH) {
    return jsonResponse({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400)
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_LENGTH) {
    return jsonResponse({ error: `Password must be at most ${MAX_PASSWORD_LENGTH} bytes` }, 400)
  }

  // The target must be real staff. Without this, any auth.users row --
  // including one that no longer has an app profile -- could be taken over.
  const { data: targetRow, error: targetErr } = await admin
    .from(ROLE_TABLE[role])
    .select('id')
    .eq('id', userId)
    .maybeSingle()
  if (targetErr || !targetRow) return jsonResponse({ error: 'User not found' }, 404)

  const { error: updateErr } = await admin.auth.admin.updateUserById(userId, { password })
  if (updateErr) return jsonResponse({ error: updateErr.message || 'Failed to set password' }, 400)

  const updatedAt = new Date().toISOString()
  const { error: recordErr } = await admin
    .from('user_passwords')
    .upsert(
      { user_id: userId, role, password, updated_at: updatedAt, updated_by: callerId },
      { onConflict: 'user_id' },
    )

  // The password is already live at this point, so a failed recording is not
  // an error the caller can retry away -- it only means the profile will not
  // display it. Report it so the UI can insist the admin copies it now.
  return jsonResponse({
    userId,
    role,
    password,
    updatedAt,
    recorded: !recordErr,
  })
})
