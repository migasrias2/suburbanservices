import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installTestLocalStorage } from '../test/localStorage'

/**
 * resolveManagerSiteLinks feeds the client-facing site dashboard, so unlike
 * resolveManagerCustomerScope it must answer only for the manager id it is
 * given and never borrow another client's scope by display name.
 */

let rpcRows: unknown[] = []
let rpcError: { message: string } | null = null

vi.mock('../services/supabase', () => ({
  supabase: { rpc: vi.fn(async () => ({ data: rpcRows, error: rpcError })) },
}))

const { resolveManagerSiteLinks, invalidateManagerScopes } = await import('./managerScope')

beforeEach(() => {
  invalidateManagerScopes()
  rpcRows = []
  rpcError = null
})

describe('resolveManagerSiteLinks', () => {
  it('returns only the links for the given manager', async () => {
    rpcRows = [
      { manager_id: 'mgr-seas', customer_id: 'cust-seas', customer_label: 'South of England Showground' },
      { manager_id: 'mgr-other', customer_id: 'cust-other', customer_label: 'Other Client' },
    ]
    expect(await resolveManagerSiteLinks('mgr-seas')).toEqual([
      { customerId: 'cust-seas', label: 'south of england showground', tokens: ['south of england showground'] },
    ])
  })

  it('returns nothing, not everything, for a manager with no links', async () => {
    rpcRows = [{ manager_id: 'mgr-other', customer_id: 'cust-other', customer_label: 'Other Client' }]
    expect(await resolveManagerSiteLinks('mgr-new')).toEqual([])
  })

  it('returns nothing without an id', async () => {
    expect(await resolveManagerSiteLinks('')).toEqual([])
    expect(await resolveManagerSiteLinks(null)).toEqual([])
  })

  it('returns nothing when the scope lookup fails', async () => {
    rpcError = { message: 'permission denied' }
    expect(await resolveManagerSiteLinks('mgr-seas')).toEqual([])
  })

  it('keeps the legacy hardcoded scopes, matched by id only', async () => {
    expect(await resolveManagerSiteLinks('df0bf2e7-1a07-4876-949c-6cfe8fe0fac6')).toEqual([
      { customerId: null, label: 'avtrade', tokens: ['avtrade'] },
    ])
  })

  it('does not hand a manager called James the PSM scope by name', async () => {
    // A real Storage, or the stale name below would silently never be seeded.
    installTestLocalStorage().setItem('userName', 'James Someone')
    expect(localStorage.getItem('userName')).toBe('James Someone')
    expect(await resolveManagerSiteLinks('mgr-james-at-another-client')).toEqual([])
  })
})
