import { describe, expect, it } from 'vitest'
import type { ClockServerResult, ClockShift } from '@/services/clockApi'
import { describeClockOutcome, describeWrongPoster, formatLondonTime } from './clockMessages'
import type { SendOutcome } from './outbox'
import type { ClockEvent } from './clockEvents'

const shift = (overrides: Partial<ClockShift> = {}): ClockShift => ({
  id: 4196,
  workerRole: 'cleaner',
  customerName: 'Adams',
  siteName: 'Adams',
  clockIn: '2026-11-04T07:02:00.000Z',
  clockOut: null,
  businessDay: '2026-11-04',
  needsReview: false,
  clockInSource: 'scan',
  closeSource: null,
  autoClosed: false,
  clockOutMissing: false,
  ...overrides,
})

const event: ClockEvent = {
  eventId: 'e1',
  userId: 'u1',
  kind: 'clock_in',
  qrPayload: 'Adams Clock-in',
  scannedAtMs: 0,
  location: null,
  device: {},
  attempts: 0,
  nextAttemptAtMs: 0,
}

const answered = (overrides: Partial<ClockServerResult>): SendOutcome => ({
  status: 'answered',
  event,
  result: {
    ok: true,
    code: 'clocked_in',
    message: '',
    shift: shift(),
    flags: [],
    qr: null,
    replay: false,
    serverNow: '2026-11-04T07:02:00.000Z',
    ...overrides,
  } as ClockServerResult,
})

describe('formatLondonTime', () => {
  it('shows server times on the London clock, summer and winter', () => {
    expect(formatLondonTime('2026-11-04T07:02:00.000Z')).toBe('07:02')
    expect(formatLondonTime('2026-07-04T07:02:00.000Z')).toBe('08:02')
    expect(formatLondonTime(null)).toBe('')
  })
})

describe('describeClockOutcome', () => {
  it('clocked in: success with the server time and the site', () => {
    const notice = describeClockOutcome('clock_in', answered({ code: 'clocked_in' }))
    expect(notice).toMatchObject({ tone: 'success', title: 'Clocked in at 07:02' })
    expect(notice.body).toContain('Adams')
  })

  it('already clocked in: shows the open shift and offers clock out', () => {
    const notice = describeClockOutcome('clock_in', answered({ code: 'already_clocked_in' }))
    expect(notice).toMatchObject({ tone: 'info', action: 'clock_out' })
    expect(notice.title).toMatch(/already clocked in/i)
    expect(notice.body).toContain('Adams since 07:02')
  })

  it('clocked out: success with the finish time', () => {
    const notice = describeClockOutcome(
      'clock_out',
      answered({ code: 'clocked_out', shift: shift({ clockOut: '2026-11-04T16:30:00.000Z' }) }),
    )
    expect(notice).toMatchObject({ tone: 'success', title: 'Clocked out at 16:30' })
  })

  it('late clock-out after an auto-close: saved, the manager confirms the hours', () => {
    const notice = describeClockOutcome(
      'clock_out',
      answered({
        code: 'late_clock_out',
        flags: ['late_after_auto_close'],
        shift: shift({ clockOut: '2026-11-04T16:30:00.000Z', needsReview: true }),
      }),
    )
    expect(notice.tone).toBe('success')
    expect(notice.title).toBe('Clock-out recorded at 16:30')
    expect(notice.body).toMatch(/closed automatically/i)
    expect(notice.body).toMatch(/manager will confirm/i)
  })

  it("another site's code: accepted, flagged gently", () => {
    const notice = describeClockOutcome(
      'clock_out',
      answered({ code: 'clocked_out', flags: ['other_site_qr'], shift: shift({ clockOut: '2026-11-04T16:30:00.000Z' }) }),
    )
    expect(notice.tone).toBe('success')
    expect(notice.notes.join(' ')).toMatch(/another site/i)
  })

  it('a scan that waited on the phone is flagged gently', () => {
    const notice = describeClockOutcome('clock_in', answered({ code: 'clocked_in', flags: ['queued_over_2min'] }))
    expect(notice.notes.join(' ')).toMatch(/manager will check/i)
  })

  it('a clock-in sent over an hour late: the manager will confirm the start time', () => {
    const notice = describeClockOutcome('clock_in', answered({ code: 'clocked_in', flags: ['queued_over_2min', 'queued_clock_in_capped'] }))
    expect(notice.tone).toBe('success')
    expect(notice.notes).toContain('Your clock-in was sent late, so a manager will confirm your start time.')
    // One message about the late send, not two.
    expect(notice.notes).toHaveLength(1)
  })

  it('throttled: saved on the phone, sent in a minute', () => {
    const notice = describeClockOutcome('clock_in', { status: 'queued', event, reason: 'rate_limited' })
    expect(notice.tone).toBe('warning')
    expect(notice.title).toMatch(/saved on this phone/i)
    expect(notice.body).toMatch(/too many scans/i)
  })

  it('no open shift: not clocked in, offers clock in', () => {
    const notice = describeClockOutcome('clock_out', answered({ ok: false, code: 'no_open_shift', shift: null } as Partial<ClockServerResult>))
    expect(notice).toMatchObject({ tone: 'error', action: 'scan_clock_in' })
    expect(notice.title).toMatch(/not clocked in/i)
  })

  it('too late: the manager has been told', () => {
    const notice = describeClockOutcome('clock_out', answered({ ok: false, code: 'too_late' } as Partial<ClockServerResult>))
    expect(notice.tone).toBe('error')
    expect(notice.body).toMatch(/manager has been told/i)
  })

  it.each([
    ['clock_in', 'CLOCK_OUT', /Clock Out code/],
    ['clock_in', 'AREA', /area code/i],
    ['clock_out', 'CLOCK_IN', /Clock In code/],
  ] as const)('wrong poster (%s, scanned %s) explains which poster to use', (kind, scanned, title) => {
    const notice = describeClockOutcome(
      kind,
      answered({ ok: false, code: 'wrong_qr_type', shift: null, qr: { id: 'x', kind: scanned, status: null, customerName: null, siteName: null } } as Partial<ClockServerResult>),
    )
    expect(notice.tone).toBe('error')
    expect(notice.title).toMatch(title)
  })

  it.each(['role_not_allowed', 'not_staff', 'inactive'] as const)('%s: account cannot clock', (code) => {
    const notice = describeClockOutcome('clock_in', answered({ ok: false, code, shift: null } as Partial<ClockServerResult>))
    expect(notice.tone).toBe('error')
    expect(notice.title).toMatch(/account/i)
  })

  it('queued: saved on this phone, will send', () => {
    const notice = describeClockOutcome('clock_in', { status: 'queued', event, reason: 'network' })
    expect(notice.tone).toBe('warning')
    expect(notice.title).toMatch(/saved on this phone/i)
    expect(notice.body).toMatch(/when you have signal/i)
  })

  it('needs sign-in: login expired, with a sign-in action', () => {
    const notice = describeClockOutcome('clock_in', { status: 'needs_sign_in', event })
    expect(notice).toMatchObject({ tone: 'warning', action: 'sign_in' })
    expect(notice.title).toMatch(/login has expired/i)
  })

  it('every server code gets a message', () => {
    const codes = [
      'clocked_in', 'already_clocked_in', 'clocked_out', 'already_clocked_out', 'late_clock_out',
      'no_open_shift', 'too_late', 'already_corrected', 'duplicate_clock_in', 'duplicate_event', 'unknown_qr',
      'wrong_qr_type', 'not_signed_in', 'not_staff', 'inactive', 'role_not_allowed', 'bad_request', 'rate_limited',
      'stale_scan',
    ]
    for (const code of codes) {
      const ok = ['clocked_in', 'already_clocked_in', 'clocked_out', 'already_clocked_out', 'late_clock_out'].includes(code)
      const notice = describeClockOutcome('clock_out', answered({ ok, code, shift: ok ? shift() : null } as Partial<ClockServerResult>))
      expect(notice.title, code).toBeTruthy()
    }
  })
})

