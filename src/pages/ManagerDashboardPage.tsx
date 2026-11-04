import React from 'react'
import { Sidebar07Layout } from '../components/layout/Sidebar07Layout'
import { ManagerDashboard } from '../components/dashboard/ManagerDashboard'
import { useVerifiedManagerIdentity } from '../hooks/useVerifiedManagerIdentity'

export default function ManagerDashboardPage() {
  // Role and id come from the verified session, not localStorage: the role
  // decides whether the dashboard is global or scoped to one client.
  const identity = useVerifiedManagerIdentity()

  if (!identity) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-muted">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary/40 border-t-transparent"></div>
      </div>
    )
  }

  return (
    <Sidebar07Layout userType={identity.role} userName={identity.managerName}>
      <ManagerDashboard
        managerId={identity.managerId}
        managerName={identity.managerName}
        role={identity.role}
      />
    </Sidebar07Layout>
  )
}
