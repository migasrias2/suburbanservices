import { describe, expect, it } from 'vitest'
import type { ClockResult } from '@/services/clockApi'
import { classifyClockResult } from './clockEvents'

const networkError = (code?: string, message = 'request failed'): ClockResult => ({
  ok: false,
  code: 'network',
  message: 'No signal',
  cause: code ? { code, message } : { message },
})

describe('classifyClockResult', () => {
  it('retries a failure with no code (fetch failed, offline)', () => {
    expect(classifyClockResult(networkError())).toBe('retry')
  })

  // Transport errors carry codes that are not database codes. They say nothing
  // about whether the scan can be saved, so they must never drop it (review 15, N1).
  it.each(['20', '23', 'ECONNRESET', 'ETIMEDOUT', '429', 'timeout'])('retries the transport code %s', (code) => {
    expect(classifyClockResult(networkError(code))).toBe('retry')
  })

  // Server states that pass on their own: read-only during a disk-full incident,
  // a lock timeout, and a function briefly missing while a migration replaces it.
  it.each(['25006', '55P03', '55006', '42883', 'PGRST202', '08006', '40001', '53300', '57014', 'PGRST002', '503'])(
    'retries the passing server state %s',
    (code) => {
      expect(classifyClockResult(networkError(code))).toBe('retry')
    },
  )

  it.each(['22003', 'P0001', '23505', '22P02', 'PGRST116'])('drops the permanent database error %s', (code) => {
    expect(classifyClockResult(networkError(code))).toBe('failed')
  })

  it('asks to sign in for login errors', () => {
    expect(classifyClockResult(networkError('PGRST301'))).toBe('sign_in')
    expect(classifyClockResult(networkError('42501'))).toBe('sign_in')
    expect(classifyClockResult(networkError(undefined, 'JWT expired'))).toBe('sign_in')
  })
})
