import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth, type AppRole } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'

/** Where each role belongs when it lands somewhere it should not be. */
const HOME_FOR_ROLE: Record<AppRole, string> = {
  cleaner: '/cleaner-dashboard',
  manager: '/manager-dashboard',
  ops_manager: '/ops-dashboard',
  admin: '/admin/dashboard',
}

/**
 * Shown on the login screen after a deactivated account is ejected.
 *
 * Passed through router state rather than hardcoded in Login, because Login
 * cannot tell this apart from any other arrival at /login.
 */
const DEACTIVATED_NOTICE = 'This account has been deactivated. Please contact an admin.'

const Spinner = () => (
  <div className="flex min-h-screen items-center justify-center">
    <div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
  </div>
)

interface RequireAuthProps {
  children: ReactNode
  /** Omit to require only a signed-in user. */
  roles?: AppRole[]
}

/**
 * The access decision for every authenticated route.
 *
 * It READS the auth context rather than localStorage, so it re-renders when
 * the session ends and ejects the user at that moment. The pattern it replaces
 * -- a mount-only effect reading localStorage.userType -- could not react at
 * all: those keys have no expiry, so a browser whose session had ended kept
 * rendering the full UI and only failed at the first write, as an opaque toast.
 *
 * The role comes from `verifiedRole`, which is has_app_role's answer over table
 * membership, never user_metadata.app_role. That field is client-editable: a
 * user can grant themselves 'admin' with a single updateUser call. The database
 * would still refuse them, but they would get the admin shell and a pile of
 * confusing errors.
 *
 * THIS IS A UX BOUNDARY, NOT A SECURITY BOUNDARY. Any client-side guard is
 * bypassable by editing the bundle. Checking has_app_role makes it honest
 * rather than decorative, but the real boundary is RLS in the database. Never
 * gate a destructive or privileged action on this component alone -- if it
 * matters, it must also be refused server-side.
 */
export function RequireAuth({ children, roles }: RequireAuthProps) {
  const { session, isLoading, verifiedRole, roleStatus, retryRoleCheck, signOut } = useAuth()
  const location = useLocation()

  // A live session that has NO role at all. has_app_role filters on is_active,
  // so a deactivated person still signs in -- GoTrue knows nothing about the
  // flag -- and then verifies as nothing. Without this they bounce between
  // their dashboard and /login forever, with the correct password and no
  // explanation, and keep the own-row access the ungated routes still allow.
  // 'verified' only: an unreachable role check is not an answer.
  const isDeactivated = !!session && roleStatus === 'verified' && verifiedRole === null

  useEffect(() => {
    if (!isDeactivated) return
    // Best effort. The redirect below happens either way; failing to reach
    // GoTrue must not strand them on a screen with no way forward.
    Promise.resolve(signOut?.()).catch((error) => {
      console.error('Could not sign out a deactivated account:', error)
    })
  }, [isDeactivated, signOut])

  // Never decide while the session is still being restored, or a valid session
  // flashes /login on every cold load.
  if (isLoading) return <Spinner />

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  // Before the `roles` check on purpose: this applies to every authenticated
  // route, including the ones that gate on nothing.
  if (isDeactivated) {
    return <Navigate to="/login" replace state={{ notice: DEACTIVATED_NOTICE }} />
  }

  if (!roles) return <>{children}</>

  if (roleStatus === 'idle' || roleStatus === 'verifying') return <Spinner />

  // Could not reach the server. That is NOT "you are not an admin", so it must
  // neither eject the user nor silently grant the route. Cleaners are in the
  // field; ejecting them over one failed request is worse than asking again.
  if (roleStatus === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-base font-medium text-gray-900">Couldn't verify your access</p>
        <p className="max-w-sm text-sm text-gray-500">
          We couldn't reach the server to confirm your permissions. You are still signed in.
        </p>
        <Button onClick={retryRoleCheck} className="rounded-full bg-[#00339B] px-6 text-white hover:bg-[#002d7a]">
          Try again
        </Button>
      </div>
    )
  }

  if (verifiedRole && roles.includes(verifiedRole)) return <>{children}</>

  // Signed in but in the wrong place. Send them home rather than to /login --
  // they are authenticated, and a login screen would look like a session bug
  // and invite a pointless re-login.
  return <Navigate to={verifiedRole ? HOME_FOR_ROLE[verifiedRole] : '/login'} replace />
}
