import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installTestLocalStorage } from '@/test/localStorage'

/**
 * Clock-out used to fail in two silent ways (audit C1 and F1):
 *
 * 1. When the phone could not reach the server, every "find my open shift"
 *    lookup errored, the errors were skipped, and the cleaner was told they
 *    were not clocked in. Their local clock-in was wiped too.
 * 2. The clock-out UPDATE never asked how many rows it changed. If the
 *    database filtered it out, nothing changed and the app still said
 *    "clocked out", so the shift stayed open until the 12-hour sweep.
 *
 * These tests drive QRService.processQRScan against a fake Supabase client.
 */

type Call = {
  table: string
  op: 'select' | 'insert' | 'update' | 'upsert'
  payload?: unknown
  columns?: string
  filters: unknown[][]
}
type Reply = { data?: unknown; error?: unknown }

const calls: Call[] = []
let reply: (call: Call) => Reply = () => ({ data: null, error: null })
// What supabase.auth.getSession() hands back. null = the login has expired.
let session: unknown = { access_token: 'token', user: { id: 'cleaner' } }

// A PostgREST-style builder: every method chains, and awaiting it asks `reply`.
const builder = (call: Call) => {
  calls.push(call)
  const chain: Record<string, unknown> = {}
  const record = (name: string) => (...args: unknown[]) => {
    call.filters.push([name, ...args])
    return chain
  }
  for (const name of ['eq', 'is', 'ilike', 'order', 'limit', 'gte', 'lt', 'maybeSingle']) {
    chain[name] = record(name)
  }
  chain.select = (columns: string) => {
    call.columns = columns
    return chain
  }
  chain.then = (resolve: (value: Reply) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve()
      .then(() => ({ data: null, error: null, ...reply(call) }))
      .then(resolve, reject)
  return chain
}

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
    },
    from: (table: string) => ({
      select: (columns: string) => builder({ table, op: 'select', columns, filters: [] }),
      insert: (payload: unknown) => builder({ table, op: 'insert', payload, filters: [] }),
      update: (payload: unknown) => builder({ table, op: 'update', payload, filters: [] }),
      upsert: (payload: unknown) => builder({ table, op: 'upsert', payload, filters: [] }),
    }),
  },
}))

const reportClockFailure = vi.fn(async () => {})
vi.mock('./clockFailureService', () => ({
  reportClockFailure: (...args: unknown[]) => reportClockFailure(...(args as [])),
}))

vi.mock('./managerService', () => ({
  autoLinkCleanerToCustomer: async () => {},
}))

const { QRService, resetClockFailureThrottle } = await import('./qrService')

const CLEANER_UUID = '0f1e2d3c-4b5a-4968-8776-655443322110'
const CLEANER_NAME = 'Michael Andrews'

const clockOutCode = {
  id: 'qr-clock-out-1',
  type: 'CLOCK_OUT' as const,
  siteId: 'site-1',
  customerName: 'Avtrade',
  metadata: { siteName: 'HQ' },
}

const clockInCode = { ...clockOutCode, id: 'qr-clock-in-1', type: 'CLOCK_IN' as const }

const openShift = {
  id: 42,
  cleaner_id: null,
  cleaner_uuid: CLEANER_UUID,
  cleaner_name: CLEANER_NAME,
  cleaner_mobile: '07000000000',
  customer_name: 'Avtrade',
  site_name: 'HQ',
  clock_in: '2026-11-04T07:02:00.000Z',
  clock_out: null,
  notes: 'Clock-in via QR',
  clock_in_qr: 'qr-clock-in-1',
}

const networkDown = { message: 'TypeError: Failed to fetch', code: '' }

const attendanceLookups = () => calls.filter((c) => c.table === 'time_attendance' && c.op === 'select')
const attendanceWrites = () =>
  calls.filter((c) => c.table === 'time_attendance' && (c.op === 'update' || c.op === 'insert'))

// The cleaner clocked in on this phone two hours ago: long enough that the old
// code treated the local state as stale and wiped it.
const seedLocalClockIn = () => {
  localStorage.setItem('currentClockInPhase', 'workflow')
  localStorage.setItem(
    'currentClockInData',
    JSON.stringify({ time: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }),
  )
  localStorage.setItem('currentSiteName', 'HQ')
}

const clockOut = () => QRService.processQRScan(clockOutCode, CLEANER_UUID, CLEANER_NAME)

