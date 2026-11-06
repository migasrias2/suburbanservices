import { expect, it, vi } from 'vitest'
import { createClockOutbox } from './outbox'
import { createLocalOutboxStorage } from './outboxStorage'
import { isAppReloadIdle } from '../appReloadGuard'
import type { ClockEvent } from './clockEvents'
import type { ClockResult } from '@/services/clockApi'

it('keeps an offline scan through reload and flushes its original event id after startup', async () => {
  const values = new Map<string, string>()
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const storage = createLocalOutboxStorage(() => store)
  const session = async () => ({ status: 'signed_in' as const, userId: 'user' })
  const event: ClockEvent = {
    eventId: 'saved-event', userId: 'user', kind: 'clock_in', qrPayload: 'UL-BAS-CLOCK-IN',
    scannedAtMs: Date.now(), location: null, device: {}, attempts: 0, nextAttemptAtMs: 0,
  }
  const first = createClockOutbox({
    storage, readSession: session,
    send: async () => {
      expect(isAppReloadIdle()).toBe(false)
      return { ok: false, code: 'network', message: 'offline' }
    },
  })
  expect((await first.submit(event)).status).toBe('queued')
  expect(storage.isDurable()).toBe(true)
  expect(isAppReloadIdle()).toBe(true)

  // A new module/tab starts with only the persisted localStorage data.
  const restored = createLocalOutboxStorage(() => store)
  const send = vi.fn(async (): Promise<ClockResult> => {
    expect(isAppReloadIdle()).toBe(false)
    return { ok: false, code: 'unknown_qr', message: 'Answered', flags: [], qr: null, replay: false, shift: null, serverNow: 'now' }
  })
  const reloaded = createClockOutbox({ storage: restored, readSession: session, send })
  expect(reloaded.pending()[0].eventId).toBe(event.eventId)
  await reloaded.flush({ force: true })
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ eventId: event.eventId, qrPayload: event.qrPayload }), expect.any(Number))
  expect(reloaded.pending()).toEqual([])
  expect(isAppReloadIdle()).toBe(true)
})
