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
 * THIS IS NOT AN AUTHORISATION CONTROL. p_admin_id is an ARGUMENT to the
 * admin_* SECURITY DEFINER functions, and not one of them compares it to
 * auth.uid(); all are executable by `authenticated`, and at least one
 * (admin_rename_customer) is executable by anon. The server therefore accepts
 * whatever id the caller chooses to send, and sending a fresher one does not
 * change that. The real fix is server-side and is still outstanding -- never
 * read this function as evidence that a privileged RPC is guarded.
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
