import type { ClockServerResult, ClockShift } from '@/services/clockApi'
import type { ClockKind } from './clockEvents'
import type { FailReason, SendOutcome } from './outbox'

/**
 * Plain-English messages for every clock outcome. Each notice says what
 * happened and, when there is something to do, offers one action. A
 * transport problem is never worded as "you're not clocked in".
 */
export type NoticeTone = 'success' | 'info' | 'warning' | 'error'
export type NoticeAction = 'sign_in' | 'clock_out' | 'scan_clock_in' | null

export interface ClockNotice {
  tone: NoticeTone
  title: string
  body?: string
  /** Gentle extra lines, e.g. "your manager will check these hours". */
  notes: string[]
  action: NoticeAction
}

type PosterKind = 'CLOCK_IN' | 'CLOCK_OUT' | 'AREA' | 'TASK' | 'FEEDBACK' | string | null | undefined

const londonTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })

const londonDateTime = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/London',
})

/** "Sun 1 Nov, 17:30" on the London clock. */
export const formatLondonDateTime = (ms: number): string => {
  const date = new Date(ms)
  return Number.isNaN(date.getTime()) ? '' : londonDateTime.format(date)
}

/** HH:MM on the London clock (payroll time), whatever the phone's own clock says. */
export const formatLondonTime = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : londonTime.format(date)
}

const notice = (tone: NoticeTone, title: string, body?: string, action: NoticeAction = null): ClockNotice => ({
  tone,
  title,
  body,
  notes: [],
  action,
})

const siteOf = (shift: ClockShift | null) => shift?.siteName || shift?.customerName || 'your site'

const FLAG_NOTES: Record<string, string> = {
  queued_over_2min: 'It was saved with the time you scanned, which was a while ago, so your manager will check it.',
  // A clock-in that waited over an hour starts at most 60 min before it arrived (P2 H1).
  queued_clock_in_capped: 'Your clock-in was sent late, so a manager will confirm your start time.',
  phone_clock_skew: "Your phone's clock looks wrong — the time was sent for a manager to check.",
  other_site_qr: "That was another site's code. It's saved, and your manager will check it.",
  over_max_shift: 'This shift is over 16 hours long, so your manager will check it.',
}

// The capped note already says the scan was late; don't say it twice.
const flagNotes = (flags: string[]): string[] =>
  flags
    .filter((flag) => !(flag === 'queued_over_2min' && flags.includes('queued_clock_in_capped')))
    .map((flag) => FLAG_NOTES[flag])
    .filter((line): line is string => Boolean(line))

/** A code for the wrong job, scanned on a clock screen. */
export function describeWrongPoster(expected: ClockKind, scanned: PosterKind): ClockNotice {
  const want = expected === 'clock_in' ? 'Clock In' : 'Clock Out'
  const job = expected === 'clock_in' ? 'To start your shift' : 'To finish your shift'
  if (scanned === 'CLOCK_OUT') return notice('error', "That's the Clock Out code", `${job}, scan the ${want} code.`)
  if (scanned === 'CLOCK_IN') return notice('error', "That's the Clock In code", `${job}, scan the ${want} code.`)
  if (scanned === 'AREA' || scanned === 'TASK') {
    return notice('error', "That's an area code", `${job}, scan the ${want} code first.`)
  }
  return notice('error', "That isn't a clock code", `${job}, scan the ${want} code.`)
}

const ACCOUNT_BLOCKED = notice('error', "Your account can't clock in", 'Contact your manager.')

