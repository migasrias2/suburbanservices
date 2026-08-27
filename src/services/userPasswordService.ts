import { z } from 'zod'
import { supabase } from './supabase'
import {
  describeError,
  describeFunctionError,
  type AppUserRole,
} from './customerOnboardingService'

/**
 * Reading and rewriting the plaintext staff passwords recorded in
 * `public.user_passwords`.
 *
 * Supabase Auth keeps only a bcrypt hash, so a password can never be recovered
 * from an account — it is only ever readable because the create/reset path
 * writes it down at the moment it is set. Accounts that predate that table
 * therefore have nothing to show and must be reset first.
 *
 * Reads are a plain select: RLS on the table restricts it to active admins via
 * `has_app_role`. Writes go through the `admin-set-password` edge function,
 * because changing an account's password needs the service role.
 */

/** Mirrors the edge function's bounds. bcrypt ignores anything past 72 bytes. */
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 72

const ROLES = ['cleaner', 'manager', 'ops_manager', 'admin'] as const

const setPasswordSchema = z.object({
  userId: z.string().uuid('Select a user first'),
  role: z.enum(ROLES, { errorMap: () => ({ message: 'Unknown role' }) }),
  /** An empty string means "generate one for me". */
  password: z.union([
    z.literal(''),
    z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
      .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters`),
  ]),
})

export type StoredPassword = {
  password: string
  updatedAt: string
}

export type SetPasswordResult = {
  password: string
  updatedAt: string
  /**
   * False when the password is now live on the account but could not be
   * written to `user_passwords` — the profile will not show it, so the caller
   * must make the admin copy it there and then.
   */
  recorded: boolean
}

/**
 * The recorded password for one user, or null when none was ever recorded.
 * Null is the normal case for accounts created before this feature existed.
 */
export async function getUserPassword(userId: string): Promise<StoredPassword | null> {
  const { data, error } = await supabase
    .from('user_passwords')
    .select('password, updated_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw new Error(describeError(error))
  }
  if (!data) return null

  return { password: data.password, updatedAt: data.updated_at }
}

/**
 * Sets a user's password and records the plaintext. Pass an empty `password`
 * to have the server generate a readable one.
 */
export async function setUserPassword(input: {
  userId: string
  role: AppUserRole
  password: string
}): Promise<SetPasswordResult> {
  const parsed = setPasswordSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid password')
  }

  const { data, error } = await supabase.functions.invoke('admin-set-password', {
    body: parsed.data,
  })

  if (error) {
    throw new Error(await describeFunctionError(error, 'Failed to set password'))
  }
  if (!data?.password) {
    throw new Error('Password was not returned by the server')
  }

  return {
    password: data.password,
    updatedAt: data.updatedAt,
    recorded: data.recorded !== false,
  }
}
