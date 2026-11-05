import { describe, expect, it } from 'vitest'
import { buildClockFailureRow } from './clockFailureService'

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
