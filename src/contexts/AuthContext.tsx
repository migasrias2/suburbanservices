import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../services/supabase'
import { deriveSyntheticEmail } from '../lib/authHelpers'
import { setStoredCleanerName } from '../lib/identity'

export interface AppUser {
  id: string
  userType: 'cleaner' | 'manager' | 'ops_manager' | 'admin'
  name: string
  mobile?: string | null
  username?: string | null
}

interface AuthContextType {
  session: Session | null
  appUser: AppUser | null
  isLoading: boolean
  signIn: (
    userType: 'cleaner' | 'manager' | 'ops_manager' | 'admin',
    identifier: string,
    password: string,
  ) => Promise<void>
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

function syncToLocalStorage(appUser: AppUser) {
  localStorage.setItem('userType', appUser.userType)
  localStorage.setItem('userId', appUser.id)
  setStoredCleanerName(appUser.name)
  if (appUser.mobile) {
    localStorage.setItem('userMobile', appUser.mobile)
  } else {
    localStorage.removeItem('userMobile')
  }
}

function clearLocalStorage() {
  localStorage.removeItem('userType')
  localStorage.removeItem('userId')
  localStorage.removeItem('userName')
  localStorage.removeItem('userMobile')
  localStorage.removeItem('currentClockInData')
  localStorage.removeItem('currentClockInPhase')
  localStorage.removeItem('currentSiteName')
  localStorage.removeItem('recentClockOutAt')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Restore existing session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      if (s?.user) {
        const user = buildAppUser(s.user)
        setAppUser(user)
        syncToLocalStorage(user)
      }
      setIsLoading(false)
    })

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (s?.user) {
        const user = buildAppUser(s.user)
        setAppUser(user)
        syncToLocalStorage(user)
      } else {
        setAppUser(null)
        clearLocalStorage()
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = useCallback(
    async (
      userType: 'cleaner' | 'manager' | 'ops_manager' | 'admin',
      identifier: string,
      password: string,
    ) => {
      const email = deriveSyntheticEmail(userType, identifier)
      console.log('[Auth] Attempting sign in with email:', email)
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) {
        console.error('[Auth] Supabase error:', error.message, error.status)
        throw new Error(error.message || 'Invalid credentials')
      }

      // Verify the app_role matches the requested role
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
    clearLocalStorage()
    setSession(null)
    setAppUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ session, appUser, isLoading, signIn, signOut }}>
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
