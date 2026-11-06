import type { ClockResult } from '@/services/clockApi'
import {
  backoffMs,
  classifyClockResult,
  failureCode,
  MAX_SCAN_AGE_MS,
  THROTTLE_BACKOFF_MS,
  type ClockEvent,
} from './clockEvents'
import type { OutboxStorage } from './outboxStorage'
import { holdAppReload } from '@/lib/appReloadGuard'

/**
 * The clock outbox: every scan is saved on the phone first, then sent until the
 * server gives a definitive answer.
 *
 * - Same event id on every retry; the server is idempotent and replays.
 * - wait_ms is measured on this phone (Date.now() now minus Date.now() at the
 *   scan), so a phone whose clock is wrong still reports the right wait.
 * - Sent in line per person (a stored sequence number, not the phone clock), and
 *   a scan never overtakes an earlier one that is still waiting, so a clock-out
 *   can't arrive before its clock-in.
 * - With no login, nothing is sent (supabase-js would quietly use the anon
 *   key); the scan waits and the cleaner is asked to sign in again.
 * - Nothing can block the line for ever: a scan that can never be saved (a
 *   permanent database error), that waited too long on the phone (16 h for a
 *   clock-in, 24 h for a clock-out) or that failed too many times is taken out
 *   and handed to onFailed, which reports it and tells the cleaner.
 */
export type SessionState =
  | { status: 'signed_in'; userId: string }
  | { status: 'signed_out' }
  /** Couldn't tell (offline while the token needed a refresh): treat as no signal. */
  | { status: 'unreachable' }

export type FailReason = 'error' | 'stale' | 'gave_up'

export type SendOutcome =
  | { status: 'answered'; event: ClockEvent; result: ClockResult }
  | { status: 'queued'; event: ClockEvent; reason: 'network' | 'waiting' | 'other_user' | 'rate_limited' }
  | { status: 'needs_sign_in'; event: ClockEvent }
  /** Taken out of the line without being saved. */
  | { status: 'failed'; event: ClockEvent; reason: FailReason; code?: string }

export interface OutboxDeps {
  storage: OutboxStorage
  send: (event: ClockEvent, waitMs: number) => Promise<ClockResult>
  readSession: () => Promise<SessionState>
  now?: () => number
  /** A request with no answer after this long counts as "no signal" (it may still land; the retry replays). */
  timeoutMs?: number
  /** A login check with no answer after this long counts as "no signal" (review M1). */
  sessionTimeoutMs?: number
  /** Called once per scan, with the answer that removed it from the phone. */
  onSettled?: (event: ClockEvent, result: ClockResult) => void
  /** Called once per scan taken out of the line without being saved. */
  onFailed?: (event: ClockEvent, info: { reason: FailReason; code: string | undefined }) => void
}

export interface ClockOutbox {
  /** Save the scan, then send it (after any earlier scans). */
  submit(event: ClockEvent): Promise<SendOutcome>
  /** Send what is waiting. Without `force`, scans still in their backoff wait. */
  flush(options?: { force?: boolean }): Promise<void>
  pending(userId?: string): ClockEvent[]
  needsSignIn(): boolean
  subscribe(listener: () => void): () => void
}

/**
 * Backstop for transient failures that never clear. High on purpose: with the
 * 60 s cap on backoff it is well past the 16/24 h age limit, so a phone that
 * is merely out of signal all day is handled by the age rule, not this one.
 */
export const MAX_SEND_ATTEMPTS = 1500

const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_SESSION_TIMEOUT_MS = 5_000

const timedOut = (): ClockResult => ({
  ok: false,
  code: 'network',
  message: 'No answer from the server yet.',
  cause: { code: 'timeout', message: 'timeout' },
})

function withTimeout(promise: Promise<ClockResult>, ms: number): Promise<ClockResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(timedOut()), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        resolve({ ok: false, code: 'network', message: String(error), cause: { message: String(error) } })
      },
    )
  })
}

/** In line by sequence number; scans saved before sequence numbers existed go by scan time. */
const inLine = (a: ClockEvent, b: ClockEvent) => (a.seq ?? 0) - (b.seq ?? 0) || a.scannedAtMs - b.scannedAtMs