beforeEach(() => {
  calls.length = 0
  reportClockFailure.mockClear()
  reply = () => ({ data: null, error: null })
  session = { access_token: 'token', user: { id: CLEANER_UUID } }
  resetClockFailureThrottle()
  installTestLocalStorage()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
  localStorage.setItem('userId', CLEANER_UUID)
  localStorage.setItem('userName', CLEANER_NAME)
  localStorage.setItem('userMobile', '07000000000')
  localStorage.setItem('userType', 'cleaner')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('clocking out when the shift lookup cannot reach the server', () => {
  beforeEach(() => {
    seedLocalClockIn()
    reply = (call) =>
      call.table === 'time_attendance' && call.op === 'select' ? { data: null, error: networkDown } : {}
  })

  it('says the shift could not be checked, not that the cleaner is clocked out', async () => {
    const result = await clockOut()

    expect(attendanceLookups().length).toBeGreaterThan(0)
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/couldn't check your shift/i)
    expect(result.message).not.toMatch(/already clocked out|no active clock-in|clock in first/i)
  })

  it("keeps the phone's clock-in, so the cleaner can try again once they have signal", async () => {
    await clockOut()

    expect(localStorage.getItem('currentClockInPhase')).toBe('workflow')
    expect(localStorage.getItem('currentClockInData')).not.toBeNull()
    expect(localStorage.getItem('currentSiteName')).toBe('HQ')
  })

  it('writes nothing to the timesheet', async () => {
    await clockOut()

    expect(attendanceWrites()).toEqual([])
  })

  it('reports the failed attempt', async () => {
    await clockOut()

    expect(reportClockFailure).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'clock_out', reason: expect.stringMatching(/couldn't check your shift/i) }),
    )
  })

  it('treats a lookup that throws the same way', async () => {
    reply = (call) => {
      if (call.table === 'time_attendance' && call.op === 'select') throw new Error('Load failed')
      return {}
    }

    const result = await clockOut()

    expect(result.message).toMatch(/couldn't check your shift/i)
    expect(localStorage.getItem('currentClockInPhase')).toBe('workflow')
  })
})

describe('clocking out when the shift is found, but the second lookup fails', () => {
  // processQRScan looks the shift up twice: once to check, once inside
  // logClockEvent to find the row to close. The second one has its own guard.
  it('stops with "couldn\'t check", without writing or claiming "no active clock-in"', async () => {
    seedLocalClockIn()
    let lookups = 0
    reply = (call) => {
      if (call.table !== 'time_attendance' || call.op !== 'select') return {}
      lookups += 1
      return lookups === 1 ? { data: [openShift] } : { data: null, error: networkDown }
    }

    const result = await clockOut()

    expect(lookups).toBeGreaterThan(1)
    expect(result.message).toMatch(/couldn't check your shift/i)
    expect(attendanceWrites()).toEqual([])
  })
})

describe('clocking out with an expired login', () => {
  // supabase-js quietly falls back to the anon key, and RLS then answers with
  // no rows rather than an error. That must not read as "not clocked in".
  beforeEach(() => {
    seedLocalClockIn()
    session = null
    reply = (call) => (call.table === 'time_attendance' && call.op === 'select' ? { data: [] } : {})
  })

  it('says the shift could not be checked', async () => {
    const result = await clockOut()

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/couldn't check your shift/i)
  })

  it("keeps the phone's clock-in", async () => {
    await clockOut()

    expect(localStorage.getItem('currentClockInPhase')).toBe('workflow')
    expect(localStorage.getItem('currentClockInData')).not.toBeNull()
  })
})

describe('clocking out when some lookups fail and the rest find nothing', () => {
  it('is "couldn\'t check", not "already clocked out", and keeps local state', async () => {
    seedLocalClockIn()
    let lookups = 0
    reply = (call) => {
      if (call.table !== 'time_attendance' || call.op !== 'select') return {}
      lookups += 1
      return lookups % 2 === 0 ? { data: null, error: networkDown } : { data: [] }
    }

    const result = await clockOut()

    expect(result.message).toMatch(/couldn't check your shift/i)
    expect(localStorage.getItem('currentClockInPhase')).toBe('workflow')
  })
})

describe('the same clock failure repeated', () => {
  beforeEach(() => {
    seedLocalClockIn()
    reply = (call) =>
      call.table === 'time_attendance' && call.op === 'select' ? { data: null, error: networkDown } : {}
  })

  it('is reported once per 30 s for the same code and reason', async () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(5_000_000)
    await clockOut()
    now.mockReturnValue(5_010_000)
    await clockOut()
    expect(reportClockFailure).toHaveBeenCalledTimes(1)

    now.mockReturnValue(5_031_000)
    await clockOut()
    expect(reportClockFailure).toHaveBeenCalledTimes(2)
    now.mockRestore()
  })

  it('is still reported for a different code', async () => {
    await clockOut()
    await QRService.processQRScan({ ...clockOutCode, id: 'qr-clock-out-2' }, CLEANER_UUID, CLEANER_NAME)

    expect(reportClockFailure).toHaveBeenCalledTimes(2)
  })
})

describe('an area scan when the shift lookup cannot reach the server', () => {
  const areaCode = { ...clockOutCode, id: 'qr-area-1', type: 'AREA' as const }

  beforeEach(() => {
    reply = (call) =>
      call.table === 'time_attendance' && call.op === 'select' ? { data: null, error: networkDown } : {}
  })

  it('carries on when the phone holds this person\'s clock-in', async () => {
    seedLocalClockIn()
    const result = await QRService.processQRScan(areaCode, CLEANER_UUID, CLEANER_NAME)

    expect(result.success).toBe(true)
  })

  it('says the shift could not be checked otherwise, not "clock in first"', async () => {
    const result = await QRService.processQRScan(areaCode, CLEANER_UUID, CLEANER_NAME)

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/couldn't check your shift/i)
  })
})

describe('clocking in when the shift lookup cannot reach the server', () => {
  it('does not guess "not clocked in" and insert a second shift', async () => {
    reply = (call) =>
      call.table === 'time_attendance' && call.op === 'select' ? { data: null, error: networkDown } : {}

    const result = await QRService.processQRScan(clockInCode, CLEANER_UUID, CLEANER_NAME)

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/couldn't check your shift/i)
    expect(attendanceWrites()).toEqual([])
  })
})

describe('a clock-out UPDATE that changes no rows', () => {
  beforeEach(() => {
    seedLocalClockIn()
    reply = (call) => {
      if (call.table !== 'time_attendance') return {}
      if (call.op === 'select') return { data: [openShift] }
      // What PostgREST returns when RLS or a trigger filters the row out.
      if (call.op === 'update') return { data: [] }
      return {}
    }
  })

  it('asks the database which rows it changed', async () => {
    await clockOut()

    const update = attendanceWrites().find((c) => c.op === 'update')
    expect(update?.filters).toContainEqual(['eq', 'id', 42])
    expect(update?.columns).toBe('id')
  })

  it('is a failure, not "clocked out"', async () => {
    const result = await clockOut()

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/not saved/i)
  })

  it('reports the failure', async () => {
    await clockOut()

    expect(reportClockFailure).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'clock_out', reason: expect.stringMatching(/not saved/i) }),
    )
  })

  it('does not log a "Clock Out" activity for a shift that is still open', async () => {
    await clockOut()

    expect(calls.filter((c) => c.table === 'cleaner_logs')).toEqual([])
  })
})