const describeSuccess = (result: ClockServerResult): ClockNotice => {
  const shift = result.shift
  switch (result.code) {
    case 'clocked_in':
      return notice('success', `Clocked in at ${formatLondonTime(shift?.clockIn)}`, `At ${siteOf(shift)}.`)
    case 'already_clocked_in':
      // A shift left open at another site: carrying on would put this site's
      // hours on it (review M3). Clock out there first.
      if (result.flags.includes('open_shift_other_site')) {
        return notice(
          'warning',
          `You're still clocked in at ${siteOf(shift)}`,
          `Since ${formatLondonTime(shift?.clockIn)}. Clock out there first, then scan here.`,
          'clock_out',
        )
      }
      return notice(
        'info',
        "You're already clocked in",
        `At ${siteOf(shift)} since ${formatLondonTime(shift?.clockIn)}. Carry on, or clock out when you finish.`,
        'clock_out',
      )
    case 'clocked_out':
      return notice('success', `Clocked out at ${formatLondonTime(shift?.clockOut)}`, `At ${siteOf(shift)}.`)
    case 'already_clocked_out':
      return notice('success', "You're already clocked out", `Your clock-out at ${formatLondonTime(shift?.clockOut)} is saved.`)
    case 'late_clock_out':
      return notice(
        'success',
        `Clock-out recorded at ${formatLondonTime(shift?.clockOut)}`,
        'Your shift had been closed automatically, so your manager will confirm the hours.',
      )
    default:
      return notice('success', 'Saved')
  }
}

const describeRefusal = (kind: ClockKind, result: ClockServerResult): ClockNotice => {
  switch (result.code) {
    case 'no_open_shift':
      // Also what a clock-out that waited on the phone for over a day gets back.
      return notice(
        'error',
        "You're not clocked in",
        "There's no open shift to clock out of. If you finished a shift and this scan was saved on your phone for a long time, tell your manager. To start a shift, scan the Clock In code.",
        'scan_clock_in',
      )
    case 'too_late':
      // Judged on arrival (P2 M1), so a clock-out that waited on the phone can land here.
      return notice(
        'error',
        'Too late to record automatically',
        'Your shift had been closed automatically, and this clock-out reached us more than 16 hours after you clocked in. Your manager has been told.',
      )
    case 'already_corrected':
      return notice('info', 'Your manager has already set your finish time', 'There is nothing more to do.')
    case 'duplicate_clock_in':
      return notice('error', 'You clocked in here a moment ago', 'That shift is already closed. If this is wrong, tell your manager.')
    case 'stale_scan':
      return describeNotSaved(kind, 'stale')
    case 'rate_limited':
      return notice('warning', 'Too many scans in a short time', 'Wait a minute, then scan again.')
    case 'duplicate_event':
      return notice('error', 'That scan was already used', 'Please scan the code again.')
    case 'unknown_qr':
      return notice('error', "This code isn't recognised", 'Tell your manager.')
    case 'wrong_qr_type':
      return describeWrongPoster(kind, result.qr?.kind)
    case 'not_signed_in':
      return describeSignIn()
    case 'role_not_allowed':
      return notice('error', "Your account can't clock in", 'Only cleaners and ops managers clock in. Contact your manager if this is wrong.')
    case 'not_staff':
    case 'inactive':
      return ACCOUNT_BLOCKED
    default:
      return notice('error', 'The scan could not be saved', 'Please scan the code again.')
  }
}

const MANAGER_ASK: Record<ClockKind, string> = {
  clock_in: 'Tell your manager the time you started.',
  clock_out: 'Tell your manager the time you finished.',
}

const NOT_SAVED: Record<ClockKind, string> = {
  clock_in: "Your clock-in couldn't be saved",
  clock_out: "Your clock-out couldn't be saved",
}

/** A scan the outbox took out of the line without saving it (review H1/H2). */
function describeNotSaved(kind: ClockKind, reason: FailReason, scannedAtMs?: number): ClockNotice {
  if (reason !== 'stale') return notice('error', NOT_SAVED[kind], MANAGER_ASK[kind])
  const when = scannedAtMs ? ` (scanned ${formatLondonDateTime(scannedAtMs)})` : ''
  return notice('error', NOT_SAVED[kind], `It waited on this phone too long to be sent${when}. ${MANAGER_ASK[kind]}`)
}

