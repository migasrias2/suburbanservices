import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The client-facing scope and the row caps. What matters is what the service
 * ASKS the database for: a manager with no linked customer triggers no data
 * query, every data query carries this site's filter, a failed lookup is an
 * error rather than "no site", and a day bigger than one page is read whole.
 */

type Call = { table: string; ops: Array<[string, unknown[]]> }

const calls: Call[] = []
let tableData: Record<string, unknown[]> = {}
let tableErrors: Record<string, { message: string }> = {}
let siteLinks: Array<{ customerId: string | null; label: string; tokens: string[] }> = []
let scopeLoaded = true

const builder = (table: string) => {
  const call: Call = { table, ops: [] }
  calls.push(call)
  const q: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'is', 'gte', 'lt', 'or', 'order', 'limit', 'range']) {
    q[method] = (...args: unknown[]) => {
      call.ops.push([method, args])
      return q
    }
  }
  ;(q as { then: unknown }).then = (resolve: (value: unknown) => unknown) => {
    if (tableErrors[table]) return resolve({ data: null, error: tableErrors[table] })
    const rows = tableData[table] ?? []
    // Behave like PostgREST: .range(from, to) returns that slice and nothing more.
    const range = call.ops.find(([method]) => method === 'range')?.[1] as [number, number] | undefined
    return resolve({ data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null })
  }
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
vi.mock('../lib/managerScope', () => ({
  resolveManagerSiteLinks: vi.fn(async () => ({ links: siteLinks, loaded: scopeLoaded })),
}))

const { loadSitesForUser, loadSiteSnapshot, loadPhotoSources, PAGE_SIZE } = await import('./siteDashboardService')

const dataQueries = () => calls.filter((call) => !['manager_customers', 'uk_customers'].includes(call.table))
const SEAS_LINK = { customerId: 'cust-seas', label: 'south of england showground', tokens: ['south of england showground'] }

