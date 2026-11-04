import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The analytics page and the dashboard KPI cards used to swap a client login
 * with no linked cleaners onto the full company roster. They must report
 * nothing instead, without fetching anyone else's shifts or photos.
 */

type Call = { table: string; method: string; args: unknown[] }

const calls: Call[] = []
let managerCleanerRows: unknown[] = []
let tableRows: Record<string, unknown[]> = {}

const makeQuery = (table: string) => {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'gte', 'lte', 'order']) {
    q[m] = (...args: unknown[]) => {
      calls.push({ table, method: m, args })
      return q
    }
  }
  ;(q as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: table === 'manager_cleaners' ? managerCleanerRows : tableRows[table] ?? [], error: null })
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
    tableRows = {}
  })

  it('summary is empty for a client login with no linked cleaners', async () => {
    const summary = await fetchAnalyticsSummary({ managerId: UNMAPPED, role: 'manager', range })

    expect(summary.roster).toEqual([])
    expect(summary.onTimeByCleaner).toEqual([])
    expect(summary.totals.totalHoursWorked).toBe(0)
    expect(tablesQueried()).toEqual(['manager_cleaners'])
  })

  it('snapshot for a client with no cleaner links counts only its own site', async () => {
    tableRows = {
      time_attendance: [
        { id: 1, cleaner_uuid: 'c1', cleaner_name: 'Mosleen', customer_name: 'AvTrade', site_name: 'AvTrade', clock_in: '2026-10-15T08:30:00', clock_out: '2026-10-15T16:00:00' },
        { id: 2, cleaner_uuid: 'c2', cleaner_name: 'Bob', customer_name: 'OtherCo', site_name: 'OtherCo', clock_in: '2026-10-15T08:30:00', clock_out: '2026-10-15T16:00:00' },
      ],
      uk_cleaner_task_photos: [
        { id: 1, cleaner_id: 'c1', qr_code_id: 'q-av', photo_timestamp: '2026-10-15T09:00:00' },
        { id: 2, cleaner_id: 'c2', qr_code_id: 'q-other', photo_timestamp: '2026-10-15T09:00:00' },
      ],
      building_qr_codes: [
        { qr_code_id: 'q-av', customer_name: 'AvTrade' },
        { qr_code_id: 'q-other', customer_name: 'OtherCo' },
      ],
    }

    const snapshot = await fetchDashboardSnapshot({
      managerId: UNMAPPED,
      role: 'manager',
      dayIso: '2026-10-15',
      customerScope: ['avtrade'],
    })

    expect(snapshot.attendanceCount).toBe(1)
    expect(snapshot.photosTaken).toBe(1)
    expect(snapshot.hoursBreakdown?.map((row) => row.siteName)).toEqual(['AvTrade'])
  })

  it('summary for a client with no cleaner links counts only its own site', async () => {
    tableRows = {
      time_attendance: [
        { id: 1, cleaner_uuid: 'c1', cleaner_name: 'Mosleen', customer_name: 'AvTrade', site_name: 'AvTrade', clock_in: '2026-10-15T08:30:00Z', clock_out: '2026-10-15T16:00:00Z' },
        { id: 2, cleaner_uuid: 'c2', cleaner_name: 'Bob', customer_name: 'OtherCo', site_name: 'OtherCo', clock_in: '2026-10-15T08:30:00Z', clock_out: '2026-10-15T16:00:00Z' },
      ],
    }

    const summary = await fetchAnalyticsSummary({ managerId: UNMAPPED, role: 'manager', range, customerScope: ['avtrade'] })

    expect(summary.trend.reduce((total, point) => total + point.total, 0)).toBe(1)
    expect(summary.totals.totalHoursWorked).toBe(7.5)
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
