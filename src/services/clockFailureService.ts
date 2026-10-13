import { supabase } from './supabase'

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

/**
 * Record a clock-in/out that did not go through. Before this, a failed attempt
 * left no trace on the server, so "I tried to clock out" could not be checked.
 * Never throws: reporting a failure must not become a second failure.
 */
export async function reportClockFailure(failure: ClockFailure): Promise<void> {
  try {
    const { error } = await supabase.from('clock_event_failures').insert(buildClockFailureRow(failure))
    if (error) console.warn('Could not record the clock failure', error)
  } catch (error) {
    console.warn('Could not record the clock failure', error)
  }
}
