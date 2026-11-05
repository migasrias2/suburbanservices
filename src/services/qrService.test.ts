import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installTestLocalStorage } from '@/test/localStorage'

/**
 * processQRScan after P6: it only logs area/task/feedback scans. Clock-in and
 * clock-out go through the server's clock_in / clock_out functions; the
 * database refuses direct time_attendance writes (42501), so nothing here may
 * write, or even look up, a shift.
 */

vi.mock('./supabase', async () => {
  const { createFakeSupabase } = await import('@/test/fakeSupabase')
  const fake = createFakeSupabase()
  return { supabase: fake.supabase, __fake: fake }
})

const fakeDb = ((await import('./supabase')) as unknown as {
  __fake: ReturnType<typeof import('@/test/fakeSupabase').createFakeSupabase>
}).__fake
const { QRService, CLOCK_CODE_ELSEWHERE_MESSAGE } = await import('./qrService')

const USER = 'user-1'
const code = (type: string) => ({
  id: `qr-${type.toLowerCase()}`,
  type: type as 'CLOCK_IN',
  customerName: 'Adams',
  metadata: { areaName: 'kitchen' },
})

beforeEach(() => {
  installTestLocalStorage()
  localStorage.setItem('userName', 'Jean Test')
  fakeDb.reset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('processQRScan with a clock code', () => {
  it.each(['CLOCK_IN', 'CLOCK_OUT'])('turns %s away and touches no table', async (type) => {
    const result = await QRService.processQRScan(code(type), USER, 'Jean Test')
    expect(result).toEqual({ success: false, message: CLOCK_CODE_ELSEWHERE_MESSAGE, definitive: true })
    expect(fakeDb.calls).toEqual([])
    expect(fakeDb.rpcCalls).toEqual([])
  })
})

describe('processQRScan with an area code', () => {
  it('logs the scan and live position, with no shift lookup or timesheet write', async () => {
    const result = await QRService.processQRScan(code('AREA'), USER, 'Jean Test', { latitude: 51.5, longitude: -0.1 })
    expect(result).toEqual({ success: true })
    expect(fakeDb.writesTo('cleaner_logs')).toEqual([
      expect.objectContaining({
        op: 'insert',
        args: [expect.objectContaining({ cleaner_id: USER, action: 'Area Scan', site_area: 'Kitchen', latitude: 51.5 })],
      }),
    ])
    expect(fakeDb.writesTo('live_tracking')).toHaveLength(1)
    expect(fakeDb.calls.filter((c) => c.table === 'time_attendance')).toEqual([])
  })

  it('logs task and feedback scans the same way', async () => {
    await QRService.processQRScan(code('TASK'), USER, 'Jean Test')
    await QRService.processQRScan(code('FEEDBACK'), USER, 'Jean Test')
    const actions = fakeDb.writesTo('cleaner_logs').map((c) => (c.args[0] as { action: string }).action)
    expect(actions).toEqual(['Task Started', 'QR Scan'])
    expect(fakeDb.calls.filter((c) => c.table === 'time_attendance')).toEqual([])
  })
})
