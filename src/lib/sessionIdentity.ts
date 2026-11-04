import { supabase } from '../services/supabase'

/**
 * Thrown when a privileged call is attempted without a live Supabase session.
 *
 * Distinct from a generic Error so callers can tell "your session ended" apart
 * from "the server refused you". The two need different words: one is fixed by
 * signing in again, the other is not.
 */
export class SessionExpiredError extends Error {
  constructor(message = 'Your session has expired. Please sign in again.') {
    super(message)
    this.name = 'SessionExpiredError'
  }
}

/**
 * The caller's user id, taken from the LIVE Supabase session.
 *
 * Deliberately not localStorage. localStorage.userId outlives the session that
 * created it -- it has no expiry and nothing sweeps it -- so reading identity
 * from there means a signed-out browser keeps addressing calls by the previous
 * user's id. Sourcing it from the session makes a stale value impossible
 * rather than merely unlikely. That, and only that, is what this closes.
 *
 * The server is what authorises: since migration 20261104210000 every admin_*
 * function also requires p_admin_id = auth.uid(), so sending another admin's
 * id is refused. This function only makes sure the id we send is the live one.
 */
export async function requireSessionUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession()

  if (error) {
    console.error('Failed to read the Supabase session:', error)
    throw new SessionExpiredError('Could not verify your session. Please sign in again.')
  }

  const userId = data.session?.user?.id
  if (!userId) throw new SessionExpiredError()

  return userId
}

/**
 * The caller's user id, or null when there is no live session.
 *
 * For call sites that legitimately have a non-admin fallback path and must not
 * throw when signed out. Where a missing id should abort, use
 * requireSessionUserId instead.
 */
export async function getSessionUserId(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      console.error('Failed to read the Supabase session:', error)
      return null
    }
    return data.session?.user?.id ?? null
  } catch (error) {
    console.error('Failed to read the Supabase session:', error)
    return null
  }
}
