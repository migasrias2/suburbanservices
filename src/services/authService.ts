import { supabase } from './supabase'
import { deriveSyntheticEmail } from '../lib/authHelpers'

export interface CreateUserData {
  mobile_number: string
  first_name: string
  last_name: string
  password: string
  user_type: 'cleaner' | 'manager' | 'ops_manager'
  email?: string
  username?: string
}

export interface LoginData {
  mobile_number?: string
  username?: string
  password: string
  user_type: 'cleaner' | 'manager' | 'admin' | 'ops_manager'
}

export const authService = {
  async loginUser(loginData: LoginData) {
    try {
      const identifier =
        loginData.user_type === 'ops_manager' || loginData.user_type === 'admin'
          ? loginData.username
          : loginData.mobile_number

      if (!identifier) {
        throw new Error(
          loginData.user_type === 'ops_manager' || loginData.user_type === 'admin'
            ? 'Username is required'
            : 'Mobile number is required',
        )
      }

      const email = deriveSyntheticEmail(loginData.user_type, identifier)
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: loginData.password,
      })

      if (error) {
        throw new Error('Invalid credentials')
      }

      const meta = data.user.user_metadata
      const actualRole = meta?.app_role

      // Verify the app_role matches the requested role
      if (actualRole !== loginData.user_type) {
        await supabase.auth.signOut()
        throw new Error('Account is not authorized for this role')
      }

      // Check if user is active in the app table
      const isActive = await this.checkUserActive(data.user.id, loginData.user_type)
      if (!isActive) {
        await supabase.auth.signOut()
        throw new Error('Account is deactivated. Please contact admin.')
      }

      return {
        success: true,
        user: {
          id: data.user.id,
          name: [meta.first_name, meta.last_name].filter(Boolean).join(' ') || 'Unknown',
          mobile_number: meta.mobile_number ?? null,
          email: data.user.email,
          username: meta.username ?? null,
          user_type: loginData.user_type,
        },
        message: 'Login successful',
      }
    } catch (error: any) {
      console.error('Login error:', error)
      return {
        success: false,
        error: error.message || 'Login failed',
      }
    }
  },

  async registerUser(userData: CreateUserData) {
    try {
      if ((userData as any).user_type === 'admin') {
        return {
          success: false,
          error: 'Admin account creation is disabled. Please contact a system administrator.',
        }
      }

      const identifier =
        userData.user_type === 'ops_manager' ? userData.username! : userData.mobile_number

      const email = deriveSyntheticEmail(userData.user_type, identifier)

      // Create Supabase Auth account
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password: userData.password,
        options: {
          data: {
            app_role: userData.user_type,
            first_name: userData.first_name,
            last_name: userData.last_name,
            mobile_number: userData.mobile_number,
            username: userData.username || null,
          },
        },
      })

      if (authError || !authData.user) {
        throw new Error(authError?.message || 'Failed to create account')
      }

      // Insert into the app table with the same UUID
      const userId = authData.user.id

      if (userData.user_type === 'cleaner') {
        const { error } = await supabase.from('cleaners').insert({
          id: userId,
          mobile_number: userData.mobile_number,
          first_name: userData.first_name,
          last_name: userData.last_name,
          password_hash: 'managed_by_supabase_auth',
          email: userData.email || null,
          is_active: true,
        })
        if (error) throw new Error(error.message)
      } else {
        const { error } = await supabase.from('managers').insert({
          id: userId,
          mobile_number: userData.mobile_number,
          first_name: userData.first_name,
          last_name: userData.last_name,
          password_hash: 'managed_by_supabase_auth',
          email: userData.email || null,
          employee_id: `${userData.user_type === 'ops_manager' ? 'OPS' : 'MGR'}_${Date.now()}`,
          is_active: true,
          role: userData.user_type === 'ops_manager' ? 'ops_manager' : 'manager',
          username: userData.user_type === 'ops_manager' ? userData.username : null,
        })
        if (error) throw new Error(error.message)
      }

      // Sign out so the user must log in explicitly
      await supabase.auth.signOut()

      return {
        success: true,
        user: { id: userId },
        message: 'Account created successfully',
      }
    } catch (error: any) {
      console.error('Registration error:', error)
      return {
        success: false,
        error: error.message || 'Registration failed',
      }
    }
  },

  async checkUserActive(
    userId: string,
    userType: 'cleaner' | 'manager' | 'ops_manager' | 'admin',
  ): Promise<boolean> {
    const tableName = userType === 'cleaner' ? 'cleaners' : userType === 'admin' ? 'admins' : 'managers'
    const { data } = await supabase
      .from(tableName)
      .select('is_active')
      .eq('id', userId)
      .single()
    return data?.is_active ?? true
  },
}
