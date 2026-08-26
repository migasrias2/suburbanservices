/**
 * Normalizes a phone number to the digits of its E.164 form (no leading "+").
 *
 * This value IS the account's identity: it becomes the local part of the
 * synthetic Supabase Auth email. Two spellings of the same number MUST
 * normalize to the same digits, or the user ends up with two accounts.
 *
 * Rules (UK-centric, matching the +44-only PhoneInput):
 *   - strip everything that isn't a digit
 *   - 0044…            -> 44…      (international access prefix)
 *   - 07…              -> 447…     (national trunk code -> country code)
 *   - 7xxxxxxxxx       -> 447…     (bare UK mobile, no trunk code)
 *   - 440… / 4444…     -> 44…      (redundant prefixes left behind by a UI
 *                                   that blindly prepends "+44" to whatever
 *                                   the user typed; only peeled while the
 *                                   result is longer than a UK number)
 */
export function normalizePhoneToDigits(phone: string): string {
  let d = String(phone ?? '').replace(/\D/g, '')
  if (!d) return ''

  // 0044xxxx -> 44xxxx
  if (d.startsWith('00')) d = d.slice(2)

  // 07xxxxxxxxx -> 447xxxxxxxxx
  if (d.startsWith('0')) d = '44' + d.slice(1)

  // 7xxxxxxxxx -> 447xxxxxxxxx (UK mobile typed without trunk or country code)
  if (/^7\d{9}$/.test(d)) d = '44' + d

  // Peel the prefixes a blind "+44" leaves behind. A UK number is 12 digits,
  // so only strip while we're still too long — never truncate a valid number.
  for (let i = 0; i < 4 && d.length > 12; i++) {
    if (d.startsWith('440')) d = '44' + d.slice(3)        // +44 + 07xxxxxxxxx
    else if (d.startsWith('4444')) d = d.slice(2)         // +44 + 447xxxxxxxxx
    else break
  }

  return d
}

/**
 * Formats a phone number for storage/display as E.164 ("+447…").
 * Always store this, never the raw string the user typed.
 */
export function formatPhoneE164(phone: string): string {
  const d = normalizePhoneToDigits(phone)
  return d ? `+${d}` : ''
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
