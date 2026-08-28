import { describe, it, expect } from 'vitest'
import { normalizePhoneToDigits, formatPhoneE164, deriveSyntheticEmail } from './authHelpers'

/**
 * These functions decide who a person IS. The synthetic email they produce is
 * the login identifier, so the guarantee under test is not "the maths is
 * right" but "every spelling of one person resolves to one account".
 */

/** Every spelling of the Ofcom reserved-for-fiction number 07700 900123. */
const ONE_NUMBER = [
  '07700 900123',
  '07700900123',
  '+44 7700 900123',
  '+447700900123',
  '447700900123',
  '7700900123',
  '7700 900123',
  '0044 7700 900123',
  '00447700900123',
  '+44 07700 900123',
  '044 7700 900123',
  '+44 (0)7700 900123',
  '  07700900123  ',
  '07700-900123',
  '(07700) 900123',
]

describe('normalizePhoneToDigits', () => {
  it.each(ONE_NUMBER)('resolves "%s" to the one identity 447700900123', (spelling) => {
    expect(normalizePhoneToDigits(spelling)).toBe('447700900123')
  })

  it.each(ONE_NUMBER)('is idempotent for "%s", so a stored number re-normalises to itself', (spelling) => {
    const once = normalizePhoneToDigits(spelling)
    expect(normalizePhoneToDigits(once)).toBe(once)
  })

  it('returns empty for a string with no digits rather than inventing a number', () => {
    expect(normalizePhoneToDigits('not a phone')).toBe('')
  })

  it('returns empty for an empty string', () => {
    expect(normalizePhoneToDigits('')).toBe('')
  })

  it('returns empty for whitespace only', () => {
    expect(normalizePhoneToDigits('   ')).toBe('')
  })

  it('survives a null identifier without throwing', () => {
    expect(normalizePhoneToDigits(null as unknown as string)).toBe('')
  })

  it('survives an undefined identifier without throwing', () => {
    expect(normalizePhoneToDigits(undefined as unknown as string)).toBe('')
  })

  it('never truncates a number that is already the right length', () => {
    // 440... is a real prefix collision: peeling it off a 12-digit number
    // would corrupt a valid identity.
    expect(normalizePhoneToDigits('447700900123')).toHaveLength(12)
  })

  it('does not inflate a too-short number into a plausible UK identity', () => {
    // '123' is not a phone number. Whatever it becomes, it must not come out
    // the same length as a real UK mobile, or a typo silently becomes an
    // account that looks legitimate.
    expect(normalizePhoneToDigits('123')).not.toHaveLength(12)
  })
})

describe('formatPhoneE164', () => {
  it.each(ONE_NUMBER)('stores "%s" as +447700900123', (spelling) => {
    expect(formatPhoneE164(spelling)).toBe('+447700900123')
  })

  it('returns empty rather than a bare "+" when there is nothing to format', () => {
    expect(formatPhoneE164('')).toBe('')
  })

  it('returns empty rather than a bare "+" for a digitless string', () => {
    expect(formatPhoneE164('n/a')).toBe('')
  })

  it('round-trips through normalizePhoneToDigits', () => {
    expect(normalizePhoneToDigits(formatPhoneE164('07700 900123'))).toBe('447700900123')
  })
})

describe('deriveSyntheticEmail', () => {
  it('routes a cleaner to the cleaner domain', () => {
    expect(deriveSyntheticEmail('cleaner', '07700900123')).toBe(
      '447700900123@cleaner.suburbanservices.local',
    )
  })

  it('routes a manager to the manager domain', () => {
    expect(deriveSyntheticEmail('manager', '07700900123')).toBe(
      '447700900123@manager.suburbanservices.local',
    )
  })

  it('routes an ops manager to the ops domain, by username', () => {
    expect(deriveSyntheticEmail('ops_manager', 'ops.lead')).toBe(
      'ops.lead@ops.suburbanservices.local',
    )
  })

  it('routes an admin to the admin domain, by username', () => {
    expect(deriveSyntheticEmail('admin', 'miguel')).toBe('miguel@admin.suburbanservices.local')
  })

  it('gives a cleaner and a manager on the same number different accounts', () => {
    expect(deriveSyntheticEmail('cleaner', '07700900123')).not.toBe(
      deriveSyntheticEmail('manager', '07700900123'),
    )
  })

  it.each(['ops.lead', 'Ops.Lead', 'OPS.LEAD', '  ops.lead  ', ' Ops.Lead '])(
    'treats the username "%s" as the same ops_manager account',
    (typed) => {
      expect(deriveSyntheticEmail('ops_manager', typed)).toBe(
        'ops.lead@ops.suburbanservices.local',
      )
    },
  )

  it.each(ONE_NUMBER)('treats the phone "%s" as the same cleaner account', (typed) => {
    expect(deriveSyntheticEmail('cleaner', typed)).toBe(
      '447700900123@cleaner.suburbanservices.local',
    )
  })
})
