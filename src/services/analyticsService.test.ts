import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The analytics page and the dashboard KPI cards used to swap a client login
 * with no linked cleaners onto the full company roster. They must report
 * nothing instead, without fetching anyone else's shifts or photos.
 */

type Call = { table: string; method: string; args: unknown[] }

const calls: Call[] = []
let managerCleanerRows: unknown[] = []

const makeQuery = (table: string) => {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order']) {
    q[m] = (...args: unknown[]) => {
      calls.push({ table, method: m, args })
      return q
    }
  }
  ;(q as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: table === 'manager_cleaners' ? managerCleanerRows : [], error: null })
  return q
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      calls.push({ table, method: 'from', args: [] })
      return makeQuery(table)
    },
    rpc: async () => ({ data: [], error: null }),
  },
}))

vi.mock('./photoStorageService', () => ({
  signTaskPhotoPaths: async () => ({}),
}))

const { fetchAnalyticsSummary, fetchDashboardSnapshot } = await import('./analyticsService')

const UNMAPPED = '22222222-2222-4222-8222-222222222222'
const range = { start: '2026-10-01T00:00:00.000Z', end: '2026-10-31T23:59:59.999Z' }
const tablesQueried = () => calls.filter((c) => c.method === 'from').map((c) => c.table)

describe('analytics for client logins fail closed', () => {
  beforeEach(() => {
    calls.length = 0
    managerCleanerRows = []
  })

  it('summary is empty for a client login with no linked cleaners', async () => {
    const summary = await fetchAnalyticsSummary({ managerId: UNMAPPED, role: 'manager', range })

    expect(summary.roster).toEqual([])
    expect(summary.onTimeByCleaner).toEqual([])
    expect(summary.totals.totalHoursWorked).toBe(0)
    expect(tablesQueried()).toEqual(['manager_cleaners'])
  })

  it('snapshot is empty for a client login with no linked cleaners', async () => {
    const snapshot = await fetchDashboardSnapshot({
      managerId: UNMAPPED,
      role: 'manager',
      dayIso: '2026-10-15',
      customerScope: ['showground'],
    })

    expect(snapshot).toMatchObject({ attendanceCount: 0, photosTaken: 0, areasCleaned: 0, hoursWorked: 0 })
    expect(tablesQueried()).not.toContain('time_attendance')
  })

  it('snapshot is empty for a client login with cleaners but no client assigned', async () => {
    managerCleanerRows = [{ cleaner_id: 'c1' }]

    const snapshot = await fetchDashboardSnapshot({
      managerId: UNMAPPED,
      role: 'manager',
      dayIso: '2026-10-15',
      customerScope: [],
    })

    expect(snapshot.attendanceCount).toBe(0)
    expect(tablesQueried()).not.toContain('time_attendance')
  })

  it('admin summary still reads the whole roster', async () => {
    await fetchAnalyticsSummary({ managerId: null, role: 'admin', range })

    expect(tablesQueried()).toContain('cleaners')
    expect(tablesQueried()).toContain('time_attendance')
    expect(tablesQueried()).not.toContain('manager_cleaners')
  })
})
