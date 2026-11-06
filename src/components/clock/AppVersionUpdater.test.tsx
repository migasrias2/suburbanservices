import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppVersionUpdater } from './AppVersionUpdater'

const h = vi.hoisted(() => ({ start: vi.fn(() => vi.fn()), safe: vi.fn(() => true) }))
vi.mock('@/lib/appVersion', () => ({ startAppVersionChecks: h.start }))
vi.mock('@/lib/clock/clockRuntime', () => ({ canReloadClock: h.safe }))
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks() })

it('does not check or reload in development', () => {
  vi.stubEnv('PROD', false)
  vi.stubGlobal('__APP_BUILD_ID__', 'test-build')
  render(<AppVersionUpdater />)
  expect(h.start).not.toHaveBeenCalled()
})

it('starts the production checker with the bundle build id and clock safety gate', () => {
  vi.stubEnv('PROD', true)
  vi.stubGlobal('__APP_BUILD_ID__', 'test-build')
  render(<AppVersionUpdater />)
  expect(h.start).toHaveBeenCalledWith('test-build', { canReload: h.safe })
  const stop = h.start.mock.results[0].value
  cleanup()
  expect(stop).toHaveBeenCalledOnce()
})
