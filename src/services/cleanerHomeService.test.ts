import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The Today screen is what a cleaner now sees instead of a camera, so the
 * splitting of "on the clock", "rostered today" and "next in on" has to be
 * right — and the task count has to survive completed_tasks being stored as a
 * JSON string in some rows and a real array in others.
 */

let attendanceRows: unknown[] = []
let selectionRows: unknown[] = []
let flaggedCount = 0
let shiftsToReturn: unknown[] = []
let attendanceError: unknown = null

const terminal = (value: unknown) => {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'order', 'limit', 'gte', 'lt', 'not', 'maybeSingle']) {
    q[m] = () => q
  }
  ;(q as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(value)
  return q
}

let headCountNext = false

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (_cols?: string, opts?: { head?: boolean }) => {
        if (opts?.head) {
          headCountNext = true
          return terminal({ count: flaggedCount, error: null })
        }
        if (table === 'time_attendance') {
          return terminal({ data: attendanceRows, error: attendanceError })
        }
        return terminal({ data: selectionRows, error: null })
      },
    }),
  },
}))

vi.mock('./shiftsService', () => ({
  fetchShiftsInRange: vi.fn(async () => shiftsToReturn),
}))

const { fetchCleanerToday } = await import('./cleanerHomeService')
const { fetchShiftsInRange } = await import('./shiftsService')

const atMidnightPlus = (hours: number, dayOffset = 0) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hours)
  return d.toISOString()
}

describe('fetchCleanerToday', () => {
  beforeEach(() => {
    attendanceRows = []
    selectionRows = []
    shiftsToReturn = []
    flaggedCount = 0
    attendanceError = null
    headCountNext = false
    vi.clearAllMocks()
  })

  it('requires a cleaner id rather than silently querying everyone', async () => {
    await expect(fetchCleanerToday('')).rejects.toThrow(/cleaner id is required/i)
  })

  it('reports an open shift with elapsed minutes', async () => {
    const clockIn = new Date(Date.now() - 95 * 60_000).toISOString()
    attendanceRows = [{ id: 42, site_name: 'Metalex House', customer_name: 'Metalex', clock_in: clockIn }]

    const today = await fetchCleanerToday('c1')

    expect(today.activeShift).not.toBeNull()
    expect(today.activeShift?.attendanceId).toBe(42)
    expect(today.activeShift?.siteName).toBe('Metalex House')
    // allow a minute of slack for clock drift during the test
    expect(today.activeShift?.minutesElapsed).toBeGreaterThanOrEqual(94)
    expect(today.activeShift?.minutesElapsed).toBeLessThanOrEqual(96)
  })

  it('reports no active shift when nothing is open', async () => {
    const today = await fetchCleanerToday('c1')
    expect(today.activeShift).toBeNull()
  })

  it('only ever asks for published shifts', async () => {
    await fetchCleanerToday('c1')

    expect(fetchShiftsInRange).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      expect.objectContaining({ cleanerId: 'c1', publishedOnly: true }),
    )
  })

  it("separates today's shift from the next one", async () => {
    shiftsToReturn = [
      { id: 'today', startAt: atMidnightPlus(18), endAt: atMidnightPlus(22), siteName: 'Metalex' },
      { id: 'later', startAt: atMidnightPlus(9, 3), endAt: atMidnightPlus(13, 3), siteName: 'Sunward' },
    ]

    const today = await fetchCleanerToday('c1')

    expect(today.todayShift?.id).toBe('today')
    expect(today.nextShift?.id).toBe('later')
  })

  it('falls back to nextShift only when nothing is on today', async () => {
    shiftsToReturn = [
      { id: 'later', startAt: atMidnightPlus(9, 2), endAt: atMidnightPlus(13, 2), siteName: 'Sunward' },
    ]

    const today = await fetchCleanerToday('c1')

    expect(today.todayShift).toBeNull()
    expect(today.nextShift?.id).toBe('later')
  })

  it('counts completed tasks whether stored as a JSON string or an array', async () => {
    selectionRows = [
      { id: 1, completed_tasks: '["a","b","c"]' },
      { id: 2, completed_tasks: ['d', 'e'] },
    ]

    const today = await fetchCleanerToday('c1')

    expect(today.areasCompletedToday).toBe(2)
    expect(today.tasksCompletedToday).toBe(5)
  })

  it('treats unparseable or empty task data as zero rather than throwing', async () => {
    selectionRows = [
      { id: 1, completed_tasks: 'not json' },
      { id: 2, completed_tasks: null },
      { id: 3, completed_tasks: '{"not":"an array"}' },
    ]

    const today = await fetchCleanerToday('c1')

    expect(today.areasCompletedToday).toBe(3)
    expect(today.tasksCompletedToday).toBe(0)
  })

  it('surfaces the count of shifts flagged for payroll review', async () => {
    flaggedCount = 4
    const today = await fetchCleanerToday('c1')
    expect(today.flaggedShiftCount).toBe(4)
  })

  it('still returns a usable screen when the roster query fails', async () => {
    vi.mocked(fetchShiftsInRange).mockRejectedValueOnce(new Error('network'))

    const today = await fetchCleanerToday('c1')

    expect(today.todayShift).toBeNull()
    expect(today.nextShift).toBeNull()
  })

  it('propagates an attendance failure instead of showing a false "not clocked in"', async () => {
    attendanceError = { message: 'boom' }
    await expect(fetchCleanerToday('c1')).rejects.toBeTruthy()
  })
})
