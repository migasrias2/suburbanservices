import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { installTestLocalStorage } from '@/test/localStorage'

/**
 * The guard is a UX boundary, not a security boundary — RLS is the real one.
 * What it must get right is that it never shows the admin shell to someone the
 * DATABASE would refuse, and never ejects someone whose session is fine.
 *
 * The role it reads is `verifiedRole` (has_app_role, over table membership),
 * never appUser.userType, which comes from user_metadata.app_role and is
 * client-editable: any user can call updateUser and claim 'admin'.
 */

const retryRoleCheck = vi.fn()
let auth: Record<string, unknown>

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => auth,
}))

const { RequireAuth } = await import('./RequireAuth')

const AdminUsers = () => <div>USERS ADMIN UI</div>

const renderAt = (path: string, roles?: string[]) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/admin/users"
          element={
            <RequireAuth roles={roles as never}>
              <AdminUsers />
            </RequireAuth>
          }
        />
        <Route path="/login" element={<div>LOGIN SCREEN</div>} />
        <Route path="/cleaner-dashboard" element={<div>CLEANER HOME</div>} />
        <Route path="/manager-dashboard" element={<div>MANAGER HOME</div>} />
        <Route path="/ops-dashboard" element={<div>OPS HOME</div>} />
        <Route path="/admin/dashboard" element={<div>ADMIN HOME</div>} />
      </Routes>
    </MemoryRouter>,
  )

const signedIn = (over: Record<string, unknown> = {}) => ({
  session: { access_token: 't', user: { id: 'u1' } },
  isLoading: false,
  verifiedRole: 'admin',
  roleStatus: 'verified',
  appUser: { id: 'u1', userType: 'admin', name: 'Mig' },
  retryRoleCheck,
  ...over,
})

beforeEach(() => {
  installTestLocalStorage()
  retryRoleCheck.mockClear()
  auth = signedIn()
})

describe('no session', () => {
  beforeEach(() => {
    auth = signedIn({ session: null, verifiedRole: null, roleStatus: 'idle', appUser: null })
  })

  it('renders no admin UI', () => {
    renderAt('/admin/users', ['admin'])

    expect(screen.queryByText('USERS ADMIN UI')).not.toBeInTheDocument()
  })

  it('lands on the login screen', () => {
    renderAt('/admin/users', ['admin'])

    expect(screen.getByText('LOGIN SCREEN')).toBeInTheDocument()
  })

  it('renders nothing even when a stale localStorage identity says admin', () => {
    // ~40 localStorage reads remain in page bodies. This is the claim that
    // they are no longer authoritative: the guard sits above them, so the page
    // never mounts to read them at all.
    localStorage.setItem('userType', 'admin')
    localStorage.setItem('userId', 'u1')

    renderAt('/admin/users', ['admin'])

    expect(screen.queryByText('USERS ADMIN UI')).not.toBeInTheDocument()
  })
})

describe('while the session is still being restored', () => {
  beforeEach(() => {
    auth = signedIn({ session: null, isLoading: true, verifiedRole: null, roleStatus: 'idle' })
  })

  it('does not flash the login screen at a valid session', () => {
    renderAt('/admin/users', ['admin'])

    expect(screen.queryByText('LOGIN SCREEN')).not.toBeInTheDocument()
  })

  it('does not render authenticated content either', () => {
    renderAt('/admin/users', ['admin'])

    expect(screen.queryByText('USERS ADMIN UI')).not.toBeInTheDocument()
  })
})

describe('while the role is still being verified', () => {
  it.each(['idle', 'verifying'])('renders neither content nor a redirect at status %s', (roleStatus) => {
    auth = signedIn({ roleStatus, verifiedRole: null })

    renderAt('/admin/users', ['admin'])

    expect(screen.queryByText('USERS ADMIN UI')).not.toBeInTheDocument()
    expect(screen.queryByText('LOGIN SCREEN')).not.toBeInTheDocument()
  })
})

describe('a signed-in user in the wrong place', () => {
  it('never sees the admin UI', () => {
    auth = signedIn({ verifiedRole: 'cleaner', appUser: { id: 'u1', userType: 'cleaner', name: 'Ana' } })

    renderAt('/admin/users', ['admin'])

    expect(screen.queryByText('USERS ADMIN UI')).not.toBeInTheDocument()
  })

  it.each([
    ['cleaner', 'CLEANER HOME'],
    ['manager', 'MANAGER HOME'],
    ['ops_manager', 'OPS HOME'],
  ])('sends a %s to their own home, not to /login', (role, home) => {
    auth = signedIn({ verifiedRole: role, appUser: { id: 'u1', userType: role, name: 'X' } })

    renderAt('/admin/users', ['admin'])

    expect(screen.getByText(home)).toBeInTheDocument()
    expect(screen.queryByText('LOGIN SCREEN')).not.toBeInTheDocument()
  })
})

describe('a metadata claim the database does not back', () => {
  // buildAppUser takes userType straight from user_metadata.app_role, which
  // the user can set on themselves. has_app_role is the only real answer.
  const forgedAdmin = {
    appUser: { id: 'u1', userType: 'admin', name: 'Forged' },
    verifiedRole: null,
    roleStatus: 'verified',
  }

  it('does not render the admin shell', () => {
    auth = signedIn(forgedAdmin)

    renderAt('/admin/users', ['admin'])

    expect(screen.queryByText('USERS ADMIN UI')).not.toBeInTheDocument()
  })

  it('ignores the metadata claim entirely, even when it matches the required role', () => {
    auth = signedIn({ ...forgedAdmin, verifiedRole: 'cleaner' })

    renderAt('/admin/users', ['admin'])

    expect(screen.getByText('CLEANER HOME')).toBeInTheDocument()
  })

  it('grants the route when has_app_role confirms the claim', () => {
    auth = signedIn({ verifiedRole: 'admin', roleStatus: 'verified' })

    renderAt('/admin/users', ['admin'])

    expect(screen.getByText('USERS ADMIN UI')).toBeInTheDocument()
  })
})

