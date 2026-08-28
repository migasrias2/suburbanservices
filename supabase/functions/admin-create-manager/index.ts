import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

/**
 * TOMBSTONE. This endpoint is retired and must never mint an account again.
 *
 * The version this replaced authorised off a UUID supplied in the request
 * BODY and never authenticated the caller at all, so the public anon key --
 * which ships in the browser bundle -- was enough to create an ops_manager and
 * receive its plaintext password. Confirmed live against production on
 * 2026-08-26: the same probe returned 401 from admin-create-user (which checks
 * the caller's JWT) and 403 from this one, proving it had reached its own
 * `admins` lookup on the body value with no authentication.
 *
 * WHY THIS FILE STILL EXISTS INSTEAD OF BEING DELETED:
 * deleting the source does NOT undeploy the function. The old bundle keeps
 * serving until someone acts on the deployment. With the source gone there is
 * nothing left in the repo to remind anyone of that, so a deleted directory
 * looks safe while remaining fully exploitable. This stub is deployable, so it
 * can neutralise the endpoint -- but read the next paragraph before assuming
 * it already has.
 *
 * IF YOU ARE DEPLOYING THIS REPO, DO ALL THREE, IN ORDER:
 *
 *   1. supabase functions deploy                  <- ALL functions, no name
 *   2. supabase functions delete admin-create-manager
 *   3. probe the endpoint (below)
 *
 * Step 1 must be the full deploy. `supabase functions deploy admin-create-user`
 * -- the natural thing to run when you believe you changed one function -- does
 * NOT ship this stub, and the vulnerable bundle keeps serving. This tombstone
 * covers exactly one deploy style; step 2 covers the rest. It is a fail-safe,
 * never a reason to skip step 2.
 *
 * PROBE, and how to read it:
 *   404 -> deleted.            SAFE.
 *   410 -> this stub is live.  SAFE.
 *   400 or 403 -> THE OLD VULNERABLE BUNDLE IS STILL SERVING. Only that version
 *                 has a body-shape validator ("Missing required fields") and an
 *                 `admins` lookup ("Not authorized") to reach. Treat as live.
 *
 * Note for whoever probes this later: because this file stays in the repo, the
 * delete in step 2 is not permanent. The next FULL deploy recreates the
 * endpoint as this 410 stub. Seeing 410 where you once saw 404 is expected and
 * is NOT the vulnerability returning -- 400/403 is.
 *
 * Deliberately imports no Supabase client and holds no service-role key: even
 * if it is invoked, it has no capability to create anything.
 *
 * Callers moved to admin-create-user, which authenticates the caller from
 * their JWT and checks membership of `admins` server-side.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })

  return new Response(
    JSON.stringify({ error: 'This endpoint has been retired. Use admin-create-user.' }),
    { status: 410, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
  )
})
