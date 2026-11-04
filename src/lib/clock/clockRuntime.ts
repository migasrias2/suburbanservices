import { clockIn, clockOut, getCurrentShift, type ClockResult } from '@/services/clockApi'
import type { ClockFailure } from '@/services/clockFailureService'
import { autoLinkCleanerToCustomer } from '@/services/managerService'
import { supabase } from '@/services/supabase'
import { isServerAnswer, type ClockEvent, type ClockKind } from './clockEvents'
import { refreshClockSwitches } from './clockFlags'
import { createShiftStore, type CurrentShiftView } from './currentShift'
import { createDroppedScans, type DroppedScan } from './droppedScans'
import { createFailureQueue } from './failureQueue'
import { formatLondonDateTime } from './clockMessages'
import type { Coordinates } from './location'
import { createClockOutbox, type FailReason, type SendOutcome } from './outbox'
import { createLocalOutboxStorage } from './outboxStorage'
import { readSessionState } from './session'

/**
 * The app's single clock outbox, current-shift store and failure queue, wired
 * together. Screens call submitClockScan / getClockView; <ClockRuntime/>
 * starts the background sending once, for the whole app, whatever the
 * clock_v2 switch says, so turning the switch off never strands a saved scan.
 */

// Looked up on every call, never captured, so a replaced localStorage (tests,
// a blocked storage) is always the one used.
const localStore = () => (typeof localStorage === 'undefined' ? undefined : localStorage)
const lazyStorage = {
  getItem: (key: string) => localStore()?.getItem(key) ?? null,
  setItem: (key: string, value: string) => localStore()?.setItem(key, value),
  removeItem: (key: string) => localStore()?.removeItem(key),
}

const AUTO_FLUSH_MS = 20_000

const sendClockEvent = (event: ClockEvent, waitMs: number): Promise<ClockResult> => {
  const params = {
    eventId: event.eventId,
    qrPayload: event.qrPayload,
    scannedAt: new Date(event.scannedAtMs),
    waitMs,
    location: event.location,
    // The phone clock at send time, so the server can spot a phone whose clock
    // was changed between the scan and the send (review M6).
    device: { ...event.device, sent_at_ms: Date.now() },
  }
  return event.kind === 'clock_in' ? clockIn(params) : clockOut(params)
}

// The server writes the shift, cleaner_logs and live_tracking rows. The one
// thing it doesn't do is link the cleaner to the customer's managers, which
// the old clock-in did too; idempotent, so a replay doing it again is harmless.
const linkCustomer = (event: ClockEvent, result: ClockResult) => {
  if (event.kind !== 'clock_in' || !result.ok || !('shift' in result) || result.code !== 'clocked_in') return
  autoLinkCleanerToCustomer(result.shift.customerName, event.userId).catch((error: unknown) =>
    console.warn('Could not link the cleaner to the customer', error),
  )
}

const onSettled = (event: ClockEvent, result: ClockResult) => {
  if (isServerAnswer(result)) shiftStore.applyResult(event.userId, event.kind, result)
  else void shiftStore.refresh(event.userId)
  linkCustomer(event, result)
}

export const failureQueue = createFailureQueue({
  storage: localStore,
  insert: async (row) => supabase.from('clock_event_failures').insert(row),
  readSession: readSessionState,
})

const droppedScans = createDroppedScans(localStore)

const FAIL_WORDS: Record<FailReason, string> = {
  error: 'could not be saved (database error)',
  stale: 'too old to send',
  gave_up: 'gave up after too many tries',
}

// A scan taken out of the line without being saved: reported (under its owner)
// and remembered, so the owner is told the next time they open the app.
const onFailed = (event: ClockEvent, info: { reason: FailReason; code: string | undefined }) => {
  const when = formatLondonDateTime(event.scannedAtMs)
  const reason = `Scan from ${when} ${FAIL_WORDS[info.reason]}${info.code ? ` [${info.code}]` : ''}`
  void failureQueue
    .report({ eventType: event.kind, reason, cleanerName: null, qrCodeId: event.qrPayload.slice(0, 120) }, event.userId)
    .catch(() => undefined)
  droppedScans.add({ userId: event.userId, eventId: event.eventId, kind: event.kind, scannedAtMs: event.scannedAtMs, reason: info.reason, code: info.code })
  shiftStore.notify()
}

