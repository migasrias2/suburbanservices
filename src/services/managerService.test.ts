import { describe, it, expect, vi, beforeEach } from 'vitest'
import { installTestLocalStorage } from '@/test/localStorage'

/**
 * Client logins ('manager') used to fall back to the whole company's data
 * whenever their cleaner links were missing or failed to load. These pin the
 * fail-closed behaviour of the shared lookups, and that the roster delete
 * helper -- which removed ~22 cleaners on 2026-11-01 -- is gone.
 */

type Call = { table: string; method: string; args: unknown[] }

const calls: Call[] = []
let scopeRows: unknown[] = []
let managerCleanerRows: unknown[] = []
let managerCleanerError: { message: string } | null = null
let tableRows: Record<string, unknown[]> = {}

const makeQuery = (table: string) => {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'or', 'gte', 'order', 'limit']) {
    q[m] = (...args: unknown[]) => {
      calls.push({ table, method: m, args })
      return q
    }
  }
  ;(q as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve(
      table === 'manager_cleaners'
        ? { data: managerCleanerRows, error: managerCleanerError }
        : { data: tableRows[table] ?? [], error: null },
    )
  return q
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      calls.push({ table, method: 'from', args: [] })
      return makeQuery(table)
    },
    rpc: async (name: string) =>
      name === 'admin_list_manager_customer_scopes'
        ? { data: scopeRows, error: null }
        : { data: null, error: null },
  },
}))

vi.mock('./photoStorageService', () => ({
  signTaskPhotoPaths: async () => ({}),
}))

const managerService = await import('./managerService')
const { invalidateManagerScopes } = await import('../lib/managerScope')
const { fetchManagerCleanerIds, fetchManagerRecentActivity } = managerService

const LINKED = '11111111-1111-4111-8111-111111111111'
const AVTRADE = 'df0bf2e7-1a07-4876-949c-6cfe8fe0fac6'
const tablesQueried = () => calls.filter((c) => c.method === 'from').map((c) => c.table)

describe('managerService fail-closed lookups', () => {
  beforeEach(() => {
    calls.length = 0
    scopeRows = []
    managerCleanerRows = []
    managerCleanerError = null
    tableRows = {}
    installTestLocalStorage()
    invalidateManagerScopes()
  })

  it('no longer exports the roster delete helpers', () => {
    expect('deleteCleaner' in managerService).toBe(false)
    expect('removeCleanerFromManager' in managerService).toBe(false)
    expect('resolveManagerCleanerRoster' in managerService).toBe(false)
  })

  it('fetchManagerCleanerIds throws when the lookup fails instead of guessing', async () => {
    managerCleanerError = { message: 'network down' }
    await expect(fetchManagerCleanerIds(LINKED)).rejects.toMatchObject({ message: 'network down' })
  })

  it('recent activity is empty for a client login with no client assigned', async () => {
    managerCleanerRows = [{ cleaner_id: 'c1' }]

    await expect(fetchManagerRecentActivity(LINKED, 40, 'manager')).resolves.toEqual([])
    expect(tablesQueried()).not.toContain('uk_cleaner_task_selections')
    expect(tablesQueried()).not.toContain('uk_cleaner_task_photos')
  })

  it('recent activity for a legacy client with no cleaner links is filtered by client name', async () => {
    tableRows = {
      uk_cleaner_task_selections: [
        { id: 1, cleaner_id: 'c1', cleaner_name: 'Mosleen', qr_code_id: 'q-av', area_type: 'office', selected_tasks: '[]', completed_tasks: '[]', timestamp: '2026-11-03T09:00:00Z' },
        { id: 2, cleaner_id: 'c2', cleaner_name: 'Bob', qr_code_id: 'q-other', area_type: 'office', selected_tasks: '[]', completed_tasks: '[]', timestamp: '2026-11-03T10:00:00Z' },
      ],
      building_qr_codes: [
        { qr_code_id: 'q-av', customer_name: 'AvTrade', building_area: 'Reception' },
        { qr_code_id: 'q-other', customer_name: 'OtherCo', building_area: 'Reception' },
      ],
    }

    const rows = await fetchManagerRecentActivity(AVTRADE, 40, 'manager')

    expect(rows.map((row) => row.site)).toEqual(['AvTrade'])
    expect(calls.some((c) => c.table === 'uk_cleaner_task_selections' && c.method === 'in')).toBe(false)
  })

  it('recent activity errors for a client login whose cleaner links fail to load', async () => {
    scopeRows = [{ manager_id: LINKED, customer_id: 'cust-1', customer_label: 'Showground' }]
    managerCleanerError = { message: 'network down' }

    await expect(fetchManagerRecentActivity(LINKED, 40, 'manager')).rejects.toBeTruthy()
    expect(tablesQueried()).not.toContain('uk_cleaner_task_photos')
  })

  it('recent activity for a linked client login is filtered to its cleaners at the query', async () => {
    scopeRows = [{ manager_id: LINKED, customer_id: 'cust-1', customer_label: 'Showground' }]
    managerCleanerRows = [{ cleaner_id: 'c1' }]

    await fetchManagerRecentActivity(LINKED, 40, 'manager')

    const photoFilters = calls.filter((c) => c.table === 'uk_cleaner_task_photos' && c.method === 'in')
    expect(photoFilters).toEqual([{ table: 'uk_cleaner_task_photos', method: 'in', args: ['cleaner_id', ['c1']] }])
  })

  it('recent activity for ops_manager stays global', async () => {
    await fetchManagerRecentActivity('ops-1', 40, 'ops_manager')

    expect(tablesQueried()).toContain('uk_cleaner_task_photos')
    expect(calls.some((c) => c.table === 'uk_cleaner_task_photos' && c.method === 'in')).toBe(false)
  })
})
