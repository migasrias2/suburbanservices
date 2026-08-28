import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { installTestLocalStorage } from '@/test/localStorage'

/**
 * What a rejected sign-in must NOT destroy.
 *
 * clearClockState() used to run BEFORE `await signIn(...)`, so it fired on
 * every submit — including the ones that failed. A cleaner clocked in at a
 * site, whose token expired while the phone was closed, who then mistyped her
 * password once, lost currentClockInData / currentClockInPhase /
 * currentSiteName / recentClockOutAt before the request was even sent. A
 * rejected attempt changes nothing about who is signed in, so it must change
 * nothing about what they were doing.
 *
 * The clear itself still has to happen on SUCCESS: a different person is now
 * signed in on this device and must not inherit the previous session's open
 * shift. So both directions are pinned here — removing either one is a
 * regression, in opposite ways.
 */

const WORK_KEYS = [
  'currentClockInData',
  'currentClockInPhase',
  'currentSiteName',
  'recentClockOutAt',
] as const

const signIn = vi.fn()
const navigate = vi.fn()
const toast = vi.fn()

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ signIn }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

vi.mock('../hooks/use-toast', () => ({ useToast: () => ({ toast }) }))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }))

const Login = (await import('./Login')).default

/** A cleaner mid-shift: clocked in, workflow in progress, on this device. */
function seedShiftInProgress() {
  localStorage.setItem(
    'currentClockInData',
    JSON.stringify({ time: '2026-08-28T09:00:00Z', siteName: 'Avtrade' }),
  )
  localStorage.setItem('currentClockInPhase', 'workflow')
  localStorage.setItem('currentSiteName', 'Avtrade')
  localStorage.setItem('recentClockOutAt', '0')
}

const renderLogin = () =>
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Login />
    </MemoryRouter>,
  )

/**
 * Submit the cleaner form directly.
 *
 * Deliberately not a click on the button: PhoneInput renders a `required`
 * field that starts empty, so jsdom's constraint validation swallows the click
 * and handleLogin never runs — which would make every assertion below pass for
 * the wrong reason. What is under test is the ORDER of operations inside
 * handleLogin, not the form's own validation, so the form is submitted
 * straight to it.
 */
async function attemptLogin(container: HTMLElement) {
  const form = container.querySelector('form') as HTMLFormElement
  expect(form).toBeTruthy()
  fireEvent.submit(form)
  await waitFor(() => expect(signIn).toHaveBeenCalled())
}

beforeEach(() => {
  vi.clearAllMocks()
  installTestLocalStorage()
  seedShiftInProgress()
})

describe('a rejected sign-in leaves the shift in progress alone', () => {
  for (const key of WORK_KEYS) {
    it(`keeps ${key} when the password is wrong`, async () => {
      signIn.mockRejectedValue(new Error('Invalid credentials'))
      const { container } = renderLogin()

      await attemptLogin(container)

      expect(signIn).toHaveBeenCalled()
      expect(localStorage.getItem(key)).not.toBeNull()
    })
  }

  it('still reports the failure to the operator', async () => {
    signIn.mockRejectedValue(new Error('Invalid credentials'))
    const { container } = renderLogin()

    await attemptLogin(container)

    expect(toast).toHaveBeenCalled()
  })

  it('does not navigate away on a rejected attempt', async () => {
    signIn.mockRejectedValue(new Error('Invalid credentials'))
    const { container } = renderLogin()

    await attemptLogin(container)

    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('a successful sign-in still clears the previous shift', () => {
  for (const key of WORK_KEYS) {
    it(`clears ${key} so the next person does not inherit it`, async () => {
      signIn.mockResolvedValue(undefined)
      const { container } = renderLogin()

      await attemptLogin(container)

      expect(signIn).toHaveBeenCalled()
      expect(localStorage.getItem(key)).toBeNull()
    })
  }

  it('navigates once the sign-in has succeeded', async () => {
    signIn.mockResolvedValue(undefined)
    const { container } = renderLogin()

    await attemptLogin(container)

    expect(navigate).toHaveBeenCalled()
  })
})
