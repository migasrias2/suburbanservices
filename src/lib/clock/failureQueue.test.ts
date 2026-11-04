import { describe, expect, it, vi } from 'vitest'

vi.mock('@/services/supabase', () => ({ supabase: {} }))

import { createFailureQueue, FAILURE_QUEUE_KEY, MAX_QUEUED_FAILURES } from './failureQueue'
import type { SessionState } from './outbox'

const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

const failure = { eventType: 'clock_in' as const, reason: 'Scanned on the wrong screen', qrCodeId: 'qr-1' }

const setup = (session: SessionState, insertResult: { error: { message: string; code?: string } | null } = { error: null }) => {
  let current = session
  let clock = Date.parse('2026-11-04T07:00:00Z')
  const storage = memoryStorage()
  const insert = vi.fn(async () => insertResult)
  const queue = createFailureQueue({ storage: () => storage, insert, readSession: async () => current, now: () => clock })
  return {
    queue,
    storage,
    insert,
    setSession: (next: SessionState) => {
      current = next
    },
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe('failure reports (D7c)', () => {
  it('are sent straight away when signed in', async () => {
    const t = setup({ status: 'signed_in', userId: 'u1' })
    await t.queue.report(failure, 'u1')
    expect(t.insert).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'clock_in', reason: 'Scanned on the wrong screen' }))
    expect(t.queue.size()).toBe(0)
  })

  it('are kept on the phone while signed out, and sent after the next sign-in', async () => {
    const t = setup({ status: 'signed_out' })
    await t.queue.report(failure, 'u1')
    expect(t.insert).not.toHaveBeenCalled()
    expect(t.queue.size()).toBe(1)

    t.setSession({ status: 'signed_in', userId: 'u1' })
    await t.queue.flush()
    expect(t.insert).toHaveBeenCalledTimes(1)
    expect(t.queue.size()).toBe(0)
  })

  it('are kept when the request does not get through, but not when the database refuses them', async () => {
    const offline = setup({ status: 'signed_in', userId: 'u1' }, { error: { message: 'TypeError: Failed to fetch' } })
    await offline.queue.report(failure, 'u1')
    expect(offline.queue.size()).toBe(1)

    const refused = setup({ status: 'signed_in', userId: 'u1' }, { error: { message: 'denied', code: '42501' } })
    await refused.queue.report(failure, 'u1')
    expect(refused.queue.size()).toBe(0)
  })

  it('are capped and expire after a week', async () => {
    const t = setup({ status: 'signed_out' })
    for (let i = 0; i < MAX_QUEUED_FAILURES + 5; i += 1) await t.queue.report({ ...failure, reason: `r${i}` }, 'u1')
    expect(t.queue.size()).toBe(MAX_QUEUED_FAILURES)

    t.advance(8 * 24 * 3600_000)
    t.setSession({ status: 'signed_in', userId: 'u1' })
    await t.queue.flush()
    expect(t.insert).not.toHaveBeenCalled()
    expect(t.queue.size()).toBe(0)
  })

  it('survive a broken stored list', async () => {
    const t = setup({ status: 'signed_out' })
    t.storage.setItem(FAILURE_QUEUE_KEY, 'nope')
    await t.queue.report(failure, 'u1')
    expect(t.queue.size()).toBe(1)
  })
})

describe('failure reports: review L4', () => {
  it('are sent only under the person who made them', async () => {
    const t = setup({ status: 'signed_out' })
    await t.queue.report(failure, 'u1')
    t.setSession({ status: 'signed_in', userId: 'someone-else' })
    await t.queue.flush()
    expect(t.insert).not.toHaveBeenCalled()
    expect(t.queue.size()).toBe(1)

    t.setSession({ status: 'signed_in', userId: 'u1' })
    await t.queue.flush()
    expect(t.insert).toHaveBeenCalledTimes(1)
    expect(t.queue.size()).toBe(0)
  })

  it('a report added while a flush is sending is kept, not overwritten', async () => {
    const t = setup({ status: 'signed_out' })
    await t.queue.report({ ...failure, reason: 'first' }, 'u1')
    let release!: () => void
    t.insert.mockImplementationOnce(() => new Promise((r) => (release = () => r({ error: null }))))
    t.setSession({ status: 'signed_in', userId: 'u1' })
    const flushing = t.queue.flush()
    await vi.waitFor(() => expect(t.insert).toHaveBeenCalledTimes(1))
    // Another report arrives for someone not signed in, while the insert is in flight.
    t.setSession({ status: 'signed_out' })
    await t.queue.report({ ...failure, reason: 'second' }, 'u1')
    release()
    await flushing
    expect(t.queue.size()).toBe(1)
  })
})