describe('describeWrongPoster', () => {
  it('explains a Clock Out code on the clock-in screen', () => {
    expect(describeWrongPoster('clock_in', 'CLOCK_OUT').title).toMatch(/Clock Out code/)
  })
  it('explains an area code on the clock-out screen', () => {
    expect(describeWrongPoster('clock_out', 'AREA').title).toMatch(/area code/i)
  })
})

describe('review fixes: messages', () => {
  it('a clock-in the server could never save says so plainly (H1)', () => {
    const notice = describeClockOutcome('clock_in', { status: 'failed', event, reason: 'error', code: '22003' })
    expect(notice.tone).toBe('error')
    expect(`${notice.title}. ${notice.body}`).toBe("Your clock-in couldn't be saved. Tell your manager the time you started.")
  })

  it('a clock-out that could never be saved asks for the finish time', () => {
    const notice = describeClockOutcome('clock_out', { status: 'failed', event: { ...event, kind: 'clock_out' }, reason: 'gave_up' })
    expect(`${notice.title}. ${notice.body}`).toBe("Your clock-out couldn't be saved. Tell your manager the time you finished.")
  })

  it('a scan that waited too long on the phone says when it was scanned (H2)', () => {
    const old = { ...event, scannedAtMs: Date.parse('2026-11-04T07:02:00Z') }
    const notice = describeClockOutcome('clock_in', { status: 'failed', event: old, reason: 'stale' })
    expect(notice.title).toBe("Your clock-in couldn't be saved")
    expect(notice.body).toMatch(/too long/)
    expect(notice.body).toContain('07:02')
    expect(notice.body).toMatch(/tell your manager the time you started/i)
  })

  it('stale_scan from the server: same plain message', () => {
    const notice = describeClockOutcome('clock_out', answered({ ok: false, code: 'stale_scan', shift: null } as Partial<ClockServerResult>))
    expect(notice.tone).toBe('error')
    expect(notice.title).toBe("Your clock-out couldn't be saved")
    expect(notice.body).toMatch(/tell your manager the time you finished/i)
  })

  it("phone_clock_skew gets a gentle note", () => {
    const notice = describeClockOutcome('clock_in', answered({ code: 'clocked_in', flags: ['phone_clock_skew'] }))
    expect(notice.tone).toBe('success')
    expect(notice.notes).toContain("Your phone's clock looks wrong — the time was sent for a manager to check.")
  })

  it('already clocked in at another site: a warning to clock out there first, with a Clock out action (M3)', () => {
    const notice = describeClockOutcome(
      'clock_in',
      answered({ code: 'already_clocked_in', flags: ['open_shift_other_site'], shift: shift({ siteName: 'Avtrade' }) }),
    )
    expect(notice).toMatchObject({ tone: 'warning', action: 'clock_out' })
    expect(notice.title).toBe("You're still clocked in at Avtrade")
    expect(notice.body).toMatch(/since 07:02/i)
    expect(notice.body).toMatch(/clock out there first/i)
  })
})
