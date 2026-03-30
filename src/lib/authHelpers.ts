/**
 * Normalizes a phone number to digits only, applying UK-specific fixes.
 * Must match the SQL migration normalization exactly:
 *   - Strip all non-digits
 *   - Fix double-zero prefix: 440xx → 44xx (when length > 11)
 *   - Convert leading 0 → 44
 */
export function normalizePhoneToDigits(phone: string): string {
  let d = phone.replace(/\D/g, '')

  // Fix double-zero: 440xx... -> 44xx...
  if (d.startsWith('440') && d.length > 11) {
    d = '44' + d.slice(3)
  }

  // Convert leading 0 to 44-prefixed
  if (d.startsWith('0')) {
    d = '44' + d.slice(1)
  }

  return d
}

const DOMAINS: Record<string, string> = {
  cleaner: 'cleaner.suburbanservices.local',
  manager: 'manager.suburbanservices.local',
  ops_manager: 'ops.suburbanservices.local',
  admin: 'admin.suburbanservices.local',
}

/**
 * Derives the synthetic email used as the Supabase Auth identifier.
 * Must produce the same email as the SQL migration for existing users.
 */
export function deriveSyntheticEmail(
  userType: 'cleaner' | 'manager' | 'ops_manager' | 'admin',
  identifier: string,
): string {
  const domain = DOMAINS[userType]

  if (userType === 'ops_manager' || userType === 'admin') {
    return `${identifier.trim().toLowerCase()}@${domain}`
  }

  return `${normalizePhoneToDigits(identifier)}@${domain}`
}