export const clockOutbox = createClockOutbox({
  storage: createLocalOutboxStorage(localStore),
  send: sendClockEvent,
  readSession: readSessionState,
  onSettled,
  onFailed,
})

export const shiftStore = createShiftStore({
  fetchCurrentShift: getCurrentShift,
  pending: (userId) => clockOutbox.pending(userId),
  storage: lazyStorage,
})

clockOutbox.subscribe(() => shiftStore.notify())

export type ClockView = CurrentShiftView & { droppedScans: DroppedScan[] }

/** The current-shift view, including "a saved scan needs you to sign in again". */
export function getClockView(userId: string): ClockView {
  const view = shiftStore.getView(userId)
  const needsSignIn = view.needsSignIn || (view.pendingCount > 0 && clockOutbox.needsSignIn())
  return { ...view, needsSignIn, droppedScans: userId ? droppedScans.list(userId) : [] }
}

/** The cleaner has seen these (all of theirs, or one the screen already explained). */
export function dismissDroppedScans(userId: string, eventId?: string): void {
  droppedScans.dismiss(userId, eventId)
  shiftStore.notify()
}

const newEventId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })

export interface ClockScanInput {
  kind: ClockKind
  userId: string
  qrPayload: string
  /** Date.now() when the code was read. */
  scannedAtMs: number
  location: Coordinates | null
  device: Record<string, unknown>
}

/** Save a clock scan on the phone and send it. Resolves within ~5 s (login check) + 12 s (request) per scan in line. */
export function submitClockScan(input: ClockScanInput): Promise<SendOutcome> {
  return clockOutbox.submit({
    eventId: newEventId(),
    userId: input.userId,
    kind: input.kind,
    qrPayload: input.qrPayload,
    scannedAtMs: input.scannedAtMs,
    location: input.location,
    device: input.device,
    attempts: 0,
    nextAttemptAtMs: 0,
  })
}

/** A clock failure report on the new path: kept on the phone while signed out (D7c), sent only as its creator. */
export const queueClockFailureReport = (failure: ClockFailure): Promise<void> =>
  failureQueue.report(failure, localStore()?.getItem('userId') || null)

/**
 * The area-scan gate: may this person scan area codes now? It asks the server
 * for the open shift (any day, so night shifts work after midnight). It only
 * says no when the server has just answered "not clocked in" and nothing is
 * waiting to send; with no answer it lets the scan through, as before.
 */
export const AREA_CHECK_TIMEOUT_MS = 6_000

export async function isOnShiftForAreaScan(userId: string): Promise<boolean> {
  if (!userId) return true
  // current_shift() can hang on weak signal; no answer in time = let it through (review M1).
  const view = await Promise.race([
    shiftStore.refresh(userId),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), AREA_CHECK_TIMEOUT_MS)),
  ])
  if (!view) return true
  if (view.status === 'on_shift') return true
  return !(view.status === 'off_shift' && !view.offline && !view.needsSignIn)
}

const flushAll = (force: boolean) => {
  void clockOutbox.flush({ force })
  void failureQueue.flush().catch(() => undefined)
}

/** Background sending: now, on `online`, on return to the app, after sign-in, and every 20 s while scans wait. */
export function startClockRuntime(): () => void {
  const onOnline = () => flushAll(true)
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return
    flushAll(true)
    void refreshClockSwitches()
  }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  // supabase-js warns against awaiting its own calls inside this callback, so defer.
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event !== 'SIGNED_IN' && event !== 'TOKEN_REFRESHED') return
    setTimeout(() => {
      flushAll(true)
      // The switches read on the login screen came back as anon (refused), so
      // read them again as this person (review M4).
      if (event === 'SIGNED_IN') void refreshClockSwitches()
    }, 0)
  })
  const timer = setInterval(() => {
    if (clockOutbox.pending().length) void clockOutbox.flush()
  }, AUTO_FLUSH_MS)
  void refreshClockSwitches()
  flushAll(true)
  return () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
    data?.subscription?.unsubscribe()
    clearInterval(timer)
  }
}

/** Tests only: forget all clock state held in memory. */
export function resetClockRuntimeForTests(): void {
  shiftStore.reset()
}
