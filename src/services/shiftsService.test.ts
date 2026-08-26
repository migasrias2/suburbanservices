import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The publishedOnly filter is the guard that keeps a draft shift out of a
 * cleaner's app. Getting it wrong would notify someone of a shift nobody
 * intended to give them, which under the October 2026 shift-notice rules is
 * exactly the mistake that costs money.
 */

type Call = { method: string; args: unknown[] }

const calls: Call[] = []
let rowsToReturn: unknown[] = []
let errorToReturn: unknown = null

const makeQuery = () => {
  const q: Record<string, unknown> = {}
  const chain = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args })
    return q
  }
  for (const m of ['select', 'gte', 'lt', 'order', 'eq', 'in', 'not', 'is']) {
    q[m] = chain(m)
  }
  // awaiting the builder resolves it, same as postgrest-js
  ;(q as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: rowsToReturn, error: errorToReturn })
  return q
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] })
      return makeQuery()
    },
  },
}))

const { fetchShiftsInRange } = await import('./shiftsService')

const shiftRow = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  cleaner_id: 'c1',
  customer_id: null,
  site_name: 'Metalex House',
  start_at: '2026-08-26T18:00:00Z',
  end_at: '2026-08-26T22:00:00Z',
  notes: null,
  created_by: null,
  created_at: '2026-08-20T10:00:00Z',
  updated_at: '2026-08-20T10:00:00Z',
  published_at: '2026-08-20T10:00:00Z',
  cancelled_at: null,
  cancellation_reason: null,
  cleaners: { first_name: 'ZZ', last_name: 'Cleaner' },
  customer: null,
  ...over,
})

const methodsUsed = () => calls.map((c) => c.method)

describe('fetchShiftsInRange', () => {
  beforeEach(() => {
    calls.length = 0
    rowsToReturn = []
    errorToReturn = null
  })

  it('excludes drafts and cancellations when publishedOnly is set', async () => {
    await fetchShiftsInRange(new Date('2026-08-26'), new Date('2026-08-27'), {
      cleanerId: 'c1',
      publishedOnly: true,
    })

    const notCall = calls.find((c) => c.method === 'not')
    const isCall = calls.find((c) => c.method === 'is')

    expect(notCall?.args).toEqual(['published_at', 'is', null])
    expect(isCall?.args).toEqual(['cancelled_at', null])
  })

  it('does not filter by publication for management views', async () => {
    await fetchShiftsInRange(new Date('2026-08-26'), new Date('2026-08-27'), {})

    expect(methodsUsed()).not.toContain('not')
    expect(methodsUsed()).not.toContain('is')
  })

  it('scopes to one cleaner when asked', async () => {
    await fetchShiftsInRange(new Date('2026-08-26'), new Date('2026-08-27'), { cleanerId: 'c1' })

    expect(calls.find((c) => c.method === 'eq')?.args).toEqual(['cleaner_id', 'c1'])
  })

  it('surfaces publication state on the mapped shift', async () => {
    rowsToReturn = [shiftRow()]

    const [shift] = await fetchShiftsInRange(new Date('2026-08-26'), new Date('2026-08-27'), {})

    expect(shift.publishedAt).toBe('2026-08-20T10:00:00Z')
    expect(shift.cancelledAt).toBeNull()
    expect(shift.cleanerName).toBe('ZZ Cleaner')
    expect(shift.siteName).toBe('Metalex House')
  })

  it('maps an unpublished row as a draft rather than dropping the field', async () => {
    rowsToReturn = [shiftRow({ published_at: null })]

    const [shift] = await fetchShiftsInRange(new Date('2026-08-26'), new Date('2026-08-27'), {})

    expect(shift.publishedAt).toBeNull()
  })

  it('throws rather than silently showing an empty schedule on error', async () => {
    errorToReturn = { message: 'boom' }

    await expect(
      fetchShiftsInRange(new Date('2026-08-26'), new Date('2026-08-27'), {}),
    ).rejects.toBeTruthy()
  })
})
