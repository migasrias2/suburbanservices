import React from 'react'
import { Sidebar07Layout } from '@/components/layout/Sidebar07Layout'
import { AnalyticsDashboard } from '@/components/analytics/AnalyticsDashboard'
import { ManagerAccessGate } from '@/components/dashboard/ManagerAccessGate'
import { useVerifiedManagerIdentity } from '@/hooks/useVerifiedManagerIdentity'

const AnalyticsPage: React.FC = () => {
  // Verified session role and id, never localStorage (see useVerifiedManagerIdentity).
  const identity = useVerifiedManagerIdentity()

  if (!identity) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary/40 border-t-transparent" />
      </div>
    )
  }

  const { managerId, managerName, role } = identity

  return (
    <Sidebar07Layout userType={role} userName={managerName}>
      <ManagerAccessGate role={role} managerId={managerId} managerName={managerName}>
        {(access) => (
          <AnalyticsDashboard
            managerId={role === 'manager' ? managerId : null}
            role={role}
            customerScope={access.status === 'scoped' ? access.customerTokens : undefined}
          />
        )}
      </ManagerAccessGate>
    </Sidebar07Layout>
  )
}

export default AnalyticsPage
