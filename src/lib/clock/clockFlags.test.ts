import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installTestLocalStorage } from '@/test/localStorage'
import type { ClockFlags } from '@/services/clockApi'

vi.mock('@/services/supabase', () => ({ supabase: {} }))

const { CLOCK_FLAGS_CACHE_KEY, getClockSwitches, refreshClockSwitches, resetClockSwitchesForTests } = await import(
  './clockFlags'
)

const server = (clockV2: boolean, scannerV2: boolean): (() => Promise<ClockFlags>) => async () => ({
  clockV2,
  scannerV2,
  source: 'server',
})
const unreadable = async (): Promise<ClockFlags> => ({ clockV2: true, scannerV2: true, source: 'default' })

beforeEach(() => {
  installTestLocalStorage()
  resetClockSwitchesForTests()
})

describe('clock kill switches', () => {
  it('are ON before they have ever been read (D9)', () => {
    expect(getClockSwitches()).toEqual({ clockV2: true, scannerV2: true })
  })

  it("use and remember the server's answer", async () => {
    await refreshClockSwitches(server(false, true))
    expect(getClockSwitches()).toEqual({ clockV2: false, scannerV2: true })

    // The app is reopened: the remembered answer is used before the next read.
    resetClockSwitchesForTests({ keepStorage: true })
    expect(getClockSwitches()).toEqual({ clockV2: false, scannerV2: true })
    expect(JSON.parse(localStorage.getItem(CLOCK_FLAGS_CACHE_KEY) as string)).toMatchObject({ clockV2: false })
  })

  it('keep the last known value when the server cannot be read', async () => {
    await refreshClockSwitches(server(false, false))
    await refreshClockSwitches(unreadable)
    expect(getClockSwitches()).toEqual({ clockV2: false, scannerV2: false })
  })

  it('turn the new clock off when the server has no switch table yet (migration not applied)', async () => {
    await refreshClockSwitches(async () => ({ clockV2: false, scannerV2: true, source: 'not_ready' }))
    expect(getClockSwitches()).toEqual({ clockV2: false, scannerV2: true })
  })

  it('ignore a broken cache entry', () => {
    localStorage.setItem(CLOCK_FLAGS_CACHE_KEY, '{oops')
    resetClockSwitchesForTests({ keepStorage: true })
    expect(getClockSwitches()).toEqual({ clockV2: true, scannerV2: true })
  })
})