const describeSignIn = (): ClockNotice =>
  notice(
    'warning',
    'Your login has expired — sign in again',
    'Your scan is saved on this phone. It will be sent after you sign in.',
    'sign_in',
  )

/** The notice for one clock attempt. */
export function describeClockOutcome(kind: ClockKind, outcome: SendOutcome): ClockNotice {
  if (outcome.status === 'needs_sign_in') return describeSignIn()
  if (outcome.status === 'failed') return describeNotSaved(kind, outcome.reason, outcome.event.scannedAtMs)
  if (outcome.status === 'queued' && outcome.reason === 'rate_limited') {
    return notice('warning', 'Saved on this phone', 'Too many scans in a short time, so it will be sent in a minute. You can carry on.')
  }
  if (outcome.status === 'queued') {
    return notice('warning', 'Saved on this phone', 'It will be sent when you have signal. You can carry on.')
  }
  const result = outcome.result
  if (!('serverNow' in result)) {
    return notice('error', 'Something went wrong', result.message || 'Please scan the code again.')
  }
  const base = result.ok ? describeSuccess(result) : describeRefusal(kind, result)
  return { ...base, notes: flagNotes(result.flags) }
}

/** A code this app can't read at all. Not saved on the phone: there is nothing to send. */
export const describeUnreadableCode = (expected: ClockKind): ClockNotice =>
  notice('error', "This code isn't recognised", `Scan the ${expected === 'clock_in' ? 'Clock In' : 'Clock Out'} code, or tell your manager.`)

/**
 * Whether a clock-out attempt is over: saved, kept on the phone, or the shift
 * is closed anyway. Anything else (wrong poster, unknown code) lets the cleaner
 * scan again.
 */
export function clockOutIsFinished(outcome: SendOutcome): boolean {
  if (outcome.status === 'failed') return false
  if (outcome.status !== 'answered') return true
  const { result } = outcome
  if (result.ok) return true
  return result.code === 'no_open_shift' || result.code === 'too_late' || result.code === 'already_corrected'
}

/** A login problem, with or without scans waiting on the phone. */
export const describeSignInNeeded = (hasWaitingScans: boolean): ClockNotice =>
  hasWaitingScans
    ? describeSignIn()
    : notice('warning', 'Your login has expired — sign in again', 'Sign in to check your shift.', 'sign_in')

/** Scans saved on this phone that haven't reached the server yet. */
export function describeWaitingScans(kind: ClockKind, scannedAtMs: number, count: number): ClockNotice {
  const what = kind === 'clock_in' ? 'clock-in' : 'clock-out'
  const time = formatLondonTime(new Date(scannedAtMs).toISOString())
  const others = count > 1 ? ` (${count} scans waiting)` : ''
  return notice(
    'warning',
    'Saved on this phone',
    `Your ${what} at ${time} will be sent when you have signal${others}. You can carry on.`,
  )
}

/** The last shift was closed by the 12-hour sweep, with no clock-out (D2). */
export const describeAutoClosedShift = (closedAt: string | null): ClockNotice =>
  notice(
    'info',
    'Your last shift was closed automatically',
    `No clock-out was recorded, so it was closed at ${formatLondonTime(closedAt)}. If you finished, scan the Clock Out code to record when you left.`,
  )

/** Whether a clock-in attempt is over (saved, or kept on the phone). Refusals let the cleaner scan again. */
export const clockInIsFinished = (outcome: SendOutcome): boolean =>
  outcome.status === 'answered' ? outcome.result.ok : outcome.status !== 'failed'

/** The message for a scan dropped while the cleaner wasn't looking, shown on the next open. */
export const describeDroppedScan = (scan: { kind: ClockKind; reason: FailReason; scannedAtMs: number }): ClockNotice =>
  describeNotSaved(scan.kind, scan.reason, scan.scannedAtMs)
