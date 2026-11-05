export type ClockEventType = 'clock_in' | 'clock_out'

export interface ClockFailure {
  eventType: ClockEventType
  reason: string
  cleanerName?: string | null
  qrCodeId?: string | null
  customerName?: string | null
  hasLocation?: boolean
}

const MAX_REASON_LENGTH = 500

/**
 * A clock_event_failures row. Sent by the failure queue (src/lib/clock/failureQueue.ts),
 * which keeps reports on the phone while signed out (D7c).
 */
export function buildClockFailureRow(failure: ClockFailure) {
  const reason = (failure.reason || 'Unknown failure').trim().slice(0, MAX_REASON_LENGTH)
  return {
    event_type: failure.eventType,
    reason: reason || 'Unknown failure',
    cleaner_name: failure.cleanerName?.trim() || null,
    qr_code_id: failure.qrCodeId?.trim() || null,
    customer_name: failure.customerName?.trim() || null,
    has_location: failure.hasLocation ?? null,
  }
}
