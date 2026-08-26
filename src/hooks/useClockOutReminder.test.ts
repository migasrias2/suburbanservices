import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

/**
 * This nudge exists because 17.8% of shifts were unusable for payroll. It has
 * to fire when a shift really has overrun and stay quiet otherwise — a banner
 * that cries wolf gets ignored, which puts us back where we started.
 */

let openShift: { id: number; clock_in: string } | null = null
let rosteredShifts: { startAt: string; endAt: string }[] = []
let shiftsShouldThrow = false

const terminal = (value: unknown) => {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'order', 'limit', 'maybeSingle']) q[m] = () => q
  ;(q as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(value)
  return q
}

vi.mock('@/services/supabase', () => ({
  supabase: {
    from: () => terminal({ data: openShift, error: null }),
  },
}))

vi.mock('@/services/shiftsService', () => ({
  fetchShiftsInRange: vi.fn(async () => {
    if (shiftsShouldThrow) throw new Error('offline')
    return rosteredShifts
  }),
}))

const { useClockOutReminder } = await import('./useClockOutReminder')

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

describe('useClockOutReminder', () => {
  beforeEach(() => {
    openShift = null
    rosteredShifts = []
    shiftsShouldThrow = false
    vi.stubGlobal('Notification', undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('stays quiet when the cleaner is not clocked in', async () => {
    const { result } = renderHook(() => useClockOutReminder('c1', true))

    await waitFor(() => expect(result.current.isOverdue).toBe(false))
    expect(result.current.basis).toBeNull()
  })

  it('stays quiet during a normal shift with no roster', async () => {
    openShift = { id: 1, clock_in: hoursAgo(3) }

    const { result } = renderHook(() => useClockOutReminder('c1', true))

    await waitFor(() => expect(result.current.basis).toBe('default'))
    expect(result.current.isOverdue).toBe(false)
  })

  it('fires once past the default shift length when nothing is rostered', async () => {
    openShift = { id: 1, clock_in: hoursAgo(11) }

    const { result } = renderHook(() => useClockOutReminder('c1', true))

    await waitFor(() => expect(result.current.isOverdue).toBe(true))
    expect(result.current.basis).toBe('default')
    // 11h in against a 9h default -> ~2h over
    expect(result.current.minutesOverdue).toBeGreaterThanOrEqual(119)
    expect(result.current.minutesOverdue).toBeLessThanOrEqual(121)
  })

  it('prefers the rostered end time over the default', async () => {
    openShift = { id: 1, clock_in: hoursAgo(5) }
    rosteredShifts = [{ startAt: hoursAgo(5), endAt: hoursAgo(1) }]

    const { result } = renderHook(() => useClockOutReminder('c1', true))

    await waitFor(() => expect(result.current.isOverdue).toBe(true))
    expect(result.current.basis).toBe('rostered')
    expect(result.current.minutesOverdue).toBeGreaterThanOrEqual(59)
    expect(result.current.minutesOverdue).toBeLessThanOrEqual(61)
  })

  it('does not fire while a rostered shift is still running', async () => {
    openShift = { id: 1, clock_in: hoursAgo(2) }
    rosteredShifts = [{ startAt: hoursAgo(2), endAt: hoursFromNow(2) }]

    const { result } = renderHook(() => useClockOutReminder('c1', true))

    await waitFor(() => expect(result.current.basis).toBe('rostered'))
    expect(result.current.isOverdue).toBe(false)
  })

  it('measures against the last shift of the day for a split shift', async () => {
    openShift = { id: 1, clock_in: hoursAgo(9) }
    rosteredShifts = [
      { startAt: hoursAgo(9), endAt: hoursAgo(7) },
      { startAt: hoursAgo(4), endAt: hoursFromNow(1) },
    ]

    const { result } = renderHook(() => useClockOutReminder('c1', true))

    await waitFor(() => expect(result.current.basis).toBe('rostered'))
    // still inside the second block, so no nudge
    expect(result.current.isOverdue).toBe(false)
  })

  it('falls back to the default when the roster cannot be loaded', async () => {
    openShift = { id: 1, clock_in: hoursAgo(11) }
    shiftsShouldThrow = true

    const { result } = renderHook(() => useClockOutReminder('c1', true))

    await waitFor(() => expect(result.current.isOverdue).toBe(true))
    expect(result.current.basis).toBe('default')
  })

  it('goes quiet when dismissed', async () => {
    openShift = { id: 1, clock_in: hoursAgo(11) }

    const { result } = renderHook(() => useClockOutReminder('c1', true))
    await waitFor(() => expect(result.current.isOverdue).toBe(true))

    act(() => result.current.dismiss())

    expect(result.current.isOverdue).toBe(false)
  })

  it('does nothing at all when disabled', async () => {
    openShift = { id: 1, clock_in: hoursAgo(20) }

    const { result } = renderHook(() => useClockOutReminder('c1', false))

    await waitFor(() => expect(result.current.isOverdue).toBe(false))
    expect(result.current.basis).toBeNull()
  })

  it('does nothing without a cleaner id', async () => {
    openShift = { id: 1, clock_in: hoursAgo(20) }

    const { result } = renderHook(() => useClockOutReminder('', true))

    await waitFor(() => expect(result.current.isOverdue).toBe(false))
  })
})
