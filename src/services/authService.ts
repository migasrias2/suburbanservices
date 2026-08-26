import { supabase } from './supabase'
import { deriveSyntheticEmail } from '../lib/authHelpers'

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
