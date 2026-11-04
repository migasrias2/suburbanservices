import { supabase } from '@/services/supabase'
import type { SessionState } from './outbox'

const isRetryable = (error: unknown): boolean => {
  const e = error as { name?: string; status?: number } | null
  if (!e) return false
  return e.name === 'AuthRetryableFetchError' || e.status === 0 || (typeof e.status === 'number' && e.status >= 500)
}

/**
 * Is anyone signed in, and who? Read before every clock send, so a scan is
 * never sent with the anon key.
 *
 * "Can't tell" is kept apart from "signed out": with no signal, an expired
 * token can't be refreshed, and that must read as "no signal" (keep sending
 * later), not as "your login has expired". A check that doesn't answer
 * within SESSION_TIMEOUT_MS is "can't tell" too.
 */
/** getSession() waits on the auth lock and may refresh the token with no time limit (review M1). */
export const SESSION_TIMEOUT_MS = 5_000

const UNREACHABLE: SessionState = { status: 'unreachable' }

const getSessionWithin = (ms: number) =>
  Promise.race([
    supabase.auth.getSession(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])

export async function readSessionState(): Promise<SessionState> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return UNREACHABLE
  try {
    const answer = await getSessionWithin(SESSION_TIMEOUT_MS)
    if (!answer) return UNREACHABLE
    const { data, error } = answer
    const userId = data?.session?.user?.id
    if (userId) return { status: 'signed_in', userId }
    if (error && isRetryable(error)) return { status: 'unreachable' }
    return { status: 'signed_out' }
  } catch (error) {
    console.warn('Could not read the login on this phone', error)
    return { status: 'unreachable' }
  }
}
