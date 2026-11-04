import { describe, it, expect, vi, beforeEach } from 'vitest'
import { installTestLocalStorage } from '@/test/localStorage'

/**
 * A client login ('manager') must fail closed: any gap in its links, or any
 * failure to load them, resolves to "show nothing". On 2026-11-04 the
 * Showground client reported seeing more than its own site because every one
 * of these gaps used to widen the view to the whole company.
 */

type Call = { table: string; method: string; args: unknown[] }

const calls: Call[] = []
let scopeRows: unknown[] = []
let scopeError: { message: string } | null = null
let managerCleanerRows: unknown[] = []
let managerCleanerError: { message: string } | null = null

const makeQuery = (table: string) => {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order']) {
    q[m] = (...args: unknown[]) => {
      calls.push({ table, method: m, args })
      return q
    }
  }
  ;(q as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve(
      table === 'manager_cleaners'
        ? { data: managerCleanerRows, error: managerCleanerError }
        : { data: [], error: null },
    )
  return q
}

const rpc = vi.fn(async (name: string) => {
  calls.push({ table: 'rpc', method: name, args: [] })
  if (name === 'admin_list_manager_customer_scopes') {
    return { data: scopeError ? null : scopeRows, error: scopeError }
  }
  return { data: null, error: null }
})

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      calls.push({ table, method: 'from', args: [] })
      return makeQuery(table)
    },
    rpc: (name: string) => rpc(name),
  },
}))

const { resolveManagerAccess } = await import('./managerAccessService')
const { invalidateManagerScopes } = await import('../lib/managerScope')

const LINKED = '11111111-1111-4111-8111-111111111111'
// Legacy hardcoded scopes in src/lib/managerScope.ts.
const AVTRADE = 'df0bf2e7-1a07-4876-949c-6cfe8fe0fac6'
const PSM = 'ce2c8d1a-6e0a-4d78-9746-2cd32983455f'

const showgroundScope = [
  { manager_id: LINKED, customer_id: 'cust-1', customer_label: 'South of England Showground' },
]

describe('resolveManagerAccess', () => {
  beforeEach(() => {
    calls.length = 0
    rpc.mockClear()
    scopeRows = []
    scopeError = null
    managerCleanerRows = []
    managerCleanerError = null
    installTestLocalStorage()
    invalidateManagerScopes()
  })

  it('gives admin global access without looking anything up', async () => {
    await expect(resolveManagerAccess({ role: 'admin', managerId: 'a1' })).resolves.toEqual({ status: 'global' })
    expect(calls).toEqual([])
  })

  it('gives ops_manager global access without looking anything up', async () => {
    await expect(resolveManagerAccess({ role: 'ops_manager', managerId: 'o1' })).resolves.toEqual({
      status: 'global',
    })
    expect(calls).toEqual([])
  })

  it('scopes a linked client login to its own clients and cleaners', async () => {
    scopeRows = showgroundScope
    managerCleanerRows = [{ cleaner_id: 'c1' }, { cleaner_id: 'c2' }]

    await expect(resolveManagerAccess({ role: 'manager', managerId: LINKED })).resolves.toEqual({
      status: 'scoped',
      cleanerIds: ['c1', 'c2'],
      customerTokens: ['south of england showground'],
    })
  })

  it('shows nothing to a client login with no client assigned', async () => {
    managerCleanerRows = [{ cleaner_id: 'c1' }]

    await expect(resolveManagerAccess({ role: 'manager', managerId: LINKED })).resolves.toEqual({
      status: 'unlinked',
      reason: 'no_customers',
    })
  })

  it('scopes a client with a site but no cleaner links by client name alone', async () => {
    scopeRows = showgroundScope
    managerCleanerRows = []

    await expect(resolveManagerAccess({ role: 'manager', managerId: LINKED })).resolves.toEqual({
      status: 'scoped',
      cleanerIds: [],
      customerTokens: ['south of england showground'],
    })
  })

  it('keeps a legacy hardcoded client (AvTrade) with no DB rows working', async () => {
    await expect(resolveManagerAccess({ role: 'manager', managerId: AVTRADE })).resolves.toEqual({
      status: 'scoped',
      cleanerIds: [],
      customerTokens: ['avtrade'],
    })
  })

  it('scopes a legacy hardcoded client (PSM) by its hardcoded clients when the scope lookup fails', async () => {
    scopeError = { message: 'timeout' }

    await expect(resolveManagerAccess({ role: 'manager', managerId: PSM })).resolves.toEqual({
      status: 'scoped',
      cleanerIds: [],
      customerTokens: ['psm marine', 'psm'],
    })
  })

  it('no longer grants PSM scope to any login whose name contains "james"', async () => {
    await expect(
      resolveManagerAccess({ role: 'manager', managerId: LINKED, managerName: 'James Somebody' }),
    ).resolves.toEqual({ status: 'unlinked', reason: 'no_customers' })
  })

  it('shows nothing when the cleaner links cannot be loaded', async () => {
    scopeRows = showgroundScope
    managerCleanerError = { message: 'network down' }

    await expect(resolveManagerAccess({ role: 'manager', managerId: LINKED })).resolves.toEqual({
      status: 'unlinked',
      reason: 'lookup_failed',
    })
  })

  it('shows nothing to a non-legacy client when the client scopes cannot be loaded, and retries next time', async () => {
    scopeError = { message: 'timeout' }
    managerCleanerRows = [{ cleaner_id: 'c1' }]

    await expect(resolveManagerAccess({ role: 'manager', managerId: LINKED })).resolves.toEqual({
      status: 'unlinked',
      reason: 'lookup_failed',
    })

    scopeError = null
    scopeRows = showgroundScope

    await expect(resolveManagerAccess({ role: 'manager', managerId: LINKED })).resolves.toMatchObject({
      status: 'scoped',
    })
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('shows nothing to a client login with no id', async () => {
    await expect(resolveManagerAccess({ role: 'manager', managerId: '  ' })).resolves.toEqual({
      status: 'unlinked',
      reason: 'lookup_failed',
    })
    expect(calls).toEqual([])
  })
})
