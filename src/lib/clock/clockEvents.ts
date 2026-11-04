import type { ClockResult } from '@/services/clockApi'

/**
 * One clock scan as it waits on the phone (P3 outbox).
 *
 * The event id is made once, at the scan, and every retry sends the same one:
 * the server stores the first answer under it and replays it, so a retry after
 * a lost response can never make a second shift.
 */
export type ClockKind = 'clock_in' | 'clock_out'

export interface ClockEvent {
  eventId: string
  /** Whose scan this is. Only sent while this same person is signed in. */
  userId: string
  kind: ClockKind
  /** The raw text the camera read. The server parses and checks it. */
  qrPayload: string
  /** Date.now() at the scan. Only compared with Date.now() on this phone. */
  scannedAtMs: number
  location: { latitude: number; longitude: number } | null
  device: Record<string, unknown>
  attempts: number
  /** Earliest time an automatic retry may send it again. */
  nextAttemptAtMs: number
  /** Place in line, from a stored counter (not the phone clock, which can jump). Set by the outbox. */
  seq?: number
}

/** What to do with a scan after one send. */
export type SendVerdict = 'done' | 'retry' | 'throttled' | 'sign_in' | 'failed'

// Errors that mean "this request had no valid login", never "you're not clocked in":
// PostgREST JWT errors, HTTP 401, and 42501 (the anon role can't run clock_in,
// which is what happens when supabase-js falls back to the anon key).
const AUTH_ERROR_CODES = new Set(['PGRST301', 'PGRST302', 'PGRST303', '401', '42501'])

// Only a real database answer can be permanent: a five-character SQLSTATE or a
// PGRST code. Anything else (no code, 'timeout', AbortError "20", ECONNRESET,
// a gateway's 429 or 5xx) is the transport failing and says nothing about the
// scan, so it is retried; the age and attempt limits still stop it eventually.
const DATABASE_CODE = /^([0-9A-Z]{5}|PGRST\d{3})$/
// Database states that pass on their own: SQLSTATE classes 08 connection,
// 40 serialization/deadlock, 53 resources, 57 cancelled/shutdown, 58 system;
// 25006 read-only (disk-full incident), 55P03/55006 lock or object busy,
// 42883/PGRST202 function briefly missing while a migration replaces it;
// PostgREST 000-003 (can't reach the database).
const TRANSIENT_SQLSTATE = /^(08|40|53|57|58)/
const TRANSIENT_CODES = new Set(['25006', '55P03', '55006', '42883', 'PGRST202'])
const isTransient = (code: string | undefined): boolean =>
  !code ||
  !DATABASE_CODE.test(code) ||
  TRANSIENT_SQLSTATE.test(code) ||
  TRANSIENT_CODES.has(code) ||
  /^PGRST00[0-3]$/.test(code)

/** The error code of a transport failure, if any. */
export const failureCode = (result: ClockResult): string | undefined =>
  !result.ok && 'cause' in result ? result.cause?.code || undefined : undefined

const isAuthFailure = (result: ClockResult): boolean => {
  if (result.ok) return false
  if (result.code === 'not_signed_in') return true
  if (result.code !== 'network') return false
  const cause = 'cause' in result ? result.cause : undefined
  if (cause?.code && AUTH_ERROR_CODES.has(cause.code)) return true
  return /jwt/i.test(cause?.message ?? '')
}

/**
 * Only a lost connection, a lost login or the server's throttle keeps a scan on
 * the phone. Every answer from the server is final (it has been logged in
 * clock_events), and so is a local refusal or an answer this app version can't
 * read. A database error that isn't transient is 'failed': it will never go
 * through, so it must leave the line rather than block the person's later scans.
 */
export function classifyClockResult(result: ClockResult): SendVerdict {
  if (isAuthFailure(result)) return 'sign_in'
  // The server's per-person throttle wrote nothing, so the scan isn't saved yet.
  if (!result.ok && result.code === 'rate_limited') return 'throttled'
  if (!result.ok && result.code === 'network') return isTransient(failureCode(result)) ? 'retry' : 'failed'
  return 'done'
}

const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000]

/** After a throttled send, wait at least this long (the server's window is 10 min). */
export const THROTTLE_BACKOFF_MS = 60_000

/** Wait before the next automatic retry, after `attempts` failed sends. */
export const backoffMs = (attempts: number): number =>
  BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1]

/** How long a scan may wait on the phone (phone clock) before it is too old to send (review H2). */
export const MAX_SCAN_AGE_MS: Record<ClockKind, number> = {
  clock_in: 16 * 3_600_000,
  clock_out: 24 * 3_600_000,
}

/** A server answer (as opposed to a transport failure or a local refusal). */
export const isServerAnswer = (result: ClockResult): result is Extract<ClockResult, { serverNow: string }> =>
  'serverNow' in result
