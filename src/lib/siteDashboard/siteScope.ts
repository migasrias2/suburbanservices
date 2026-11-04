import type { SiteRef } from './types'

/** Lowercase, trimmed, inner whitespace collapsed. The only comparison form for site names. */
export const normalizeName = (value?: string | null): string =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : ''

const uniqueNormalized = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.map((value) => normalizeName(value)).filter(Boolean)))

/**
 * Does a row belong to this site?
 *
 * FAILS CLOSED: a site with no names matches nothing, and a field matches only
 * when it IS one of the site's names (case and spacing aside). That is stricter
 * than buildCustomerScopeMatcher in managerScope.ts, which treats an empty scope
 * as "everything" and matches substrings — fine for an internal manager view,
 * wrong for a client who must never see another client's rows.
 */
export const buildSiteMatcher = (matchNames: Array<string | null | undefined>) => {
  const names = new Set(uniqueNormalized(matchNames))
  return (...fields: Array<string | null | undefined>): boolean => {
    if (!names.size) return false
    return fields.some((field) => {
      const normalized = normalizeName(field)
      return normalized !== '' && names.has(normalized)
    })
  }
}

/** Every distinct spelling of a site name, original case kept for display. */
export const collectMatchNames = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
    const key = trimmed.toLowerCase()
    if (!trimmed || seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

/** "south of england showground" -> "South Of England Showground"; only used when no display name is readable. */
export const titleCaseLabel = (value: string): string =>
  value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

const escapeLikePattern = (value: string): string => value.replace(/[\\%_*]/g, (ch) => `\\${ch}`)

const quoteFilterValue = (value: string): string => `"${value.replace(/["\\]/g, (ch) => `\\${ch}`)}"`

/**
 * A PostgREST `or=(...)` filter: any of `columns` case-insensitively equal to
 * any of `names`. Wildcards are escaped and every value is quoted, so commas
 * and brackets in a customer name cannot break out of the filter. The server
 * filter only narrows the download; rows are still checked with
 * buildSiteMatcher before use. Returns null when there is nothing to match, so
 * callers skip the query instead of sending an unfiltered one.
 */
export const buildNameFilter = (columns: string[], names: string[]): string | null => {
  const values = collectMatchNames(names)
  if (!values.length || !columns.length) return null
  return columns
    .flatMap((column) => values.map((name) => `${column}.ilike.${quoteFilterValue(escapeLikePattern(name))}`))
    .join(',')
}

/**
 * The site the page should show. A requested key outside the allowed list is
 * ignored rather than honoured, so editing ?site= in the URL can never widen a
 * client's scope. Managers fall back to their first site; admins and ops pick.
 */
export const pickSelectedSite = (
  sites: SiteRef[],
  requestedKey: string | null | undefined,
  fallbackToFirst: boolean,
): SiteRef | null => {
  if (requestedKey) {
    const match = sites.find((site) => site.key === requestedKey)
    if (match) return match
  }
  return fallbackToFirst ? sites[0] ?? null : null
}
