import { createClient } from 'jsr:@supabase/supabase-js@2'

/**
 * Caller authorization for the admin edge functions.
 *
 * Extracted for the same reason as _shared/phone.ts: admin-create-user and
 * admin-set-password carried byte-identical copies of this check. A correction
 * applied to one and not the other is worse than none at all, because the two
 * endpoints then disagree about who may call them while looking like they agree.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHANGE: membership. The gate admits exactly
 * the callers it admitted before -- an active row in public.admins, keyed by the
 * caller's own auth.uid(), never by anything in the request body -- and still
 * fails closed on every other outcome. Only the REPORTING changed. Whether some
 * other role should be allowed to create accounts is a live product question and
 * must not be smuggled in here; widening the gate means editing isAllowed below,
 * on purpose, in its own change.
 */

type AdminClient = ReturnType<typeof createClient>

export type GateDenial = {
  status: number
  error: string
}

export type GateResult =
  | { ok: true; callerId: string }
  | { ok: false; denial: GateDenial }

/**
 * Why a lookup that FAILED must not be reported as a lookup that came back empty.
 *
 * `if (err || !row) return 403` reads as one condition and is two. An unreachable
 * database becomes "Not authorized", which tells an admin they have lost a
 * permission they still hold, and sends them to fix an access problem that does
 * not exist. This is the same defect ab141b2 fixed in ClockInPage, where a failed
 * attendance read was counted as "not clocked in".
 *
 * Fail closed either way -- neither branch continues -- but say which happened.
 */
const LOOKUP_FAILED: GateDenial = {
  status: 503,
  error: 'Could not verify your permissions just now. Please try again in a moment.',
}

const NOT_AUTHENTICATED: GateDenial = {
  status: 401,
  error: 'Not authenticated',
}

/**
 * A genuine permission decision: this caller is not an active admin.
 *
 * Deliberately UNCHANGED wording, and deliberately identical for "no admin row"
 * and "deactivated admin row". A refusal is not a licence to enumerate, so it
 * reveals nothing about the admins table, and ab141b2 pinned this exact string.
 * What makes the failure diagnosable is not this message being more talkative --
 * it is that a broken lookup no longer arrives here at all.
 */
const NOT_AUTHORIZED: GateDenial = {
  status: 403,
  error: 'Not authorized',
}

/** The bearer token on the request, or '' when there is none. */
export function bearerToken(req: Request): string {
  return (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
}

/**
 * True when getUser failed to REACH the auth service, rather than reaching it
 * and being told the token is no good.
 *
 * Matched on shape, not with isAuthRetryableFetchError: that helper would have
 * to be imported from the jsr module, and the parity harness that executes this
 * source strips non-relative imports, so it would be undefined under test and
 * throw on the very path this exists to handle.
 *
 * supabase-js wraps a failed fetch as AuthRetryableFetchError (auth-js
 * errors.js:89-96); a GoTrue 5xx arrives as an AuthApiError carrying that
 * status. Everything else -- 400/401/403 -- is a real verdict about the token.
 * Deliberately conservative: an unrecognised error stays "not authenticated",
 * which is the safe direction, because both outcomes refuse the request.
 */
function isUnreachableAuthService(error: unknown): boolean {
  const err = error as { name?: string; status?: number }
  if (err?.name === 'AuthRetryableFetchError') return true
  return typeof err?.status === 'number' && err.status >= 500
}

/**
 * Resolves the caller from their own JWT and confirms they are an active admin.
 *
 * Returns the caller's id on success so callers do not re-read it, and a single
 * ready-to-send denial otherwise. Every outcome is distinguishable by the
 * operator reading it, which is the entire point: "Not authorized" for all four
 * of authentication failure, absent record, deactivation and infrastructure
 * fault is what makes a misconfiguration undiagnosable from the outside.
 */
export async function authorizeAdminCaller(
  admin: AdminClient,
  req: Request,
): Promise<GateResult> {
  const token = bearerToken(req)
  if (!token) return { ok: false, denial: NOT_AUTHENTICATED }

  const { data: callerData, error: callerErr } = await admin.auth.getUser(token)

  // "We could not reach GoTrue" is not "your token is bad", and the difference
  // is not cosmetic: the browser turns a 401 into "Your session has expired.
  // Please sign in again." (customerOnboardingService.ts:27-29). A validly
  // signed-in admin would be told to do the one thing that cannot help, on
  // repeat, until they concluded their account was broken.
  if (callerErr && isUnreachableAuthService(callerErr)) {
    console.error('Could not reach the auth service while identifying the caller:', callerErr)
    return { ok: false, denial: LOOKUP_FAILED }
  }

  const callerId = callerData?.user?.id
  if (callerErr || !callerId) return { ok: false, denial: NOT_AUTHENTICATED }

  const { data: adminRow, error: adminErr } = await admin
    .from('admins')
    .select('id, is_active')
    .eq('id', callerId)
    .maybeSingle()

  if (adminErr) {
    console.error('admins lookup failed while authorizing caller', callerId, adminErr)
    return { ok: false, denial: LOOKUP_FAILED }
  }

  if (!adminRow || adminRow.is_active === false) return { ok: false, denial: NOT_AUTHORIZED }

  return { ok: true, callerId }
}

/**
 * The same separation for any other "does this row exist" gate.
 *
 * A failed read is not an absent row. Reporting one as the other sends an
 * operator hunting for a record that is sitting in front of them.
 */
export function missingRowDenial(notFoundMessage: string): GateDenial {
  return { status: 404, error: notFoundMessage }
}

export const lookupFailedDenial = (): GateDenial => ({ ...LOOKUP_FAILED })
