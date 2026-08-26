import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CleanerToday } from '../../services/cleanerHomeService'

/**
 * The Today screen replaced dropping cleaners straight onto a camera. These
 * cover the three states it has to get right — on the clock, rostered but not
 * started, and nothing on today — plus the two nudges it carries.
 */

const navigate = vi.fn()
let todayData: CleanerToday
let assistCount = 0
let shouldFail = false

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))

vi.mock('../../services/cleanerHomeService', () => ({
  fetchCleanerToday: vi.fn(async () => {
    if (shouldFail) throw new Error('offline')
    return todayData
  }),
}))

vi.mock('../../hooks/useOpenAssistCount', () => ({
  useOpenAssistCount: () => assistCount,
}))

const { CleanerDashboard } = await import('./CleanerDashboard')

const at = (hours: number, dayOffset = 0) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hours)
  return d.toISOString()
}

const baseToday = (): CleanerToday => ({
  activeShift: null,
  todayShift: null,
  nextShift: null,
  areasCompletedToday: 0,
  tasksCompletedToday: 0,
  flaggedShiftCount: 0,
})

const shift = (over: Record<string, unknown> = {}) =>
  ({
    id: 's1',
    cleanerId: 'c1',
    cleanerName: 'ZZ Cleaner',
    customerId: null,
    customerName: 'Metalex',
    siteName: 'Metalex House',
    startAt: at(18),
    endAt: at(22),
    notes: null,
    createdBy: null,
    createdAt: at(9, -5),
    updatedAt: at(9, -5),
    publishedAt: at(9, -5),
    cancelledAt: null,
    cancellationReason: null,
    ...over,
  }) as CleanerToday['todayShift']

const renderScreen = () =>
  render(<CleanerDashboard cleanerId="c1" cleanerName="ZZ Cleaner" />)

describe('CleanerDashboard (Today screen)', () => {
  beforeEach(() => {
    todayData = baseToday()
    assistCount = 0
    shouldFail = false
    navigate.mockClear()
  })

  it('greets the cleaner by first name only', async () => {
    renderScreen()
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())

    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/ZZ$/)
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toMatch(/Cleaner/)
  })

  it('shows elapsed time and site while on the clock', async () => {
    todayData = {
      ...baseToday(),
      activeShift: {
        attendanceId: 42,
        siteName: 'Metalex House',
        customerName: 'Metalex',
        clockInAt: at(18),
        minutesElapsed: 95,
      },
    }

    renderScreen()

    expect(await screen.findByText('On the clock')).toBeInTheDocument()
    expect(screen.getByText('1h 35m')).toBeInTheDocument()
    expect(screen.getByText(/Metalex · Metalex House/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /carry on working/i })).toBeInTheDocument()
  })

  it("shows today's rostered shift and its notes when not clocked in", async () => {
    todayData = { ...baseToday(), todayShift: shift({ notes: 'Gate code is 4471.' }) }

    renderScreen()

    expect(await screen.findByText('Today’s shift')).toBeInTheDocument()
    expect(screen.getByText('Gate code is 4471.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clock in/i })).toBeInTheDocument()
  })

  it('names the next shift when nothing is on today', async () => {
    todayData = {
      ...baseToday(),
      nextShift: shift({ startAt: at(9, 3), endAt: at(13, 3) }),
    }

    renderScreen()

    expect(await screen.findByText('Not clocked in')).toBeInTheDocument()
    expect(screen.getByText(/You’re next in on/)).toBeInTheDocument()
  })

  it('still offers clock-in when there is no roster at all', async () => {
    renderScreen()

    expect(await screen.findByText(/you’ve been asked to cover/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clock in/i })).toBeInTheDocument()
  })

  it('sends the cleaner to the clock-in flow', async () => {
    renderScreen()
    const button = await screen.findByRole('button', { name: /clock in/i })

    await userEvent.click(button)

    expect(navigate).toHaveBeenCalledWith('/clock-in')
  })

  it("reports today's completed work", async () => {
    todayData = { ...baseToday(), areasCompletedToday: 6, tasksCompletedToday: 29 }

    renderScreen()

    expect(await screen.findByText('6')).toBeInTheDocument()
    expect(screen.getByText('29')).toBeInTheDocument()
  })

  it('surfaces waiting assist requests with correct pluralisation', async () => {
    assistCount = 1
    renderScreen()
    expect(await screen.findByText(/1 bathroom request waiting/)).toBeInTheDocument()

    assistCount = 3
    renderScreen()
    expect(await screen.findAllByText(/3 bathroom requests waiting/)).not.toHaveLength(0)
  })

  it('hides the assist prompt when nothing is waiting', async () => {
    renderScreen()
    await screen.findByRole('heading', { level: 1 })

    expect(screen.queryByText(/bathroom request/i)).not.toBeInTheDocument()
  })

  it('tells the cleaner when their own shifts are under payroll review', async () => {
    todayData = { ...baseToday(), flaggedShiftCount: 2 }

    renderScreen()

    expect(await screen.findByText(/2 of your recent shifts need checking/)).toBeInTheDocument()
  })

  it('shows a recoverable message instead of a blank screen when loading fails', async () => {
    shouldFail = true

    renderScreen()

    expect(await screen.findByText(/couldn't load your shift/i)).toBeInTheDocument()
  })
})
