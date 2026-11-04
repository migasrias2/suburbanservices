import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { installTestLocalStorage } from '@/test/localStorage'

/**
 * Client report, South of England Showground, 2026-11-04:
 *   1. The roster Delete button removed ~22 cleaner accounts on 1 November.
 *   2. A client login could see more than its own site.
 *
 * These drive the real access resolution and roster loading against a fake
 * Supabase client, so "unlinked" means what it means in production: no
 * manager_customers scope, no manager_cleaners rows, or a failed lookup.
 */

type Call = { table: string; method: string; args: unknown[] }

const calls: Call[] = []
let scopeRows: unknown[] = []
let managerCleanerRows: Record<string, unknown[]> = {}
let managerCleanerError: { message: string } | null = null

const CLEANERS = [
  { id: 'c-linked', first_name: 'Alice', last_name: 'Linked', created_at: '2026-01-01T00:00:00Z', email: null, mobile_number: null, is_active: true },
  { id: 'c-other', first_name: 'Bob', last_name: 'Otherclient', created_at: '2026-01-01T00:00:00Z', email: null, mobile_number: null, is_active: true },
]

const LINKED = '11111111-1111-4111-8111-111111111111'
const UNLINKED = '22222222-2222-4222-8222-222222222222'
const ADMIN = '33333333-3333-4333-8333-333333333333'

const makeQuery = (table: string) => {
  const filters: Array<{ method: string; args: unknown[] }> = []
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'or', 'ilike', 'gte', 'lt', 'lte', 'order', 'limit', 'upsert', 'delete']) {
    q[m] = (...args: unknown[]) => {
      calls.push({ table, method: m, args })
      filters.push({ method: m, args })
      return q
    }
  }
  const resolveRows = () => {
    if (table === 'manager_cleaners') {
      if (managerCleanerError) return { data: null, error: managerCleanerError }
      const managerId = filters.find((f) => f.method === 'eq')?.args[1] as string
      return { data: managerCleanerRows[managerId] ?? [], error: null }
    }
    if (table === 'cleaners') {
      const inFilter = filters.find((f) => f.method === 'in')
      const ids = inFilter ? (inFilter.args[1] as string[]) : null
      return { data: ids ? CLEANERS.filter((c) => ids.includes(c.id)) : CLEANERS, error: null }
    }
    return { data: [], error: null }
  }
  ;(q as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(resolveRows())
  return q
}

vi.mock('../../services/supabase', () => ({
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

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

vi.mock('@/components/ui/sidebar', () => ({ SidebarTrigger: () => null }))

vi.mock('../../services/photoStorageService', () => ({ signTaskPhotoPaths: async () => ({}) }))
vi.mock('@/services/photoStorageService', () => ({ signTaskPhotoPaths: async () => ({}) }))

vi.mock('../../services/assistRequestService', () => ({
  AssistRequestService: {
    listRecent: vi.fn(async () => []),
    listResolved: vi.fn(async () => []),
    resolveAsManager: vi.fn(),
    hideResolvedForManager: vi.fn(),
  },
}))

const { ManagerDashboard } = await import('./ManagerDashboard')
const { invalidateManagerScopes } = await import('../../lib/managerScope')
const { UNLINKED_TITLE, LOOKUP_FAILED_TITLE } = await import('./ManagerAccessGate')

const renderDashboard = (role: 'manager' | 'ops_manager' | 'admin', managerId: string) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ManagerDashboard managerId={managerId} managerName="Test Login" role={role} />
    </QueryClientProvider>,
  )
}

const tablesQueried = () => calls.filter((c) => c.method === 'from').map((c) => c.table)

describe('ManagerDashboard roster', () => {
  beforeEach(() => {
    installTestLocalStorage()
    invalidateManagerScopes()
    calls.length = 0
    scopeRows = [{ manager_id: LINKED, customer_id: 'cust-1', customer_label: 'South of England Showground' }]
    managerCleanerRows = { [LINKED]: [{ cleaner_id: 'c-linked' }] }
    managerCleanerError = null
  })

  it('admin sees every cleaner and no Delete button', async () => {
    renderDashboard('admin', ADMIN)

    expect(await screen.findByText('Alice Linked')).toBeInTheDocument()
    expect(screen.getByText('Bob Otherclient')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
    expect(screen.queryByText(UNLINKED_TITLE)).not.toBeInTheDocument()
  })

  it('a linked client login sees only its own cleaners and no Delete button', async () => {
    renderDashboard('manager', LINKED)

    expect(await screen.findByText('Alice Linked')).toBeInTheDocument()
    expect(screen.queryByText('Bob Otherclient')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()

    const trackingFilters = calls.filter((c) => c.table === 'live_tracking' && c.method === 'in')
    expect(trackingFilters).toEqual([{ table: 'live_tracking', method: 'in', args: ['cleaner_id', ['c-linked']] }])
  })

  it('a client login with no links sees the empty state, not other clients', async () => {
    scopeRows = []
    managerCleanerRows = {}

    renderDashboard('manager', UNLINKED)

    expect(await screen.findByText(UNLINKED_TITLE)).toBeInTheDocument()
    expect(screen.queryByText('Alice Linked')).not.toBeInTheDocument()
    expect(screen.queryByText('Bob Otherclient')).not.toBeInTheDocument()
    expect(tablesQueried()).not.toContain('cleaners')
    expect(tablesQueried()).not.toContain('live_tracking')
    expect(tablesQueried()).not.toContain('time_attendance')
  })

  it('a client login with a site but no cleaners linked sees the empty state', async () => {
    scopeRows = [{ manager_id: UNLINKED, customer_id: 'cust-2', customer_label: 'Another Client' }]
    managerCleanerRows = {}

    renderDashboard('manager', UNLINKED)

    expect(await screen.findByText(UNLINKED_TITLE)).toBeInTheDocument()
    expect(tablesQueried()).not.toContain('cleaners')
    expect(tablesQueried()).not.toContain('live_tracking')
  })

  it('a client login whose links fail to load sees nothing and can retry', async () => {
    managerCleanerError = { message: 'network down' }

    renderDashboard('manager', LINKED)

    expect(await screen.findByText(LOOKUP_FAILED_TITLE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('Bob Otherclient')).not.toBeInTheDocument()
    expect(tablesQueried()).not.toContain('cleaners')
  })
})