export function createClockOutbox(deps: OutboxDeps): ClockOutbox {
  const now = deps.now ?? (() => Date.now())
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const sessionTimeoutMs = deps.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS
  const listeners = new Set<() => void>()
  let signInNeeded = false
  // One flush at a time, so two triggers never send the same scan side by side.
  let chain: Promise<unknown> = Promise.resolve()

  const notify = () => listeners.forEach((listener) => listener())

  const setSignInNeeded = (value: boolean) => {
    if (signInNeeded === value) return
    signInNeeded = value
    notify()
  }

  // getSession() can wait on the auth lock or a refresh with no time limit.
  const readSession = (): Promise<SessionState> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ status: 'unreachable' }), sessionTimeoutMs)
      deps.readSession().then(
        (state) => {
          clearTimeout(timer)
          resolve(state)
        },
        () => {
          clearTimeout(timer)
          resolve({ status: 'unreachable' })
        },
      )
    })

  const isStored = (eventId: string) => deps.storage.read().some((e) => e.eventId === eventId)

  const remove = (eventId: string) => {
    deps.storage.write(deps.storage.read().filter((e) => e.eventId !== eventId))
    notify()
  }

  // Only rewrites a scan that is still there: if another tab finished it
  // meanwhile, writing our stale copy back would send it again (review L2).
  const update = (next: ClockEvent) => {
    const events = deps.storage.read()
    if (!events.some((e) => e.eventId === next.eventId)) return
    deps.storage.write(events.map((e) => (e.eventId === next.eventId ? next : e)))
    notify()
  }

  const afterFailedSend = (event: ClockEvent, minWaitMs = 0): ClockEvent => {
    const attempts = event.attempts + 1
    return { ...event, attempts, nextAttemptAtMs: now() + Math.max(backoffMs(attempts), minWaitMs) }
  }

  const fail = (event: ClockEvent, reason: FailReason, code?: string): SendOutcome => {
    const wasStored = isStored(event.eventId)
    remove(event.eventId)
    if (wasStored) deps.onFailed?.(event, { reason, code })
    return { status: 'failed', event, reason, code }
  }

  // Phone clock on purpose: the windows match the server's, and a scan
  // "from the future" (the clock went back) is simply not old.
  const tooOld = (event: ClockEvent) => now() - event.scannedAtMs > MAX_SCAN_AGE_MS[event.kind]

  const sendOne = async (event: ClockEvent): Promise<SendOutcome> => {
    const result = await withTimeout(deps.send(event, Math.max(0, now() - event.scannedAtMs)), timeoutMs)
    const verdict = classifyClockResult(result)
    if (verdict === 'done') {
      const wasStored = isStored(event.eventId)
      remove(event.eventId)
      setSignInNeeded(false)
      // Another tab may have settled it already; one onSettled is enough.
      if (wasStored) deps.onSettled?.(event, result)
      return { status: 'answered', event, result }
    }
    if (verdict === 'failed') return fail(event, 'error', failureCode(result))
    update(afterFailedSend(event, verdict === 'throttled' ? THROTTLE_BACKOFF_MS : 0))
    if (verdict === 'throttled') return { status: 'queued', event, reason: 'rate_limited' }
    if (verdict === 'sign_in') {
      setSignInNeeded(true)
      return { status: 'needs_sign_in', event }
    }
    return { status: 'queued', event, reason: 'network' }
  }

  // Sends this person's scans in line and stops at the first one that doesn't
  // get a final answer, so later scans keep their place. The login is checked
  // again before each send: if someone else signed in meanwhile, stop (L3).
  const sendInOrder = async (userId: string, force: boolean, outcomes: Map<string, SendOutcome>) => {
    let blocked = false
    for (const event of deps.storage.read().filter((e) => e.userId === userId).sort(inLine)) {
      if (blocked || (!force && event.nextAttemptAtMs > now())) {
        blocked = true
        outcomes.set(event.eventId, { status: 'queued', event, reason: 'waiting' })
        continue
      }
      if (event.attempts >= MAX_SEND_ATTEMPTS) {
        outcomes.set(event.eventId, fail(event, 'gave_up'))
        continue
      }
      const session = await readSession()
      if (session.status !== 'signed_in' || session.userId !== userId) {
        blocked = true
        outcomes.set(event.eventId, { status: 'queued', event, reason: 'waiting' })
        continue
      }
      const outcome = await sendOne(event)
      outcomes.set(event.eventId, outcome)
      blocked = outcome.status !== 'answered' && outcome.status !== 'failed'
    }
  }

  // Scans that couldn't even be tried (no login, no signal) now count as waiting.
  const markTried = () => {
    const events = deps.storage.read()
    if (!events.some((e) => e.attempts === 0)) return
    deps.storage.write(events.map((e) => (e.attempts === 0 ? afterFailedSend(e) : e)))
    notify()
  }

  // Too old to send, for anyone: out of the line, reported under its owner.
  const dropStale = (outcomes: Map<string, SendOutcome>) => {
    for (const event of deps.storage.read().filter(tooOld)) outcomes.set(event.eventId, fail(event, 'stale'))
  }

  const runFlush = async (force: boolean): Promise<Map<string, SendOutcome>> => {
    const outcomes = new Map<string, SendOutcome>()
    dropStale(outcomes)
    if (deps.storage.read().length === 0) {
      // Nothing waiting, so nothing needs a sign-in to be sent.
      setSignInNeeded(false)
      return outcomes
    }
    const session = await readSession()
    for (const event of deps.storage.read()) {
      if (session.status === 'signed_out') outcomes.set(event.eventId, { status: 'needs_sign_in', event })
      else if (session.status === 'unreachable') outcomes.set(event.eventId, { status: 'queued', event, reason: 'network' })
      else if (event.userId !== session.userId) outcomes.set(event.eventId, { status: 'queued', event, reason: 'other_user' })
    }
    if (session.status === 'signed_out') setSignInNeeded(true)
    if (session.status !== 'signed_in') {
      markTried()
      return outcomes
    }
    await sendInOrder(session.userId, force, outcomes)
    return outcomes
  }

  const enqueueFlush = (force: boolean): Promise<Map<string, SendOutcome>> => {
    const releaseReload = holdAppReload()
    const run = chain.then(() => runFlush(force)).finally(releaseReload)
    chain = run.catch((error: unknown) => console.warn('Clock outbox flush failed', error))
    return run
  }

  return {
    submit: async (event) => {
      const queued = { ...event, seq: deps.storage.nextSeq() }
      deps.storage.write([...deps.storage.read().filter((e) => e.eventId !== event.eventId), queued])
      notify()
      const outcomes = await enqueueFlush(true).catch(() => new Map<string, SendOutcome>())
      return outcomes.get(event.eventId) ?? { status: 'queued', event: queued, reason: 'network' }
    },
    flush: async (options) => {
      await enqueueFlush(Boolean(options?.force)).catch(() => undefined)
    },
    pending: (userId) => {
      const events = deps.storage.read().sort(inLine)
      return userId ? events.filter((e) => e.userId === userId) : events
    },
    needsSignIn: () => signInNeeded,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