describe('a clock-out that saves', () => {
  beforeEach(() => {
    seedLocalClockIn()
    reply = (call) => {
      if (call.table !== 'time_attendance') return {}
      if (call.op === 'select') return { data: [openShift] }
      if (call.op === 'update') return { data: [{ id: 42 }] }
      return {}
    }
  })

  it('succeeds and reports nothing', async () => {
    const result = await clockOut()

    expect(result.success).toBe(true)
    expect(reportClockFailure).not.toHaveBeenCalled()
  })

  it('does not wait on an outside IP lookup before answering', async () => {
    // api.ipify.org with no timeout used to sit between the saved clock-out
    // and the success screen; on captive Wi-Fi it never answered.
    const fetchSpy = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchSpy)

    const result = await clockOut()

    expect(result.success).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  }, 2000)
})

describe('which failures are definitive', () => {
  // The scanner only blocks a re-scan of the same poster for a definitive
  // answer from the rules. A save that failed on the way may be retried.
  it('"already clocked out" is definitive', async () => {
    reply = (call) => (call.table === 'time_attendance' && call.op === 'select' ? { data: [] } : {})

    const result = await clockOut()

    expect(result.message).toMatch(/already clocked out/i)
    expect(result).toMatchObject({ success: false, definitive: true })
  })

  it('"no active clock-in found" is definitive', async () => {
    // A clock-in made on this phone a minute ago is trusted by the pre-check;
    // the lookup inside the clock-out then finds no open row.
    localStorage.setItem('currentClockInPhase', 'workflow')
    localStorage.setItem('currentClockInData', JSON.stringify({ time: new Date().toISOString() }))
    reply = (call) => (call.table === 'time_attendance' && call.op === 'select' ? { data: [] } : {})

    const result = await clockOut()

    expect(result.message).toMatch(/no active clock-in/i)
    expect(result).toMatchObject({ success: false, definitive: true })
  })

  it('"already clocked in" is definitive', async () => {
    reply = (call) => (call.table === 'time_attendance' && call.op === 'select' ? { data: [openShift] } : {})

    const result = await QRService.processQRScan(clockInCode, CLEANER_UUID, CLEANER_NAME)

    expect(result.message).toMatch(/already clocked in/i)
    expect(result).toMatchObject({ success: false, definitive: true })
  })

  it('a clock-out that was not saved, or a lookup that failed, is not', async () => {
    seedLocalClockIn()
    reply = (call) => {
      if (call.table !== 'time_attendance') return {}
      if (call.op === 'select') return { data: [openShift] }
      return call.op === 'update' ? { data: [] } : {}
    }
    expect((await clockOut()).definitive).toBeFalsy()

    reply = (call) =>
      call.table === 'time_attendance' && call.op === 'select' ? { data: null, error: networkDown } : {}
    expect((await clockOut()).definitive).toBeFalsy()
  })
})
