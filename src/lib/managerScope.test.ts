import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installTestLocalStorage } from '../test/localStorage'

/**
 * resolveManagerSiteLinks feeds the client-facing site dashboard, so unlike
 * resolveManagerCustomerScope it must answer only for the manager id it is
 * given, never borrow another client's scope by display name, and say
 * whether it actually got an answer.
 */

let rpcRows: unknown[] = []
let rpcError: { message: string } | null = null
const rpc = vi.fn(async () => ({ data: rpcRows, error: rpcError }))

vi.mock('../services/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...(args as [])) } }))

const { resolveManagerSiteLinks, invalidateManagerScopes } = await import('./managerScope')

beforeEach(() => {
  invalidateManagerScopes()
  rpcRows = []
  rpcError = null
  rpc.mockClear()
})

describe('resolveManagerSiteLinks', () => {
  it('returns only the links for the given manager', async () => {
    rpcRows = [
      { manager_id: 'mgr-seas', customer_id: 'cust-seas', customer_label: 'South of England Showground' },
      { manager_id: 'mgr-other', customer_id: 'cust-other', customer_label: 'Other Client' },
    ]
    expect(await resolveManagerSiteLinks('mgr-seas')).toEqual({
      links: [{ customerId: 'cust-seas', label: 'south of england showground', tokens: ['south of england showground'] }],
      loaded: true,
    })
  })

  it('returns nothing, not everything, for a manager with no links, and says the lookup answered', async () => {
    rpcRows = [{ manager_id: 'mgr-other', customer_id: 'cust-other', customer_label: 'Other Client' }]
    expect(await resolveManagerSiteLinks('mgr-new')).toEqual({ links: [], loaded: true })
  })

  it('returns nothing without an id', async () => {
    expect(await resolveManagerSiteLinks('')).toEqual({ links: [], loaded: true })
    expect(await resolveManagerSiteLinks(null)).toEqual({ links: [], loaded: true })
  })

  it('reports a failed lookup as not loaded, so "nothing linked" is never claimed', async () => {
    rpcError = { message: 'permission denied' }
    expect(await resolveManagerSiteLinks('mgr-seas')).toEqual({ links: [], loaded: false })
  })

  it('retries a failed lookup instead of trusting the cached failure', async () => {
    rpcError = { message: 'network' }
    await resolveManagerSiteLinks('mgr-seas')
    rpcError = null
    rpcRows = [{ manager_id: 'mgr-seas', customer_id: 'cust-seas', customer_label: 'SEAS' }]
    const result = await resolveManagerSiteLinks('mgr-seas')
    expect(result.loaded).toBe(true)
    expect(result.links.map((link) => link.customerId)).toEqual(['cust-seas'])
  })

  it('keeps the legacy hardcoded scopes, matched by id only', async () => {
    expect(await resolveManagerSiteLinks('df0bf2e7-1a07-4876-949c-6cfe8fe0fac6')).toEqual({
      links: [{ customerId: null, label: 'avtrade', tokens: ['avtrade'] }],
      loaded: true,
    })
  })

  it('does not hand a manager called James the PSM scope by name', async () => {
    // A real Storage, or the stale name below would silently never be seeded.
    installTestLocalStorage().setItem('userName', 'James Someone')
    expect(localStorage.getItem('userName')).toBe('James Someone')
    expect(await resolveManagerSiteLinks('mgr-james-at-another-client')).toEqual({ links: [], loaded: true })
  })
})
