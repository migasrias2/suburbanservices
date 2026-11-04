import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ShiftReviewQueue } from './ShiftReviewQueue'
import type { ReviewShift } from '@/services/adminDashboardService'

vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/services/shiftReviewService', () => ({
  setShiftClockOut: vi.fn(),
  validateFinishTime: vi.fn(() => null),
}))

const shift = (overrides: Partial<ReviewShift>): ReviewShift => ({
  id: '1',
  cleanerId: 'c1',
  cleanerName: 'Jean',
  customerName: 'UL Solutions',
  siteName: 'Unit 1',
  clockIn: '2026-10-20T06:00:00.000Z',
  clockOut: '2026-10-20T15:24:00.000Z',
  needsReview: true,
  reviewReason: 'Closed automatically',
  autoClosedAt: '2026-10-20T18:00:00.000Z',
  durationHours: 9.4,
  clockOutMissing: true,
  ...overrides,
})

describe('ShiftReviewQueue', () => {
  // 16 of 21 auto-closed shifts were saved at exactly clock-in + 2h because
  // the picker opened pre-filled with that guess and it was accepted as is.
  it('does not pre-fill a guessed finish time for a shift with no clock-out', () => {
    render(<ShiftReviewQueue shifts={[shift({})]} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set finish time' }))

    expect(screen.getByText('Pick date & time')).toBeTruthy()
    expect(screen.queryByText(/8:00 AM/)).toBeNull()
    expect((screen.getByRole('button', { name: 'Save finish time' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the last recorded activity as a hint, not as the answer', () => {
    render(<ShiftReviewQueue shifts={[shift({})]} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Set finish time' }))

    expect(screen.getByText(/Last recorded activity/)).toBeTruthy()
  })

  it('starts a correction from the recorded finish time', () => {
    render(<ShiftReviewQueue shifts={[shift({ clockOutMissing: false })]} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Correct finish time' }))

    expect(screen.queryByText('Pick date & time')).toBeNull()
    expect((screen.getByRole('button', { name: 'Save finish time' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
