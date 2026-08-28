/**
 * Canonical phone/identity derivation for the Deno edge functions.
 *
 * THIS FILE MUST STAY RULE-FOR-RULE IDENTICAL TO src/lib/authHelpers.ts.
 *
 * The normalized digits ARE the account's identity: they become the local part
 * of the synthetic Supabase Auth email. The create path (this file) and the
 * login path (src/lib/authHelpers.ts) run in different runtimes — Deno cannot
 * import out of src/ — so the algorithm necessarily exists twice. Any
 * divergence mints an account under one email while login derives another, and
 * the person is silently locked out of an account whose password they hold.
 *
 * There is a third implementation, public.normalize_phone_digits, in migration
 * 20260824160347. All three must agree.
 *
 * A FOURTH representation exists and is deliberately NOT this one: auth
 * user_metadata.mobile_number stays BARE DIGITS while cleaners/managers
 * .mobile_number is stored as E.164 ('+' || digits). Do not "fix" that.
 * The metadata value flows AuthContext -> localStorage 'userMobile' ->
 * qrService, where both sides of the only comparison come from metadata, so it
 * is self-consistent; rewriting it to E.164 would desynchronise in-progress
 * shifts against attendance rows already written under the old shape.
 *
 * Drift is caught by the parity contract test in src/, not by discipline.
 */

const DOMAINS: Record<string, string> = {
  cleaner: 'cleaner.suburbanservices.local',
  manager: 'manager.suburbanservices.local',
  ops_manager: 'ops.suburbanservices.local',
  admin: 'admin.suburbanservices.local',
}

export type Role = 'cleaner' | 'manager' | 'ops_manager' | 'admin'

/**
 * Normalizes a phone number to the digits of its E.164 form (no leading "+").
 *
 * Rules (UK-centric, matching the +44-only PhoneInput):
 *   - strip everything that isn't a digit
 *   - 0044…            -> 44…      (international access prefix)
 *   - 07…              -> 447…     (national trunk code -> country code)
 *   - 7xxxxxxxxx       -> 447…     (bare UK mobile, no trunk code)
 *   - 440… / 4444…     -> 44…      (redundant prefixes left behind by a UI
 *                                   that blindly prepends "+44")
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
 * Formats a phone number for storage as E.164 ("+447…").
 *
 * Migration 20260824160347 rewrote every existing cleaners/managers row to this
 * shape. mobile_number is compared as a raw string by cleaners_mobile_number_key,
 * so storing bare digits here would sit alongside "+44…" rows without colliding.
 */
export function formatPhoneE164(phone: string): string {
  const d = normalizePhoneToDigits(phone)
  return d ? `+${d}` : ''
}

/** Derives the synthetic email used as the Supabase Auth identifier. */
export function deriveSyntheticEmail(role: Role, identifier: string): string {
  const domain = DOMAINS[role]

  if (role === 'ops_manager' || role === 'admin') {
    return `${identifier.trim().toLowerCase()}@${domain}`
  }

  return `${normalizePhoneToDigits(identifier)}@${domain}`
}
