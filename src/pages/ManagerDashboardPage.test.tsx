import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { installTestLocalStorage } from '@/test/localStorage'

/**
 * The dashboard's role decides whether it is global (admin, ops_manager) or
 * fenced to one client. It must come from the verified session, never from
 * localStorage, which anyone can edit in devtools.
 */

type AuthState = {
  appUser: { id: string; name: string; userType: string } | null
  verifiedRole: string | null
}

let auth: AuthState

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => auth,
}))

vi.mock('../components/layout/Sidebar07Layout', () => ({
  Sidebar07Layout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('../components/dashboard/ManagerDashboard', () => ({
  ManagerDashboard: (props: { managerId: string; role: string }) => (
    <p>
      dashboard role={props.role} id={props.managerId}
    </p>
  ),
}))

const { default: ManagerDashboardPage } = await import('./ManagerDashboardPage')

describe('ManagerDashboardPage identity', () => {
  beforeEach(() => {
    installTestLocalStorage()
  })

  it('uses the verified role and session id even when localStorage claims admin', () => {
    localStorage.setItem('userType', 'admin')
    localStorage.setItem('userId', 'someone-else')
    auth = { appUser: { id: 'client-1', name: 'Client', userType: 'manager' }, verifiedRole: 'manager' }

    render(<ManagerDashboardPage />)

    expect(screen.getByText('dashboard role=manager id=client-1')).toBeInTheDocument()
  })

  it('renders nothing until the role is verified', () => {
    localStorage.setItem('userType', 'admin')
    auth = { appUser: { id: 'client-1', name: 'Client', userType: 'admin' }, verifiedRole: null }

    render(<ManagerDashboardPage />)

    expect(screen.queryByText(/dashboard role=/)).not.toBeInTheDocument()
  })

  it('passes a verified admin through as admin', () => {
    auth = { appUser: { id: 'admin-1', name: 'Admin', userType: 'admin' }, verifiedRole: 'admin' }

    render(<ManagerDashboardPage />)

    expect(screen.getByText('dashboard role=admin id=admin-1')).toBeInTheDocument()
  })
})