beforeEach(() => {
  calls.length = 0
  tableData = {}
  tableErrors = {}
  siteLinks = []
  scopeLoaded = true
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
    siteLinks = [SEAS_LINK]
    tableData.uk_customers = [{ id: 'cust-seas', name: 'SEAS', display_name: 'South of England Showground', address: 'Ardingly' }]
    expect(await loadSitesForUser('manager', 'mgr-1')).toEqual([
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
    siteLinks = [SEAS_LINK]
    tableErrors.uk_customers = { message: 'timeout' }
    const [site] = await loadSitesForUser('manager', 'mgr-1')
    expect(site).toMatchObject({ name: 'South Of England Showground', matchNames: ['south of england showground'] })
  })

  it('throws, rather than saying "no site", when both lookups fail', async () => {
    scopeLoaded = false
    tableErrors.manager_customers = { message: 'Failed to fetch' }
    await expect(loadSitesForUser('manager', 'mgr-1')).rejects.toThrow(/Could not load your sites/)
  })

  it('carries on with the direct read when only the scope RPC fails', async () => {
    scopeLoaded = false
    tableData.manager_customers = [{ customer_id: 'cust-seas' }]
    tableData.uk_customers = [{ id: 'cust-seas', name: 'SEAS', display_name: null, address: null }]
    expect((await loadSitesForUser('manager', 'mgr-1')).map((site) => site.key)).toEqual(['cust-seas'])
  })

  it('carries on with the scope RPC when only the direct read fails', async () => {
    siteLinks = [SEAS_LINK]
    tableErrors.manager_customers = { message: 'permission denied' }
    expect((await loadSitesForUser('manager', 'mgr-1')).map((site) => site.key)).toEqual(['cust-seas'])
  })

  it('throws when a linked customer cannot be named because its details failed to load', async () => {
    tableData.manager_customers = [{ customer_id: 'cust-seas' }]
    tableErrors.uk_customers = { message: 'timeout' }
    await expect(loadSitesForUser('manager', 'mgr-1')).rejects.toThrow(/Could not load your sites/)
  })

  it('drops a linked customer whose row genuinely has no name', async () => {
    tableData.manager_customers = [{ customer_id: 'cust-blank' }]
    tableData.uk_customers = [{ id: 'cust-blank', name: null, display_name: null, address: null }]
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
  const NOW = new Date(Date.UTC(2026, 10, 1, 14, 52))
  const seasQr = { qr_code_id: 'qr-1', customer_name: 'SEAS', building_area: 'Rank Lodge', area_description: null, qr_code_url: null, is_active: true }

  it('sends no query at all for a site with no names', async () => {
    const snapshot = await loadSiteSnapshot({ ...site, matchNames: [] }, NOW)
    expect(calls).toEqual([])
    expect(snapshot.timeline).toEqual([])
  })

  it('filters every name-bearing query by this site', async () => {
    await loadSiteSnapshot(site, NOW)
    for (const table of ['building_qr_codes', 'area_tasks', 'bathroom_assist_requests']) {
      const queries = calls.filter((call) => call.table === table)
      expect(queries.length, table).toBeGreaterThan(0)
      queries.forEach((query) => expect(query.ops, table).toContainEqual(['or', ['customer_name.ilike."SEAS"']]))
    }
    const attendance = calls.find((call) => call.table === 'time_attendance')
    expect(attendance?.ops).toContainEqual(['or', ['customer_name.ilike."SEAS",site_name.ilike."SEAS"']])
  })

  it('asks for open requests newest first, so the cap drops the stalest', async () => {
    await loadSiteSnapshot(site, NOW)
    const open = calls.find(
      (call) => call.table === 'bathroom_assist_requests' && call.ops.some(([method]) => method === 'in'),
    )
    expect(open?.ops).toContainEqual(['order', ['reported_at', { ascending: false }]])
  })

  it('does not query cleans or photos when the site has no QR codes', async () => {
    await loadSiteSnapshot(site, NOW)
    expect(calls.some((call) => call.table === 'uk_cleaner_task_selections')).toBe(false)
    expect(calls.some((call) => call.table === 'uk_cleaner_task_photos')).toBe(false)
  })

  it("fetches cleans and photo metadata by this site's QR ids only, never photo bytes", async () => {
    tableData.building_qr_codes = [seasQr]
    await loadSiteSnapshot(site, NOW)
    const selections = calls.find((call) => call.table === 'uk_cleaner_task_selections')
    const photos = calls.find((call) => call.table === 'uk_cleaner_task_photos')
    expect(selections?.ops).toContainEqual(['in', ['qr_code_id', ['qr-1']]])
    expect(photos?.ops).toContainEqual(['in', ['qr_code_id', ['qr-1']]])
    const photoColumns = photos?.ops.find(([method]) => method === 'select')?.[1][0] as string
    expect(photoColumns).not.toContain('photo_data')
  })

  it('reads every photo and clean of a day bigger than one page, newest first', async () => {
    const total = PAGE_SIZE * 2 + 300
    const minuteMs = 60_000
    const startMs = Date.UTC(2026, 10, 1, 6, 0)
    tableData.building_qr_codes = [seasQr]
    // Newest first, the order the service asks for.
    tableData.uk_cleaner_task_photos = Array.from({ length: total }, (_, index) => ({
      id: total - index,
      cleaner_id: 'c1',
      cleaner_name: 'Toyeeb Atunde',
      qr_code_id: 'qr-1',
      task_id: null,
      photo_timestamp: new Date(startMs + (total - index) * 10_000).toISOString(),
    }))
    tableData.uk_cleaner_task_selections = Array.from({ length: PAGE_SIZE + 5 }, (_, index) => ({
      id: PAGE_SIZE + 5 - index,
      cleaner_id: 'c1',
      cleaner_name: 'Toyeeb Atunde',
      qr_code_id: 'qr-1',
      area_type: 'BATHROOMS_ABLUTIONS',
      selected_tasks: '[]',
      completed_tasks: '[]',
      timestamp: new Date(startMs + (PAGE_SIZE + 5 - index) * 25_000 + minuteMs).toISOString(),
    }))

    const snapshot = await loadSiteSnapshot(site, NOW)

    expect(snapshot.kpis.photos).toBe(total)
    expect(snapshot.kpis.cleansCompleted).toBe(PAGE_SIZE + 5)
    const photoQueries = calls.filter((call) => call.table === 'uk_cleaner_task_photos')
    expect(photoQueries.map((call) => call.ops.find(([method]) => method === 'range')?.[1])).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, PAGE_SIZE * 2 - 1],
      [PAGE_SIZE * 2, PAGE_SIZE * 3 - 1],
    ])
    expect(photoQueries[0].ops).toContainEqual(['order', ['photo_timestamp', { ascending: false }]])
    // The latest photo of the day is there: nothing late in the day fell off a cap.
    expect(snapshot.photos.some((photo) => photo.id === total)).toBe(true)
  })

  it('reads cleans from before midnight when a shift spans it, but counts only today', async () => {
    tableData.building_qr_codes = [seasQr]
    const justAfterMidnight = new Date(Date.UTC(2026, 10, 2, 0, 30))
    await loadSiteSnapshot(site, justAfterMidnight)
    const selections = calls.find((call) => call.table === 'uk_cleaner_task_selections')
    const since = selections?.ops.find(([method]) => method === 'gte')?.[1][1] as string
    expect(new Date(since).getTime()).toBe(justAfterMidnight.getTime() - 12 * 3600_000)
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
