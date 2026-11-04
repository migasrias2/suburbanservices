import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The client-facing scope. What matters is what the service ASKS the database
 * for: a manager with no linked customer must trigger no data query at all,
 * and every data query must carry this site's name filter.
 */

type Call = { table: string; ops: Array<[string, unknown[]]> }

const calls: Call[] = []
let tableData: Record<string, unknown[]> = {}
let siteLinks: Array<{ customerId: string | null; label: string; tokens: string[] }> = []

const builder = (table: string) => {
  const call: Call = { table, ops: [] }
  calls.push(call)
  const q: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'is', 'gte', 'lt', 'or', 'order', 'limit']) {
    q[method] = (...args: unknown[]) => {
      call.ops.push([method, args])
      return q
    }
  }
  ;(q as { then: unknown }).then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: tableData[table] ?? [], error: null })
  return q
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => builder(table),
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
  },
}))
vi.mock('./customersService', () => ({ fetchCustomers: vi.fn(async () => tableData.__customers ?? []) }))
vi.mock('./sitesService', () => ({ fetchActiveSites: vi.fn(async () => tableData.__sites ?? []) }))
vi.mock('./qrService', () => ({ AREA_TASKS: {} }))
vi.mock('../lib/managerScope', () => ({ resolveManagerSiteLinks: vi.fn(async () => siteLinks) }))

const { loadSitesForUser, loadSiteSnapshot, loadPhotoSources } = await import('./siteDashboardService')

const dataQueries = () => calls.filter((call) => !['manager_customers', 'uk_customers'].includes(call.table))

beforeEach(() => {
  calls.length = 0
  tableData = {}
  siteLinks = []
})

describe('loadSitesForUser — client logins', () => {
  it('gives a manager with no linked customer no sites, and touches no site data', async () => {
    expect(await loadSitesForUser('manager', 'mgr-1')).toEqual([])
    expect(dataQueries()).toEqual([])
  })

  it('only reads manager_customers for the logged-in manager', async () => {
    await loadSitesForUser('manager', 'mgr-1')
    const linkQuery = calls.find((call) => call.table === 'manager_customers')
    expect(linkQuery?.ops).toContainEqual(['eq', ['manager_id', 'mgr-1']])
  })

  it('builds a site from a scope link, with every spelling of the customer name', async () => {
    siteLinks = [{ customerId: 'cust-seas', label: 'south of england showground', tokens: ['south of england showground'] }]
    tableData.uk_customers = [{ id: 'cust-seas', name: 'SEAS', display_name: 'South of England Showground', address: 'Ardingly' }]
    const sites = await loadSitesForUser('manager', 'mgr-1')
    expect(sites).toEqual([
      {
        key: 'cust-seas',
        customerId: 'cust-seas',
        name: 'South of England Showground',
        matchNames: ['South of England Showground', 'SEAS'],
        address: 'Ardingly',
      },
    ])
  })

  it('still builds the site from the scope label when customer details are unreadable', async () => {
    siteLinks = [{ customerId: 'cust-seas', label: 'south of england showground', tokens: ['south of england showground'] }]
    const [site] = await loadSitesForUser('manager', 'mgr-1')
    expect(site).toMatchObject({ name: 'South Of England Showground', matchNames: ['south of england showground'] })
  })

  it('drops a linked customer it cannot name rather than show it unscoped', async () => {
    tableData.manager_customers = [{ customer_id: 'cust-unknown' }]
    expect(await loadSitesForUser('manager', 'mgr-1')).toEqual([])
  })

  it('gives cleaners and signed-out sessions nothing', async () => {
    expect(await loadSitesForUser('cleaner', 'c-1')).toEqual([])
    expect(await loadSitesForUser(null, null)).toEqual([])
    expect(calls).toEqual([])
  })
})

describe('loadSitesForUser — admin and ops', () => {
  it('lists active customers for admins to choose from', async () => {
    tableData.__customers = [
      { id: 'b', name: 'Beta', display_name: null, is_active: true },
      { id: 'a', name: 'alpha', display_name: 'Alpha Ltd', is_active: true },
      { id: 'z', name: 'Gone', display_name: null, is_active: false },
    ]
    const sites = await loadSitesForUser('admin', 'admin-1')
    expect(sites.map((site) => [site.key, site.name, site.matchNames])).toEqual([
      ['a', 'Alpha Ltd', ['Alpha Ltd', 'alpha']],
      ['b', 'Beta', ['Beta']],
    ])
  })

  it('lists the ops sites for ops managers', async () => {
    tableData.__sites = [{ id: 's1', customerName: 'SEAS', address: null }]
    expect(await loadSitesForUser('ops_manager', 'ops-1')).toEqual([
      { key: 's1', customerId: 's1', name: 'SEAS', matchNames: ['SEAS'], address: null },
    ])
  })
})

describe('loadSiteSnapshot', () => {
  const site = { key: 'cust-seas', customerId: 'cust-seas', name: 'SEAS', matchNames: ['SEAS'], address: null }

  it('sends no query at all for a site with no names', async () => {
    const snapshot = await loadSiteSnapshot({ ...site, matchNames: [] })
    expect(calls).toEqual([])
    expect(snapshot.timeline).toEqual([])
  })

  it('filters every name-bearing query by this site', async () => {
    await loadSiteSnapshot(site)
    for (const table of ['building_qr_codes', 'area_tasks', 'bathroom_assist_requests']) {
      const queries = calls.filter((call) => call.table === table)
      expect(queries.length, table).toBeGreaterThan(0)
      queries.forEach((query) => expect(query.ops, table).toContainEqual(['or', ['customer_name.ilike."SEAS"']]))
    }
    const attendance = calls.find((call) => call.table === 'time_attendance')
    expect(attendance?.ops).toContainEqual(['or', ['customer_name.ilike."SEAS",site_name.ilike."SEAS"']])
  })

  it('does not query cleans or photos when the site has no QR codes', async () => {
    await loadSiteSnapshot(site)
    expect(calls.some((call) => call.table === 'uk_cleaner_task_selections')).toBe(false)
    expect(calls.some((call) => call.table === 'uk_cleaner_task_photos')).toBe(false)
  })

  it("fetches cleans and photo metadata by this site's QR ids only, never photo bytes", async () => {
    tableData.building_qr_codes = [
      { qr_code_id: 'qr-1', customer_name: 'SEAS', building_area: 'Rank Lodge', area_description: null, qr_code_url: null, is_active: true },
    ]
    await loadSiteSnapshot(site)
    const selections = calls.find((call) => call.table === 'uk_cleaner_task_selections')
    const photos = calls.find((call) => call.table === 'uk_cleaner_task_photos')
    expect(selections?.ops).toContainEqual(['in', ['qr_code_id', ['qr-1']]])
    expect(photos?.ops).toContainEqual(['in', ['qr_code_id', ['qr-1']]])
    const photoColumns = photos?.ops.find(([method]) => method === 'select')?.[1][0] as string
    expect(photoColumns).not.toContain('photo_data')
  })
})

describe('loadPhotoSources', () => {
  it('asks for nothing when given nothing', async () => {
    expect(await loadPhotoSources([])).toEqual({})
    expect(calls).toEqual([])
  })

  it('falls back to inline base64 when a photo has no storage path', async () => {
    tableData.uk_cleaner_task_photos = [{ id: 7, photo_data: 'data:image/jpeg;base64,AAA', storage_path: null }]
    expect(await loadPhotoSources([7])).toEqual({ 7: 'data:image/jpeg;base64,AAA' })
  })
})
