import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

const h = vi.hoisted(() => ({
  warmUp: vi.fn(async () => {}),
  start: vi.fn(() => () => {}),
  userType: 'cleaner' as string | undefined,
}))

vi.mock('@/lib/scanner/decoder', () => ({ warmUpDecoder: () => h.warmUp() }))
vi.mock('@/lib/clock/clockRuntime', () => ({ startClockRuntime: () => h.start() }))
vi.mock('@/services/supabase', () => ({ supabase: {} }))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ appUser: h.userType ? { userType: h.userType } : null }),
}))

const { ClockRuntime } = await import('./ClockRuntime')

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  h.warmUp.mockClear()
  h.start.mockClear()
})

describe('ClockRuntime', () => {
  it('starts background sending once', () => {
    render(<ClockRuntime />)
    expect(h.start).toHaveBeenCalledTimes(1)
  })

  it('preloads the scanner for a cleaner once the app is idle, not only when the camera opens (review M2)', async () => {
    vi.useFakeTimers()
    h.userType = 'cleaner'
    render(<ClockRuntime />)
    expect(h.warmUp).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(h.warmUp).toHaveBeenCalledTimes(1)
  })

  it('does not download the scanner for a manager, or when nobody is signed in', async () => {
    vi.useFakeTimers()
    h.userType = 'manager'
    render(<ClockRuntime />)
    await vi.advanceTimersByTimeAsync(3_000)
    cleanup()
    h.userType = undefined
    render(<ClockRuntime />)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(h.warmUp).not.toHaveBeenCalled()
  })
})
