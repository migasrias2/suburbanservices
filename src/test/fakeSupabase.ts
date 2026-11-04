/**
 * A recording fake of the supabase client for component tests. Every query
 * resolves to "no rows"; what matters is which tables were touched and how,
 * so tests can assert "this screen never wrote time_attendance directly".
 */
export interface FakeCall {
  table: string
  op: string
  args: unknown[]
}

const WRITE_OPS = new Set(['insert', 'update', 'upsert', 'delete'])
const CHAIN_OPS = [
  'select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'is', 'not', 'in', 'gte', 'gt', 'lte', 'lt',
  'order', 'limit', 'range', 'ilike', 'like', 'or', 'match', 'filter',
]

export function createFakeSupabase() {
  const calls: FakeCall[] = []
  const rpcCalls: { name: string; args: unknown }[] = []
  const state: { userId: string | null } = { userId: 'user-1' }

  const builder = (table: string) => {
    const chain: Record<string, unknown> = {}
    for (const op of CHAIN_OPS) {
      chain[op] = (...args: unknown[]) => {
        calls.push({ table, op, args })
        return chain
      }
    }
    chain.maybeSingle = async () => ({ data: null, error: null })
    chain.single = async () => ({ data: null, error: null })
    chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject)
    return chain
  }

  const supabase = {
    from: (table: string) => builder(table),
    rpc: async (name: string, args?: unknown) => {
      rpcCalls.push({ name, args })
      return { data: null, error: null }
    },
    auth: {
      getSession: async () => ({
        data: { session: state.userId ? { user: { id: state.userId } } : null },
        error: null,
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  }

  return {
    supabase,
    calls,
    rpcCalls,
    signIn: (userId: string) => {
      state.userId = userId
    },
    signOut: () => {
      state.userId = null
    },
    writesTo: (table: string) => calls.filter((c) => c.table === table && WRITE_OPS.has(c.op)),
    reset: () => {
      calls.length = 0
      rpcCalls.length = 0
      state.userId = 'user-1'
    },
  }
}
