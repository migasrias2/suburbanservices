import bcrypt from 'bcryptjs'
import { supabase } from './supabase'

export interface CreateUserData {
  mobile_number: string
  first_name: string
  last_name: string
  password: string
  user_type: 'cleaner' | 'manager' | 'admin'
  email?: string
  username?: string // For admin registration
}

export interface LoginData {
  mobile_number?: string
  username?: string
  password: string
  user_type: 'cleaner' | 'manager' | 'admin'
}

export const authService = {
  // Hash password
  async hashPassword(password: string): Promise<string> {
    const saltRounds = 12
    return await bcrypt.hash(password, saltRounds)
  },

  // Verify password
  async verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    return await bcrypt.compare(password, hashedPassword)
  },

  // Register new user
  async registerUser(userData: CreateUserData) {
    try {
      // Disallow admin self-registration at the application level
      if (userData.user_type === 'admin') {
        return {
          success: false,
          error: 'Admin account creation is disabled. Please contact a system administrator.'
        }
      }

      // Hash the password
      const hashedPassword = await this.hashPassword(userData.password)

      // Check if user already exists
      let existingUser
      switch (userData.user_type) {
        case 'cleaner':
          const { data: existingCleaner } = await supabase
            .from('cleaners')
            .select('mobile_number')
            .eq('mobile_number', userData.mobile_number)
            .single()
          existingUser = existingCleaner
          break
        case 'manager':
          const { data: existingManager } = await supabase
            .from('managers')
            .select('mobile_number')
            .eq('mobile_number', userData.mobile_number)
            .single()
          existingUser = existingManager
          break
        case 'admin':
          // This path should not be reached due to the early return above,
          // but we keep it for explicitness and safety.
          existingUser = null
          break
      }

      if (existingUser) {
        throw new Error('User already exists with this mobile number/username')
      }

      // Create user based on type
      let result
      switch (userData.user_type) {
        case 'cleaner':
          result = await supabase
            .from('cleaners')
            .insert({
              mobile_number: userData.mobile_number,
              first_name: userData.first_name,
              last_name: userData.last_name,
              password_hash: hashedPassword,
              email: userData.email || null,
              is_active: true
            })
            .select()
            .single()
          break

        case 'manager':
          result = await supabase
            .from('managers')
            .insert({
              mobile_number: userData.mobile_number,
              first_name: userData.first_name,
              last_name: userData.last_name,
              password_hash: hashedPassword,
              email: userData.email || null,
              employee_id: `MGR_${Date.now()}`,
              is_active: true
            })
            .select()
            .single()
          break

        case 'admin':
          // Guardrail: should not reach here because admin registration is disabled
          throw new Error('Admin account creation is disabled')

        default:
          throw new Error('Invalid user type')
      }

      if (result.error) {
        throw new Error(result.error.message)
      }

      return {
        success: true,
        user: result.data,
        message: 'Account created successfully'
      }

    } catch (error: any) {
      console.error('Registration error:', error)
      return {
        success: false,
        error: error.message || 'Registration failed'
      }
    }
  },

  // Login user
  async loginUser(loginData: LoginData) {
    try {
      // Special-case: use server-side RPC for admin login due to RLS
      if (loginData.user_type === 'admin') {
        if (!loginData.username) {
          throw new Error('Username is required')
        }
        const { data: rows, error } = await supabase.rpc('admin_login', {
          p_username: loginData.username,
          p_password: loginData.password
        })

        if (error || !rows || (Array.isArray(rows) && rows.length === 0)) {
          throw new Error('Invalid credentials')
        }

        const adminRow = Array.isArray(rows) ? rows[0] : rows
        const userData = {
          id: adminRow.id,
          name: `${adminRow.first_name} ${adminRow.last_name}`,
          username: adminRow.username,
          email: adminRow.email,
          user_type: 'admin' as const
        }

        return {
          success: true,
          user: userData,
          message: 'Login successful'
        }
      }

      // Default flow for cleaner/manager using client-side verification
      let tableName
      let identifierField

      switch (loginData.user_type) {
        case 'cleaner':
          tableName = 'cleaners'
          identifierField = 'mobile_number'
          break
        case 'manager':
          tableName = 'managers'
          identifierField = 'mobile_number'
          break
        default:
          throw new Error('Invalid user type')
      }

      const identifier = loginData.mobile_number
      if (!identifier) {
        throw new Error('Mobile number is required')
      }

      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .eq(identifierField, identifier)
        .single()

      if (error || !data) {
        throw new Error('Invalid credentials')
      }

      if (!data.is_active) {
        throw new Error('Account is deactivated. Please contact admin.')
      }

      const hashedPassword = data.password_hash
      if (!hashedPassword) {
        throw new Error('Account not properly configured. Please contact admin.')
      }

      const isValidPassword = await this.verifyPassword(loginData.password, hashedPassword)
      if (!isValidPassword) {
        throw new Error('Invalid credentials')
      }

      const userData = loginData.user_type === 'cleaner'
        ? {
            id: data.id,
            name: `${data.first_name} ${data.last_name}`,
            mobile_number: data.mobile_number,
            email: data.email,
            user_type: 'cleaner' as const
          }
        : {
            id: data.id,
            name: `${data.first_name} ${data.last_name}`,
            mobile_number: data.mobile_number,
            email: data.email,
            employee_id: data.employee_id,
            user_type: 'manager' as const
          }

      return {
        success: true,
        user: userData,
        message: 'Login successful'
      }

    } catch (error: any) {
      console.error('Login error:', error)
      return {
        success: false,
        error: error.message || 'Login failed'
      }
    }
  }
}