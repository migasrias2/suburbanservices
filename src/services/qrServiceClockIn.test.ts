import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installTestLocalStorage } from '@/test/localStorage'

/**
 * Ops managers clock in through the cleaner flow, and for a long time they
 * could not clock in at all: time_attendance.cleaner_uuid pointed at
 * cleaners(id) while the insert policy demanded cleaner_uuid = auth.uid(), so
 * a manager had no legal row to write. Repointing that FK at auth.users fixed
 * the write but made an ops site visit indistinguishable from a cleaning
 * shift -- it would have been counted as one in hours worked, compliance and
 * "who is on site now".
 *
 * worker_role is what keeps them apart, so it has to be on the row at the
 * moment it is written. The database has the last word (a CHECK constraint and
 * an RLS policy that refuses an 'ops_manager' claim from an account that is not
 * one); this is the client half of that contract.
 */

const inserts: { table: string; payload: Record<string, unknown> }[] = []

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => {
        inserts.push({ table, payload })
        return Promise.resolve({ error: null })
      },
    }),
  },
}))

const { QRService } = await import('./qrService')

const OPS_UUID = '63b08829-4ed8-47c7-b416-4a79abddee22'

const qrData = {
  id: 'qr-clock-in-1',
  type: 'CLOCK_IN' as const,
  siteId: 'site-1',
  customerName: 'Avtrade',
  metadata: { siteName: 'HQ' },
}

/** logClockEvent is private; the payload it builds is the thing under test. */
const logClockEvent = (...args: unknown[]) =>
  (QRService as unknown as { logClockEvent: (...a: unknown[]) => Promise<{ success: boolean }> })
    .logClockEvent(...args)

const clockIn = () => logClockEvent(OPS_UUID, 'site-1', 'clock_in', qrData.id, qrData, null, undefined)

const attendanceRow = () => inserts.find((i) => i.table === 'time_attendance')?.payload

beforeEach(() => {
  inserts.length = 0
  installTestLocalStorage()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
  localStorage.setItem('userId', OPS_UUID)
  localStorage.setItem('userName', 'Ops Person')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('an ops manager clocking in', () => {
  beforeEach(() => {
    localStorage.setItem('userType', 'ops_manager')
  })

  it('writes an attendance row at all', async () => {
    const result = await clockIn()

    expect(result.success).toBe(true)
    expect(attendanceRow()).toBeDefined()
  })

  it('tags the row as an ops site visit, not a cleaning shift', async () => {
    await clockIn()

    expect(attendanceRow()?.worker_role).toBe('ops_manager')
  })

  it('claims the row with its own auth uuid, which is what the insert policy checks', async () => {
    await clockIn()

    expect(attendanceRow()?.cleaner_uuid).toBe(OPS_UUID)
  })
})

describe('a cleaner clocking in', () => {
  beforeEach(() => {
    localStorage.setItem('userType', 'cleaner')
  })

  it('is still tagged as a cleaning shift', async () => {
    await clockIn()

    expect(attendanceRow()?.worker_role).toBe('cleaner')
  })
})

describe('an identity that is neither', () => {
  // Fails closed: a wrong guess must never inflate cleaning hours, and the
  // database refuses an unearned 'ops_manager' claim anyway.
  it.each(['manager', 'admin', ''])('counts %s as a cleaning shift', async (userType) => {
    localStorage.setItem('userType', userType)

    await clockIn()

    expect(attendanceRow()?.worker_role).toBe('cleaner')
  })

  it('counts a missing userType as a cleaning shift', async () => {
    await clockIn()

    expect(attendanceRow()?.worker_role).toBe('cleaner')
  })
})
