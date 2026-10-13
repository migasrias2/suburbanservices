import { beforeEach, describe, expect, it, vi } from 'vitest'

const insert = vi.fn()
vi.mock('./supabase', () => ({
  supabase: { from: vi.fn(() => ({ insert })) },
}))

import { buildClockFailureRow, reportClockFailure } from './clockFailureService'
import { supabase } from './supabase'

describe('buildClockFailureRow', () => {
  it('maps a failure to the table columns', () => {
    expect(
      buildClockFailureRow({
        eventType: 'clock_out',
        reason: ' No active clock-in found. ',
        cleanerName: 'Michael Andrews',
        qrCodeId: '9fa00da9',
        customerName: 'The Orange Square',
        hasLocation: true,
      }),
    ).toEqual({
      event_type: 'clock_out',
      reason: 'No active clock-in found.',
      cleaner_name: 'Michael Andrews',
      qr_code_id: '9fa00da9',
      customer_name: 'The Orange Square',
      has_location: true,
    })
  })

  it('caps the reason at the database limit and never sends an empty one', () => {
    expect(buildClockFailureRow({ eventType: 'clock_in', reason: 'x'.repeat(900) }).reason).toHaveLength(500)
    expect(buildClockFailureRow({ eventType: 'clock_in', reason: '   ' }).reason).toBe('Unknown failure')
  })

  it('leaves unknown details empty rather than inventing them', () => {
    const row = buildClockFailureRow({ eventType: 'clock_in', reason: 'Camera failed' })
    expect(row.cleaner_name).toBeNull()
    expect(row.qr_code_id).toBeNull()
    expect(row.has_location).toBeNull()
  })
})

describe('reportClockFailure', () => {
  beforeEach(() => {
    insert.mockReset()
  })

  it('writes to clock_event_failures', async () => {
    insert.mockResolvedValue({ error: null })
    await reportClockFailure({ eventType: 'clock_out', reason: 'Failed to log clock-out' })
    expect(supabase.from).toHaveBeenCalledWith('clock_event_failures')
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'clock_out', reason: 'Failed to log clock-out' }))
  })

  it('swallows database errors and thrown errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    insert.mockResolvedValueOnce({ error: { message: 'relation does not exist' } })
    await expect(reportClockFailure({ eventType: 'clock_in', reason: 'x' })).resolves.toBeUndefined()
    insert.mockRejectedValueOnce(new Error('offline'))
    await expect(reportClockFailure({ eventType: 'clock_in', reason: 'x' })).resolves.toBeUndefined()
    warn.mockRestore()
  })
})