describe('the role check could not be reached', () => {
  beforeEach(() => {
    auth = signedIn({ roleStatus: 'error', verifiedRole: null })
  })

  it('does not grant the route', () => {
    renderAt('/admin/users', ['admin'])

    expect(screen.queryByText('USERS ADMIN UI')).not.toBeInTheDocument()
  })

  it('does not eject the user to the login screen', () => {
    // "Could not verify right now" and "signed out" are different states, and
    // a cleaner in the field should not be signed out by one failed request.
    renderAt('/admin/users', ['admin'])

    expect(screen.queryByText('LOGIN SCREEN')).not.toBeInTheDocument()
  })

  it('explains what happened', () => {
    renderAt('/admin/users', ['admin'])

    expect(screen.getByText(/couldn't verify your access/i)).toBeInTheDocument()
  })

  it('says the user is still signed in', () => {
    renderAt('/admin/users', ['admin'])

    expect(screen.getByText(/still signed in/i)).toBeInTheDocument()
  })

  it('offers a retry that re-runs the check', async () => {
    const user = userEvent.setup()
    renderAt('/admin/users', ['admin'])

    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(retryRoleCheck).toHaveBeenCalledTimes(1)
  })
})

describe('a route that requires only a signed-in user', () => {
  it('renders without waiting for a role check', () => {
    auth = signedIn({ verifiedRole: null, roleStatus: 'verifying' })

    renderAt('/admin/users', undefined)

    expect(screen.getByText('USERS ADMIN UI')).toBeInTheDocument()
  })

  it('still refuses when there is no session', () => {
    auth = signedIn({ session: null, verifiedRole: null, roleStatus: 'idle' })

    renderAt('/admin/users', undefined)

    expect(screen.getByText('LOGIN SCREEN')).toBeInTheDocument()
  })
})

/**
 * A live session that verifies as NO role at all.
 *
 * has_app_role filters on is_active (confirmed against the live function:
 * `is_active is distinct from false` on all three role tables), while GoTrue
 * knows nothing about that flag. So a deactivated person signs in
 * SUCCESSFULLY, with the correct password, and then verifies as nothing —
 * previously bouncing between their dashboard and /login forever with no
 * explanation, while keeping the own-row read/write the ungated routes allow.
 *
 * The dangerous half of this fix is the false positive: signing out a healthy
 * user whose role check merely could not be reached. A cleaner in a basement
 * with no signal must NOT be signed out. Those cases are pinned first and
 * matter more than the deactivation case itself.
 */
describe('a deactivated account is ended, not left bouncing', () => {
  const signOut = vi.fn()
  const deactivated = (over: Record<string, unknown> = {}) =>
    signedIn({ verifiedRole: null, roleStatus: 'verified', signOut, ...over })

  beforeEach(() => signOut.mockReset())

  it('signs the account out rather than leaving a usable session', async () => {
    auth = deactivated()

    renderAt('/admin/users', ['admin'])

    await waitFor(() => expect(signOut).toHaveBeenCalled())
  })

  it('lands them on the login screen', () => {
    auth = deactivated()

    renderAt('/admin/users', ['admin'])

    expect(screen.getByText('LOGIN SCREEN')).toBeInTheDocument()
  })

  it('never renders the protected content', () => {
    auth = deactivated()

    renderAt('/admin/users', ['admin'])

    expect(screen.queryByText('USERS ADMIN UI')).not.toBeInTheDocument()
  })

  // /chat, /history and /profile pass no `roles`, and the old guard returned
  // children before any role check ran — so a deactivated user kept reaching
  // them, and their own-row RLS policies (which do not check is_active) served.
  it('applies to routes that gate on nothing', async () => {
    auth = deactivated()

    renderAt('/admin/users', undefined)

    expect(screen.queryByText('USERS ADMIN UI')).not.toBeInTheDocument()
    await waitFor(() => expect(signOut).toHaveBeenCalled())
  })

})

describe('an unreachable role check must never sign anyone out', () => {
  const signOut = vi.fn()

  beforeEach(() => signOut.mockClear())

  // THE REGRESSION THAT WOULD HURT MOST: a cleaner in the field, offline.
  it('keeps a user signed in when the check errored', async () => {
    auth = signedIn({ verifiedRole: null, roleStatus: 'error', signOut })

    renderAt('/admin/users', ['admin'])

    await Promise.resolve()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('offers the retry instead of ejecting them', () => {
    auth = signedIn({ verifiedRole: null, roleStatus: 'error', signOut })

    renderAt('/admin/users', ['admin'])

    expect(screen.getByText(/Couldn't verify your access/i)).toBeInTheDocument()
    expect(screen.queryByText('LOGIN SCREEN')).not.toBeInTheDocument()
  })

  it('does not sign out while the check is still in flight', async () => {
    auth = signedIn({ verifiedRole: null, roleStatus: 'verifying', signOut })

    renderAt('/admin/users', ['admin'])

    await Promise.resolve()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('does not sign out before the check has started', async () => {
    auth = signedIn({ verifiedRole: null, roleStatus: 'idle', signOut })

    renderAt('/admin/users', ['admin'])

    await Promise.resolve()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('leaves a healthy verified user completely alone', async () => {
    auth = signedIn({ signOut })

    renderAt('/admin/users', ['admin'])

    expect(screen.getByText('USERS ADMIN UI')).toBeInTheDocument()
    await Promise.resolve()
    expect(signOut).not.toHaveBeenCalled()
  })
})
