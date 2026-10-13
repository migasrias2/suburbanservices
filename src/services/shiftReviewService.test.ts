import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const query = {
  select: vi.fn(() => query),
  gte: vi.fn(() => query),
  order: vi.fn(() => query),
  limit: vi.fn(),
}
vi.mock('./supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args), from: vi.fn(() => query) },
}))

import { loadClockFailures, setShiftClockOut, validateFinishTime } from './shiftReviewService'

const clockIn = '2026-10-12T04:48:10Z'
const now = new Date('2026-10-13T12:00:00Z')

describe('validateFinishTime', () => {
  it('accepts a finish time after the clock-in, within 16 hours, in the past', () => {
    expect(validateFinishTime(clockIn, new Date('2026-10-12T07:00:00Z'), now)).toBeNull()
  })

  it('refuses a finish at or before the clock-in', () => {
    expect(validateFinishTime(clockIn, new Date(clockIn), now)).toMatch(/after the clock-in/)
  })

  it('refuses a shift longer than 16 hours', () => {
    expect(validateFinishTime(clockIn, new Date('2026-10-12T21:00:00Z'), now)).toMatch(/16 hours/)
  })

  it('refuses a future finish time', () => {
    expect(validateFinishTime('2026-10-13T08:00:00Z', new Date('2026-10-13T13:00:00Z'), now)).toMatch(/future/)
  })

  it('refuses an invalid date', () => {
    expect(validateFinishTime(clockIn, new Date('nope'), now)).toMatch(/valid/)
  })
})

describe('setShiftClockOut', () => {
  beforeEach(() => rpc.mockReset())

  it('calls the database function with a numeric id and ISO time', async () => {
    rpc.mockResolvedValue({ error: null })
    await setShiftClockOut('4014', new Date('2026-10-12T07:00:00Z'))
    expect(rpc).toHaveBeenCalledWith('set_shift_clock_out', {
      p_attendance_id: 4014,
      p_clock_out: '2026-10-12T07:00:00.000Z',
    })
  })

  it('surfaces the database message on failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValue({ error: { message: 'Only managers and admins can correct a shift' } })
    await expect(setShiftClockOut('1', new Date())).rejects.toThrow('Only managers and admins')
  })

  it('rejects a non-numeric id without calling the database', async () => {
    await expect(setShiftClockOut('abc', new Date())).rejects.toThrow('invalid id')
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('loadClockFailures', () => {
  it('maps rows from the failure log', async () => {
    query.limit.mockResolvedValueOnce({
      data: [{ id: 1, cleaner_name: 'Michael Andrews', event_type: 'clock_out', reason: 'No active clock-in found', customer_name: 'The Orange Square', has_location: true, created_at: '2026-10-13T05:00:00Z' }],
      error: null,
    })
    const rows = await loadClockFailures()
    expect(rows).toEqual([
      { id: 1, cleanerName: 'Michael Andrews', eventType: 'clock_out', reason: 'No active clock-in found', customerName: 'The Orange Square', hasLocation: true, createdAt: '2026-10-13T05:00:00Z' },
    ])
  })

  it('returns an empty list when the log cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    query.limit.mockResolvedValueOnce({ data: null, error: { message: 'relation does not exist' } })
    expect(await loadClockFailures()).toEqual([])
  })
})
