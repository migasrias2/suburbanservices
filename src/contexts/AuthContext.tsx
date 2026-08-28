import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../services/supabase'
import { deriveSyntheticEmail } from '../lib/authHelpers'
import { setStoredCleanerName } from '../lib/identity'
import { hydrateManagerScopes, invalidateManagerScopes } from '../lib/managerScope'

export type AppRole = 'cleaner' | 'manager' | 'ops_manager' | 'admin'

/**
 * Where the role check stands.
 *   verifying — the has_app_role round trip is in flight
 *   verified  — we have a definitive yes or no
 *   error     — we could not reach the server. NOT the same as "no".
 */
export type RoleStatus = 'idle' | 'verifying' | 'verified' | 'error'

export interface AppUser {
  id: string
  /** The role CLAIMED by user_metadata. Never an authorization answer on its own. */
  userType: AppRole
  name: string
  mobile?: string | null
  username?: string | null
}

interface AuthContextType {
  session: Session | null
  appUser: AppUser | null
  isLoading: boolean
  /** The claimed role once has_app_role confirms it. Null when it does not. */
  verifiedRole: AppRole | null
  roleStatus: RoleStatus
  retryRoleCheck: () => void
  signIn: (userType: AppRole, identifier: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

function buildAppUser(user: User): AppUser {
  const meta = user.user_metadata ?? {}
  return {
    id: user.id,
    userType: meta.app_role ?? 'cleaner',
    name: [meta.first_name, meta.last_name].filter(Boolean).join(' ') || 'Unknown',
    mobile: meta.mobile_number ?? null,
    username: meta.username ?? null,
  }
}

function syncIdentityToLocalStorage(appUser: AppUser) {
  localStorage.setItem('userType', appUser.userType)
  localStorage.setItem('userId', appUser.id)
  setStoredCleanerName(appUser.name)
  if (appUser.mobile) {
    localStorage.setItem('userMobile', appUser.mobile)
  } else {
    localStorage.removeItem('userMobile')
  }
}

/**
 * Clears WHO the user is. Deliberately does not touch WHAT THEY WERE DOING.
 *
 * This runs on every transition to a null session, and auth-js emits
 * SIGNED_OUT for any non-retryable token refresh -- an expired or rotated
 * refresh token, which is routine for a phone left closed overnight -- not
 * only for a deliberate sign-out.
 *
 * currentClockInData / currentClockInPhase / currentSiteName /
 * recentClockOutAt used to be wiped here too. That put a cleaner mid-shift one
 * expired token away from losing their in-progress clock-in with no clean way
 * to clock out. A session ending is not evidence the shift ended. Login.tsx
 * clears the work-state keys once a sign-in has SUCCEEDED -- after the await,
 * not before it, so a mistyped password leaves the open shift alone. That is
 * the only moment we know a different person is taking over the device.
 */
function clearIdentityStorage() {
  localStorage.removeItem('userType')
  localStorage.removeItem('userId')
  localStorage.removeItem('userName')
  localStorage.removeItem('userMobile')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [verifiedRole, setVerifiedRole] = useState<AppRole | null>(null)
  const [roleStatus, setRoleStatus] = useState<RoleStatus>('idle')
  const [roleNonce, setRoleNonce] = useState(0)

  const retryRoleCheck = useCallback(() => setRoleNonce((n) => n + 1), [])

  useEffect(() => {
    const adopt = (s: Session | null) => {
      setSession(s)
      if (s?.user) {
        const user = buildAppUser(s.user)
        setAppUser(user)
        syncIdentityToLocalStorage(user)
        hydrateManagerScopes()
        return
      }
      // Symmetry with onAuthStateChange, which always had this branch. Without
      // it a cold boot with no session left the previous user's identity in
      // localStorage, and every page that gates on those keys rendered as if
      // signed in -- then failed at the first write with an opaque error.
      setAppUser(null)
      setVerifiedRole(null)
      setRoleStatus('idle')
      clearIdentityStorage()
    }

    supabase.auth
      .getSession()
      .then(({ data: { session: s } }) => adopt(s))
      .catch((error) => {
        console.error('Failed to restore the Supabase session:', error)
        adopt(null)
      })
      .finally(() => setIsLoading(false))

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      adopt(s)
      invalidateManagerScopes()
      if (s?.user) hydrateManagerScopes()
    })

    return () => subscription.unsubscribe()
  }, [])

  // The role is confirmed against table membership via has_app_role, which is
  // SECURITY DEFINER and reads the `admins` / `managers` / `cleaners` tables.
  // user_metadata.app_role is client-editable -- a user can call updateUser on
  // themselves -- so it is treated as a claim to be checked, never an answer.
  useEffect(() => {
    const claim = appUser?.userType
    if (!claim) {
      setVerifiedRole(null)
      setRoleStatus('idle')
      return
    }

    let cancelled = false
    setRoleStatus('verifying')

    supabase
      .rpc('has_app_role', { p_roles: [claim] })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('Could not verify the account role:', error)
          setVerifiedRole(null)
          setRoleStatus('error')
          return
        }
        setVerifiedRole(data === true ? claim : null)
        setRoleStatus('verified')
      })
      .catch((error) => {
        if (cancelled) return
        console.error('Could not verify the account role:', error)
        setVerifiedRole(null)
        setRoleStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [appUser?.id, appUser?.userType, roleNonce])

  const signIn = useCallback(
    async (userType: AppRole, identifier: string, password: string) => {
      const email = deriveSyntheticEmail(userType, identifier)
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) {
        throw new Error(error.message || 'Invalid credentials')
      }

      const actualRole = data.user.user_metadata?.app_role
      if (actualRole !== userType) {
        await supabase.auth.signOut()
        throw new Error('Account is not authorized for this role')
      }
    },
    [],
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    clearIdentityStorage()
    setSession(null)
    setAppUser(null)
    setVerifiedRole(null)
    setRoleStatus('idle')
  }, [])

  return (
    <AuthContext.Provider
      value={{ session, appUser, isLoading, verifiedRole, roleStatus, retryRoleCheck, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
