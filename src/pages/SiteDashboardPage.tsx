import React from 'react'
import { Sidebar07Layout } from '../components/layout/Sidebar07Layout'
import { SiteDashboard } from '../components/siteDashboard/SiteDashboard'
import { useAuth } from '../contexts/AuthContext'
import { getStoredCleanerName } from '../lib/identity'

/**
 * RequireAuth has already admitted manager / ops_manager / admin. Identity
 * comes from the live session and the server-verified role, not localStorage,
 * because the site scope hangs off that id.
 */
export default function SiteDashboardPage() {
  const { session, verifiedRole } = useAuth()
  const userId = session?.user?.id ?? null

  if (!userId || (verifiedRole !== 'manager' && verifiedRole !== 'ops_manager' && verifiedRole !== 'admin')) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary/40 border-t-transparent" />
      </div>
    )
  }

  return (
    <Sidebar07Layout userType={verifiedRole} userName={getStoredCleanerName()}>
      <SiteDashboard role={verifiedRole} userId={userId} />
    </Sidebar07Layout>
  )
}
